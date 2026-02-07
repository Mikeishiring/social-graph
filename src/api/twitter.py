#!/usr/bin/env python3
"""Social Graph Twitter API Client

Fetches X (Twitter) data using the v2 API and converts it into a visualization-ready
social graph.

Outputs (frontend contract):
- `events`: chronological interaction stream (evidence + playback)
- `nodes`: people with derived stats (first/last seen, inbound/outbound, strengths)
- `edges`: aggregated edges (count + first/last timestamps + examples + weight)

Usage:
  python -m src.api.twitter --days 7 --output frontend/public/data/social-graph.json
"""

from __future__ import annotations

import json
import math
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import networkx as nx
import requests
from dotenv import load_dotenv
from networkx.algorithms import community

# Load environment
load_dotenv(Path(__file__).parent.parent / ".env")

TWITTER_API_BASE = "https://api.twitter.com/2"
MAX_RESULTS = 100

# Event weighting (for tie strength)
EVENT_BASE_WEIGHT = {
    "mentioned": 1.0,
    "replied_to": 1.3,
    "quoted": 1.1,
    "followed": 2.0,
    "liked": 0.7,
    "retweeted": 0.9,
    "posted": 0.2,
}

# Half-life used for recency weighting. 30 days is a reasonable default.
RECENCY_HALF_LIFE_MS = int(30 * 24 * 60 * 60 * 1000)


def _to_400x400(url: str | None) -> str | None:
    if not url:
        return None
    return url.replace("_normal", "_400x400")


def _parse_iso_ms(iso: str | None) -> int | None:
    if not iso:
        return None
    s = str(iso).strip()
    if not s:
        return None

    # Epoch seconds/milliseconds (string).
    if s.isdigit():
        try:
            v = int(s)
        except Exception:
            v = 0
        if v <= 0:
            return None
        # Heuristic: 13+ digits -> ms.
        return v if len(s) >= 13 else v * 1000

    # ISO 8601 (Twitter API v2).
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return int(datetime.fromisoformat(s).timestamp() * 1000)
    except Exception:
        pass

    # X archive "created_at" format (ex: "Wed Oct 10 20:19:24 +0000 2018").
    try:
        dt = datetime.strptime(s, "%a %b %d %H:%M:%S %z %Y")
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _recency_weight(ts_ms: int, now_ms: int) -> float:
    # w = 0.5 ** (age/half_life)
    age = max(0, now_ms - ts_ms)
    if RECENCY_HALF_LIFE_MS <= 0:
        return 1.0
    return math.pow(0.5, age / RECENCY_HALF_LIFE_MS)


class TwitterClient:
    def __init__(self, bearer_token: str | None = None):
        self.bearer_token = bearer_token or os.getenv("TWITTER_BEARER_TOKEN")
        if not self.bearer_token:
            raise ValueError("TWITTER_BEARER_TOKEN not set")

        self.headers = {
            "Authorization": f"Bearer {self.bearer_token}",
            "User-Agent": "SocialGraph/1.0",
        }

    def _request(self, url: str, params: dict | None = None) -> dict:
        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()
        return response.json()

    def get_me(self) -> dict:
        url = f"{TWITTER_API_BASE}/users/me"
        params = {"user.fields": "profile_image_url,public_metrics,description,username,name"}
        return self._request(url, params)

    def get_user_id(self, username: str) -> dict:
        url = f"{TWITTER_API_BASE}/users/by/username/{username}"
        params = {"user.fields": "profile_image_url,public_metrics,description,username,name"}
        return self._request(url, params)

    def get_my_tweets(self, max_results: int = MAX_RESULTS, since_days: int = 7) -> dict:
        user = self.get_me()
        user_id = user["data"]["id"]

        url = f"{TWITTER_API_BASE}/users/{user_id}/tweets"
        since = (datetime.now(timezone.utc) - timedelta(days=since_days)).strftime("%Y-%m-%dT%H:%M:%SZ")

        params = {
            "max_results": max_results,
            "tweet.fields": "created_at,public_metrics,entities,referenced_tweets,in_reply_to_user_id",
            "expansions": "in_reply_to_user_id",
            "user.fields": "profile_image_url,public_metrics,username,name",
            "start_time": since,
        }

        return self._request(url, params)

    def get_mentions(self, max_results: int = MAX_RESULTS, since_days: int = 7) -> dict:
        user = self.get_me()
        user_id = user["data"]["id"]

        url = f"{TWITTER_API_BASE}/users/{user_id}/mentions"
        since = (datetime.now(timezone.utc) - timedelta(days=since_days)).strftime("%Y-%m-%dT%H:%M:%SZ")

        params = {
            "max_results": max_results,
            "tweet.fields": "created_at,author_id,public_metrics,entities",
            "expansions": "author_id",
            "user.fields": "profile_image_url,public_metrics,username,name",
            "start_time": since,
        }

        return self._request(url, params)


