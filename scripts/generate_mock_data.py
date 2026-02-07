#!/usr/bin/env python3
"""Generate realistic mock social graph data for visualization testing.

This produces the same schema as the real pipeline:
- `events`: chronological interaction stream
- `edges`: aggregated edges with counts/weights and first/last timestamps
- `nodes`: derived stats (first/last seen + inbound/outbound relative to main)

Run:
  python scripts/generate_mock_data.py
"""

from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)

NUM_NODES = 80
NUM_COMMUNITIES = 5
INTRA_COMMUNITY_EDGE_PROB = 0.3
INTER_COMMUNITY_EDGE_PROB = 0.05

EVENT_BASE_WEIGHT = {
    "mentioned": 1.0,
    "replied_to": 1.3,
    "quoted": 1.1,
    "followed": 2.0,
    "posted": 0.2,
}

RECENCY_HALF_LIFE_MS = int(30 * 24 * 60 * 60 * 1000)

FIRST_NAMES = [
    "alex",
    "jordan",
    "taylor",
    "morgan",
    "casey",
    "riley",
    "avery",
    "quinn",
    "blake",
    "drew",
    "jamie",
    "sam",
    "chris",
    "pat",
    "lee",
    "max",
    "sky",
    "ash",
    "sage",
    "river",
    "phoenix",
    "winter",
    "storm",
    "reed",
    "luna",
    "nova",
    "echo",
]

TOPICS = ["dev", "ai", "crypto", "design", "data", "cloud", "web3", "ml", "ux", "pm"]


def recency_weight(ts_ms: int, now_ms: int) -> float:
    age = max(0, now_ms - ts_ms)
    return math.pow(0.5, age / RECENCY_HALF_LIFE_MS) if RECENCY_HALF_LIFE_MS > 0 else 1.0


def generate_username() -> str:
    style = random.choice(["name_topic", "name_num", "topic_name", "initials"])

    if style == "name_topic":
        return f"{random.choice(FIRST_NAMES)}_{random.choice(TOPICS)}"
    if style == "name_num":
        return f"{random.choice(FIRST_NAMES)}{random.randint(1, 999)}"
    if style == "topic_name":
        return f"{random.choice(TOPICS)}{random.choice(FIRST_NAMES)}"
    return f"{''.join(random.choices('abcdefghijklmnopqrstuvwxyz', k=2))}{random.randint(10, 99)}"


def generate_display_name(username: str) -> str:
    parts = username.replace("_", " ").split()
    return " ".join(p.capitalize() for p in parts if not p.isdigit())


def generate_nodes(num_nodes: int, num_communities: int) -> list[dict]:
    nodes: list[dict] = []
    used_usernames: set[str] = set()

    main_user = {
        "type": "person",
        "id": "twitter:yourhandle",
        "username": "yourhandle",
        "display_name": "Your Name",
        "profile_image_url": "https://pbs.twimg.com/profile_images/placeholder/main_400x400.jpg",
        "local_avatar_path": None,
        "followers": random.randint(1000, 5000),
        "following": random.randint(500, 2000),
        "degree": 0,
        "community_id": 0,
        "is_main_character": True,
        "first_seen": None,
        "last_seen": None,
        "inbound_count": 0,
        "outbound_count": 0,
        "interaction_count": 0,
        "inbound_strength": 0.0,
        "outbound_strength": 0.0,
        "strength": 0.0,
    }

    nodes.append(main_user)
    used_usernames.add("yourhandle")

    for i in range(num_nodes - 1):
        username = generate_username()
        while username in used_usernames:
            username = generate_username()
        used_usernames.add(username)

        community_id = i % num_communities

        follower_base = random.choice([50, 100, 200, 500, 1000, 2000, 5000, 10000])
        followers = int(follower_base * random.uniform(0.5, 2.0))

        node = {
            "type": "person",
            "id": f"twitter:{username}",
            "username": username,
            "display_name": generate_display_name(username),
            "profile_image_url": f"https://pbs.twimg.com/profile_images/placeholder/{username}_400x400.jpg",
            "local_avatar_path": None,
            "followers": followers,
            "following": random.randint(50, max(100, followers)),
            "degree": 0,
            "community_id": community_id,
            "is_main_character": False,
            "first_seen": None,
            "last_seen": None,
            "inbound_count": 0,
            "outbound_count": 0,
            "interaction_count": 0,
            "inbound_strength": 0.0,
            "outbound_strength": 0.0,
            "strength": 0.0,
        }
        nodes.append(node)

    return nodes


def generate_event_edges(nodes: list[dict], intra_prob: float, inter_prob: float) -> list[dict]:
    edges: list[dict] = []

    main_node = nodes[0]
    other_nodes = nodes[1:]

    for node in other_nodes:
        if random.random() < 0.4:
            edge_type = random.choice(["mentioned", "replied_to", "mentioned", "mentioned"])
            timestamp = (datetime.now() - timedelta(days=random.randint(0, 60))).isoformat()

            if random.random() < 0.5:
                edges.append({"source": main_node["id"], "target": node["id"], "type": edge_type, "timestamp": timestamp})
            else:
                edges.append({"source": node["id"], "target": main_node["id"], "type": edge_type, "timestamp": timestamp})

    for i, node1 in enumerate(other_nodes):
        for j, node2 in enumerate(other_nodes):
            if i >= j:
                continue

            prob = intra_prob if node1["community_id"] == node2["community_id"] else inter_prob
            if random.random() < prob:
                edge_type = random.choice(["mentioned", "replied_to", "quoted"])
                timestamp = (datetime.now() - timedelta(days=random.randint(0, 60))).isoformat()
                edges.append({"source": node1["id"], "target": node2["id"], "type": edge_type, "timestamp": timestamp})

    return edges