def fetch_recent_data(username: str | None = None, since_days: int = 7) -> dict:
    """Fetch Twitter data required for graph building."""

    client = TwitterClient()

    if username:
        user = client.get_user_id(username)
    else:
        user = client.get_me()

    my_tweets = client.get_my_tweets(since_days=since_days)
    mentions_response = client.get_mentions(since_days=since_days)

    mentions_users: dict[str, dict] = {}
    if "includes" in mentions_response and "users" in mentions_response["includes"]:
        for u in mentions_response["includes"]["users"]:
            mentions_users[u["id"]] = u

    tweets_users: dict[str, dict] = {}
    if "includes" in my_tweets and "users" in my_tweets["includes"]:
        for u in my_tweets["includes"]["users"]:
            tweets_users[u["id"]] = u

    return {
        "user": user["data"],
        "tweets": my_tweets.get("data", []),
        "tweets_users": tweets_users,
        "mentions": mentions_response.get("data", []),
        "mentions_users": mentions_users,
        "meta": {"fetched_at": datetime.now(timezone.utc).isoformat(), "since_days": since_days},
    }


def extract_events(data: dict, include_tweets: bool = False) -> list[dict]:
    """Extract a first-class chronological event stream.

    Event schema:
      {
        id: str,
        ts: iso string,
        type: 'mentioned' | 'replied_to' | 'posted',
        source: 'twitter:alice',
        target: 'twitter:bob',
        tweet_id?: str,
        url?: str,
        text?: str
      }
    """

    events: list[dict] = []
    seen_ids: set[str] = set()

    user = data["user"]
    me = f"twitter:{user['username']}"

    # Build reply-target lookup from tweet includes.
    tweets_users = data.get("tweets_users", {})
    id_to_user = {k: v for k, v in tweets_users.items()}

    def add(evt: dict) -> None:
        evt_id = evt.get("id")
        if not evt_id or evt_id in seen_ids:
            return
        seen_ids.add(evt_id)
        events.append(evt)

    # Outbound: your tweets
    for tweet in data.get("tweets", []):
        ts = tweet.get("created_at")
        if not ts:
            continue

        tweet_id = tweet.get("id")
        tweet_url = f"https://twitter.com/{user['username']}/status/{tweet_id}" if tweet_id else None
        text = (tweet.get("text") or "").replace("\n", " ")

        if include_tweets and tweet_id:
            add(
                {
                    "id": f"posted:{me}:{tweet_id}:{ts}",
                    "ts": ts,
                    "type": "posted",
                    "source": me,
                    "target": f"tweet:{tweet_id}",
                    "tweet_id": tweet_id,
                    "url": tweet_url,
                    "text": text[:280],
                }
            )

        # Replies
        in_reply_to_user_id = tweet.get("in_reply_to_user_id")
        if in_reply_to_user_id and str(in_reply_to_user_id) in id_to_user:
            ru = id_to_user[str(in_reply_to_user_id)]
            r_username = ru.get("username")
            if r_username:
                other = f"twitter:{r_username}"
                add(
                    {
                        "id": f"replied_to:{me}->{other}:{tweet_id or 'na'}:{ts}",
                        "ts": ts,
                        "type": "replied_to",
                        "source": me,
                        "target": other,
                        "tweet_id": tweet_id,
                        "url": tweet_url,
                        "text": text[:220],
                    }
                )

        # Mentions
        entities = tweet.get("entities") or {}
        for mention in entities.get("mentions", []) or []:
            uname = mention.get("username")
            if not uname:
                continue
            other = f"twitter:{uname}"
            add(
                {
                    "id": f"mentioned:{me}->{other}:{tweet_id or 'na'}:{ts}",
                    "ts": ts,
                    "type": "mentioned",
                    "source": me,
                    "target": other,
                    "tweet_id": tweet_id,
                    "url": tweet_url,
                    "text": text[:220],
                }
            )

    # Inbound: other people mentioning you
    mentions_users = data.get("mentions_users", {})
    for mention_tweet in data.get("mentions", []):
        ts = mention_tweet.get("created_at")
        if not ts:
            continue

        author_id = mention_tweet.get("author_id")
        author_info = mentions_users.get(author_id or "", {})
        author_username = author_info.get("username")
        if not author_username:
            continue

        other = f"twitter:{author_username}"
        tweet_id = mention_tweet.get("id")
        url = f"https://twitter.com/i/web/status/{tweet_id}" if tweet_id else None
        text = (mention_tweet.get("text") or "").replace("\n", " ")

        add(
            {
                "id": f"mentioned:{other}->{me}:{tweet_id or 'na'}:{ts}",
                "ts": ts,
                "type": "mentioned",
                "source": other,
                "target": me,
                "tweet_id": tweet_id,
                "url": url,
                "text": text[:220],
            }
        )

    # Chronological sort
    def _k(e: dict) -> int:
        t = _parse_iso_ms(e.get("ts"))
        return t if t is not None else 0

    events.sort(key=_k)
    return events


def build_graph_from_events(data: dict, events: list[dict]) -> dict:
    """Build nodes + aggregated edges from an event stream."""

    user = data["user"]
    me = f"twitter:{user['username']}"

    now_ms = _now_ms()

    public_metrics = user.get("public_metrics", {})

    nodes_by_id: dict[str, dict] = {}

    nodes_by_id[me] = {
        "type": "person",
        "id": me,
        "username": user["username"],
        "display_name": user.get("name", user["username"]),
        "profile_image_url": _to_400x400(user.get("profile_image_url")),
        "local_avatar_path": None,
        "followers": public_metrics.get("followers_count", 0),
        "following": public_metrics.get("following_count", 0),
        "is_main_character": True,
        "community_id": 0,
        "first_seen": None,
        "last_seen": None,
        "inbound_count": 0,
        "outbound_count": 0,
        "interaction_count": 0,
        "inbound_strength": 0.0,
        "outbound_strength": 0.0,
        "strength": 0.0,
        "degree": 0,
    }

    # Merge known user profiles from both endpoints.
    username_to_profile: dict[str, dict] = {}
    for u in (data.get("mentions_users", {}) or {}).values():
        uname = u.get("username")
        if uname:
            username_to_profile[uname.lower()] = u

    for u in (data.get("tweets_users", {}) or {}).values():
        uname = u.get("username")
        if uname and uname.lower() not in username_to_profile:
            username_to_profile[uname.lower()] = u

    def ensure_person(node_id: str) -> None:
        if node_id in nodes_by_id:
            return
        if not node_id.startswith("twitter:"):
            return

        username = node_id.split(":", 1)[1]
        profile = username_to_profile.get(username.lower())
        metrics = (profile or {}).get("public_metrics", {})

        nodes_by_id[node_id] = {
            "type": "person",
            "id": node_id,
            "username": username,
            "display_name": (profile or {}).get("name", username),
            "profile_image_url": _to_400x400((profile or {}).get("profile_image_url")),
            "local_avatar_path": None,
            "followers": metrics.get("followers_count", 0),
            "following": metrics.get("following_count", 0),
            "is_main_character": False,
            "community_id": 0,
            "first_seen": None,
            "last_seen": None,
            "inbound_count": 0,
            "outbound_count": 0,
            "interaction_count": 0,
            "inbound_strength": 0.0,
            "outbound_strength": 0.0,
            "strength": 0.0,
            "degree": 0,
        }

    # Node-level first/last seen
    first_seen_ms: dict[str, int] = {}
    last_seen_ms: dict[str, int] = {}

    def bump_seen(node_id: str, t_ms: int) -> None:
        if node_id not in first_seen_ms or t_ms < first_seen_ms[node_id]:
            first_seen_ms[node_id] = t_ms
        if node_id not in last_seen_ms or t_ms > last_seen_ms[node_id]:
            last_seen_ms[node_id] = t_ms

    # Edge aggregation
    edge_agg: dict[tuple[str, str, str], dict] = {}

    for evt in events:
        src = evt.get("source")
        dst = evt.get("target")
        etype = evt.get("type")
        ts = evt.get("ts")
        t_ms = _parse_iso_ms(ts)

        if not src or not dst or not etype or not ts or t_ms is None:
            continue

        if src.startswith("twitter:"):
            ensure_person(src)
        if dst.startswith("twitter:"):
            ensure_person(dst)

        if src in nodes_by_id:
            bump_seen(src, t_ms)
        if dst in nodes_by_id:
            bump_seen(dst, t_ms)

        base = EVENT_BASE_WEIGHT.get(str(etype), 1.0)
        w = base * _recency_weight(t_ms, now_ms)

        # Strength relative to main character
        if src == me and dst in nodes_by_id and dst != me:
            nodes_by_id[dst]["outbound_count"] += 1
            nodes_by_id[dst]["interaction_count"] += 1
            nodes_by_id[dst]["outbound_strength"] += w
            nodes_by_id[dst]["strength"] += w

            nodes_by_id[me]["outbound_count"] += 1
            nodes_by_id[me]["interaction_count"] += 1
            nodes_by_id[me]["outbound_strength"] += w
            nodes_by_id[me]["strength"] += w

        elif dst == me and src in nodes_by_id and src != me:
            nodes_by_id[src]["inbound_count"] += 1
            nodes_by_id[src]["interaction_count"] += 1
            nodes_by_id[src]["inbound_strength"] += w
            nodes_by_id[src]["strength"] += w

            nodes_by_id[me]["inbound_count"] += 1
            nodes_by_id[me]["interaction_count"] += 1
            nodes_by_id[me]["inbound_strength"] += w
            nodes_by_id[me]["strength"] += w

        # Aggregate edges (person-to-person)
        if src.startswith("twitter:") and dst.startswith("twitter:"):
            k = (src, dst, str(etype))
            rec = edge_agg.get(k)
            if not rec:
                rec = {
                    "source": src,
                    "target": dst,
                    "type": str(etype),
                    "count": 0,
                    "weight": 0.0,
                    "first_ts": ts,
                    "last_ts": ts,
                    "examples": [],
                }
                edge_agg[k] = rec

            rec["count"] += 1
            rec["weight"] += w

            # first/last
            ft = _parse_iso_ms(rec["first_ts"])
            lt = _parse_iso_ms(rec["last_ts"])
            if ft is not None and t_ms < ft:
                rec["first_ts"] = ts
            if lt is not None and t_ms > lt:
                rec["last_ts"] = ts

            # Evidence samples
            rec["examples"].append(
                {
                    "ts": ts,
                    "tweet_id": evt.get("tweet_id"),
                    "url": evt.get("url"),
                    "text": evt.get("text"),
                }
            )
            if len(rec["examples"]) > 3:
                rec["examples"] = rec["examples"][-3:]

    # Apply first/last seen ISO
    for node_id, node in nodes_by_id.items():
        if node_id in first_seen_ms:
            node["first_seen"] = datetime.fromtimestamp(first_seen_ms[node_id] / 1000, tz=timezone.utc).isoformat()
        if node_id in last_seen_ms:
            node["last_seen"] = datetime.fromtimestamp(last_seen_ms[node_id] / 1000, tz=timezone.utc).isoformat()

    # Degree = unique neighbors (undirected projection)
    neighbors: dict[str, set[str]] = defaultdict(set)
    for (src, dst, _t) in edge_agg.keys():
        neighbors[src].add(dst)
        neighbors[dst].add(src)

    for node_id, neigh in neighbors.items():
        if node_id in nodes_by_id:
            nodes_by_id[node_id]["degree"] = len(neigh)

    return {
        "nodes": list(nodes_by_id.values()),
        "edges": list(edge_agg.values()),
        "events": events,
        "main_character": me,
    }