def edges_to_events(edges: list[dict]) -> list[dict]:
    events: list[dict] = []
    for i, e in enumerate(edges):
        events.append(
            {
                "id": f"mock:{e['type']}:{e['source']}->{e['target']}:{e['timestamp']}:{i}",
                "ts": e["timestamp"],
                "type": e["type"],
                "source": e["source"],
                "target": e["target"],
                "tweet_id": None,
                "url": None,
                "text": None,
            }
        )

    events.sort(key=lambda x: x["ts"])
    return events


def aggregate_edges_from_events(events: list[dict]) -> list[dict]:
    agg: dict[tuple[str, str, str], dict] = {}
    now_ms = int(datetime.now().timestamp() * 1000)

    for evt in events:
        k = (evt["source"], evt["target"], evt["type"])
        rec = agg.get(k)
        if not rec:
            rec = {
                "source": evt["source"],
                "target": evt["target"],
                "type": evt["type"],
                "count": 0,
                "weight": 0.0,
                "first_ts": evt["ts"],
                "last_ts": evt["ts"],
                "examples": [],
            }
            agg[k] = rec

        rec["count"] += 1
        rec["first_ts"] = min(rec["first_ts"], evt["ts"])
        rec["last_ts"] = max(rec["last_ts"], evt["ts"])

        base = EVENT_BASE_WEIGHT.get(evt["type"], 1.0)
        t_ms = int(datetime.fromisoformat(evt["ts"]).timestamp() * 1000)
        rec["weight"] += base * recency_weight(t_ms, now_ms)

        rec["examples"].append({"ts": evt["ts"], "url": evt.get("url"), "text": evt.get("text"), "tweet_id": evt.get("tweet_id")})
        if len(rec["examples"]) > 3:
            rec["examples"] = rec["examples"][-3:]

    return list(agg.values())


def apply_node_stats(nodes: list[dict], events: list[dict], main_id: str) -> None:
    first_seen: dict[str, str] = {}
    last_seen: dict[str, str] = {}

    by_id = {n["id"]: n for n in nodes}

    now_ms = int(datetime.now().timestamp() * 1000)

    for evt in events:
        for nid in (evt["source"], evt["target"]):
            first_seen[nid] = min(first_seen.get(nid, evt["ts"]), evt["ts"])
            last_seen[nid] = max(last_seen.get(nid, evt["ts"]), evt["ts"])

    for nid, t in first_seen.items():
        if nid in by_id:
            by_id[nid]["first_seen"] = t

    for nid, t in last_seen.items():
        if nid in by_id:
            by_id[nid]["last_seen"] = t

    # inbound/outbound + strengths relative to main
    for evt in events:
        src = evt["source"]
        tgt = evt["target"]
        etype = evt["type"]

        base = EVENT_BASE_WEIGHT.get(etype, 1.0)
        t_ms = int(datetime.fromisoformat(evt["ts"]).timestamp() * 1000)
        w = base * recency_weight(t_ms, now_ms)

        if src == main_id and tgt in by_id and tgt != main_id:
            by_id[tgt]["outbound_count"] += 1
            by_id[tgt]["interaction_count"] += 1
            by_id[tgt]["outbound_strength"] += w
            by_id[tgt]["strength"] += w

        elif tgt == main_id and src in by_id and src != main_id:
            by_id[src]["inbound_count"] += 1
            by_id[src]["interaction_count"] += 1
            by_id[src]["inbound_strength"] += w
            by_id[src]["strength"] += w

    # degree = unique neighbors
    neigh: dict[str, set[str]] = defaultdict(set)
    for evt in events:
        s, t = evt["source"], evt["target"]
        neigh[s].add(t)
        neigh[t].add(s)

    for nid, ns in neigh.items():
        if nid in by_id:
            by_id[nid]["degree"] = len(ns)


def main() -> None:
    print("Generating mock social graph data...")

    nodes = generate_nodes(NUM_NODES, NUM_COMMUNITIES)
    event_edges = generate_event_edges(nodes, INTRA_COMMUNITY_EDGE_PROB, INTER_COMMUNITY_EDGE_PROB)

    events = edges_to_events(event_edges)
    edges_agg = aggregate_edges_from_events(events)

    main_id = "twitter:yourhandle"
    apply_node_stats(nodes, events, main_id)

    graph = {
        "nodes": nodes,
        "edges": edges_agg,
        "events": events,
        "main_character": main_id,
        "meta": {
            "generated_at": datetime.now().isoformat(),
            "total_nodes": len(nodes),
            "total_edges": len(edges_agg),
            "total_events": len(events),
            "total_persons": len([n for n in nodes if n["type"] == "person"]),
            "communities": NUM_COMMUNITIES,
        },
    }

    data_dir = Path(__file__).parent.parent / "frontend" / "public" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    # For local dev, we write the "real" path.
    output_path = data_dir / "social-graph.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2)

    # For git, keep a committed example that doesn't get overwritten by real fetches.
    example_path = data_dir / "social-graph.example.json"
    with open(example_path, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2)

    print(f"Generated graph with {len(nodes)} nodes and {len(edges_agg)} edges")
    print(f"Events: {len(events)}")
    print(f"Communities: {NUM_COMMUNITIES}")
    print(f"Saved to: {output_path}")
    print(f"Example:  {example_path}")


if __name__ == "__main__":
    main()