def detect_communities(graph_data: dict) -> dict:
    """Detect communities via Louvain on a person-only undirected projection.

    Important: we use edge weights (when available) and stabilize community ids by sorting
    communities by size + a deterministic tiebreak. This makes clusters feel consistent
    across runs and better match "strong ties" structure.
    """

    G = nx.Graph()

    for node in graph_data.get("nodes", []):
        if node.get("type") == "person":
            G.add_node(node["id"])

    person_ids = {n["id"] for n in graph_data.get("nodes", []) if n.get("type") == "person"}
    for edge in graph_data.get("edges", []):
        src = edge.get("source")
        dst = edge.get("target")
        if src in person_ids and dst in person_ids:
            w = edge.get("weight", None)
            if w is None:
                w = edge.get("count", 1.0)
            try:
                w = float(w)
            except Exception:
                w = 1.0

            if G.has_edge(src, dst):
                G[src][dst]["weight"] = float(G[src][dst].get("weight", 0.0)) + w
            else:
                G.add_edge(src, dst, weight=w)

    if len(G.nodes()) > 1 and len(G.edges()) > 0:
        communities = community.louvain_communities(G, seed=42, weight="weight")

        # Stabilize community ids so colors/layout don't reshuffle randomly.
        def _stable_key(comm: set[str]) -> tuple[int, str]:
            first = sorted(comm)[0] if comm else ""
            return (-len(comm), first)

        communities = sorted(communities, key=_stable_key)
        node_to_community: dict[str, int] = {}
        for idx, comm in enumerate(communities):
            for node_id in comm:
                node_to_community[node_id] = idx

        for node in graph_data.get("nodes", []):
            node["community_id"] = node_to_community.get(node.get("id"), 0)
    else:
        for node in graph_data.get("nodes", []):
            node["community_id"] = 0

    return graph_data


def download_avatars(graph_data: dict, output_dir: str = "frontend/public/avatars") -> dict:
    """Download profile images locally to avoid CORS issues."""

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    for node in graph_data.get("nodes", []):
        if node.get("type") != "person":
            continue

        profile_url = node.get("profile_image_url")
        if not profile_url:
            node["local_avatar_path"] = None
            continue

        safe_username = str(node.get("username", "user")).replace("/", "_").replace("\\", "_")
        local_filename = f"{safe_username}.jpg"
        local_path = output_path / local_filename

        try:
            response = requests.get(profile_url, timeout=10)
            response.raise_for_status()
            with open(local_path, "wb") as f:
                f.write(response.content)
            node["local_avatar_path"] = f"/avatars/{local_filename}"
        except Exception as e:
            print(f"Failed to download avatar for {node.get('username')}: {e}")
            node["local_avatar_path"] = None

    return graph_data


def prepare_graph_from_event_stream(
    data: dict,
    events: list[dict],
    download_images: bool = True,
    output_dir: str = "frontend/public/avatars",
) -> dict:
    """Build a viz-ready graph from an event stream and attach meta.

    `data` is used as a best-effort source of user profiles (name, avatar url, follower
    counts) for nodes seen in the stream.
    """

    graph = build_graph_from_events(data, events)
    graph = detect_communities(graph)

    if download_images:
        graph = download_avatars(graph, output_dir=output_dir)

    graph["meta"] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_nodes": len(graph.get("nodes", [])),
        "total_edges": len(graph.get("edges", [])),
        "total_events": len(graph.get("events", [])),
        "total_persons": len([n for n in graph.get("nodes", []) if n.get("type") == "person"]),
        "communities": len(
            set(
                n.get("community_id", 0)
                for n in graph.get("nodes", [])
                if n.get("type") == "person"
            )
        ),
    }

    return graph


def prepare_for_visualization(
    data: dict,
    include_tweets: bool = False,
    download_images: bool = True,
    output_dir: str = "frontend/public/avatars",
) -> dict:
    """Full pipeline: extract events -> build graph -> communities -> optional avatars -> metadata."""

    events = extract_events(data, include_tweets=include_tweets)
    return prepare_graph_from_event_stream(
        data,
        events,
        download_images=download_images,
        output_dir=output_dir,
    )


def prepare_graph_from_events(
    events: list[dict],
    username: str,
    download_images: bool = False,
    output_dir: str = "frontend/public/avatars",
) -> dict:
    """Build a viz-ready graph from a pre-existing event stream (ex: archive import).

    This uses the same aggregation + community detection as the API pipeline, but with
    a minimal stub user profile (no follower counts / profile image URLs by default).
    """

    stub = {
        "user": {
            "username": username,
            "name": username,
            "public_metrics": {"followers_count": 0, "following_count": 0},
        },
        "mentions_users": {},
        "tweets_users": {},
    }

    return prepare_graph_from_event_stream(
        stub,
        events,
        download_images=download_images,
        output_dir=output_dir,
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Social Graph Twitter Client")
    parser.add_argument("--username", help="Username to fetch (defaults to authenticated user)")
    parser.add_argument("--days", type=int, default=7, help="Days to fetch")
    parser.add_argument("--output", help="Output file path")
    parser.add_argument("--include-tweets", action="store_true", help="Include tweet nodes in graph")
    parser.add_argument("--no-avatars", action="store_true", help="Skip downloading avatar images")
    parser.add_argument("--avatar-dir", default="frontend/public/avatars", help="Directory for avatar images")

    args = parser.parse_args()

    print("Fetching Twitter data...")
    raw = fetch_recent_data(username=args.username, since_days=args.days)

    print("Processing graph data...")
    graph = prepare_for_visualization(
        raw,
        include_tweets=args.include_tweets,
        download_images=not args.no_avatars,
        output_dir=args.avatar_dir,
    )

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(graph, f, indent=2)
        print(f"Saved to: {args.output}")
    else:
        print(json.dumps(graph, indent=2))

    print("\nGraph stats:")
    print(f"  Nodes: {graph['meta']['total_nodes']} ({graph['meta']['total_persons']} persons)")
    print(f"  Edges: {graph['meta']['total_edges']}")
    print(f"  Events: {graph['meta']['total_events']}")
    print(f"  Communities: {graph['meta']['communities']}")
