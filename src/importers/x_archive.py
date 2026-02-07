"""X (Twitter) archive importer.

Goal: convert your exported archive into the project's `events` stream so the graph
can show multi-year growth (not just last N days via API).

We intentionally keep the parser defensive because archive formats vary slightly
across export versions.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path


def _load_js_assigned_json(path: Path):
    """Parse files like `window.YTD.tweets.part0 = [...]` into Python objects."""

    text = path.read_text(encoding="utf-8-sig", errors="replace")
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end < 0 or end <= start:
        raise ValueError(f"Could not locate JSON array in {path}")
    payload = text[start : end + 1]
    return json.loads(payload)


def find_archive_username(archive_dir: str | Path) -> str | None:
    root = Path(archive_dir)
    data_dir = root / "data"

    candidates: list[Path] = []
    for p in [data_dir / "account.js", data_dir / "account.json"]:
        if p.exists():
            candidates.append(p)
    if not candidates:
        candidates = list(root.rglob("account.js"))

    for path in candidates:
        try:
            obj = _load_js_assigned_json(path) if path.suffix.lower() == ".js" else json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        if not isinstance(obj, list):
            continue
        for entry in obj:
            if not isinstance(entry, dict):
                continue
            acc = entry.get("account") or entry.get("data") or entry
            if isinstance(acc, dict):
                uname = acc.get("username")
                if isinstance(uname, str) and uname.strip():
                    return uname.strip().lstrip("@")
    return None


_RE_TW_URL_USER = re.compile(r"https?://(x|twitter)\.com/([^/]+)/status/\d+", re.IGNORECASE)


def _parse_ts_ms(ts: str | None) -> int | None:
    if not ts:
        return None
    s = str(ts).strip()
    if not s:
        return None
    if s.isdigit():
        try:
            v = int(s)
        except Exception:
            return None
        return v if len(s) >= 13 else v * 1000
    try:
        # ISO-ish.
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return int(datetime.fromisoformat(s).timestamp() * 1000)
    except Exception:
        pass
    try:
        # Archive twitter format: "Wed Oct 10 20:19:24 +0000 2018"
        return int(datetime.strptime(s, "%a %b %d %H:%M:%S %z %Y").timestamp() * 1000)
    except Exception:
        return None


def _parse_quoted_username(tweet: dict) -> str | None:
    # Newer archives sometimes include this.
    q = tweet.get("quoted_status_permalink")
    if isinstance(q, dict):
        exp = q.get("expanded") or q.get("url")
        if isinstance(exp, str):
            m = _RE_TW_URL_USER.search(exp)
            if m:
                return m.group(2)
    # Fallback: try to find a twitter.com URL in the text.
    text = tweet.get("full_text") or tweet.get("text") or ""
    if isinstance(text, str):
        m = _RE_TW_URL_USER.search(text)
        if m:
            return m.group(2)
    return None


def extract_events_from_archive(archive_dir: str | Path, username: str) -> list[dict]:
    """Extract outbound events from your X/Twitter archive.

    Current coverage (best-effort, archive-format-dependent):
    - mentioned / replied_to / quoted (from your tweets)
    - liked (from like.js, if present)
    - followed (from following.js, if present)
    """

    root = Path(archive_dir)
    data_dir = root / "data"

    tweet_files: list[Path] = []
    if data_dir.exists():
        tweet_files.extend(sorted(data_dir.glob("tweets*.js")))
        tweet_files.extend(sorted(data_dir.glob("tweet*.js")))
    if not tweet_files:
        tweet_files = sorted(root.rglob("tweets*.js"))

    like_files: list[Path] = []
    follow_files: list[Path] = []
    if data_dir.exists():
        like_files.extend(sorted(data_dir.glob("like*.js")))
        follow_files.extend(sorted(data_dir.glob("following*.js")))
        follow_files.extend(sorted(data_dir.glob("follow*.js")))

    me = f"twitter:{username.lstrip('@')}"
    events: list[dict] = []
    seen: set[str] = set()

    def add(evt: dict) -> None:
        evt_id = evt.get("id")
        if not evt_id or evt_id in seen:
            return
        seen.add(evt_id)
        events.append(evt)

    for path in tweet_files:
        try:
            data = _load_js_assigned_json(path)
        except Exception:
            continue
        if not isinstance(data, list):
            continue

        for entry in data:
            tw = entry.get("tweet") if isinstance(entry, dict) else None
            if not isinstance(tw, dict):
                continue

            tweet_id = str(tw.get("id") or tw.get("tweet_id") or "").strip()
            ts = tw.get("created_at") or tw.get("createdAt")
            if not tweet_id or not isinstance(ts, str) or not ts.strip():
                continue

            text = (tw.get("full_text") or tw.get("text") or "").replace("\n", " ")
            url = f"https://twitter.com/{username}/status/{tweet_id}"

            # Replies.
            reply_to = tw.get("in_reply_to_screen_name") or tw.get("inReplyToScreenName")
            if isinstance(reply_to, str) and reply_to.strip():
                other = f"twitter:{reply_to.strip().lstrip('@')}"
                add(
                    {
                        "id": f"archive:replied_to:{me}->{other}:{tweet_id}:{ts}",
                        "ts": ts,
                        "type": "replied_to",
                        "source": me,
                        "target": other,
                        "tweet_id": tweet_id,
                        "url": url,
                        "text": text[:220],
                    }
                )

            # Mentions.
            entities = tw.get("entities") or {}
            user_mentions = entities.get("user_mentions") or entities.get("mentions") or []
            if isinstance(user_mentions, list):
                for m in user_mentions:
                    if not isinstance(m, dict):
                        continue
                    uname = m.get("screen_name") or m.get("username") or m.get("name")
                    if not isinstance(uname, str) or not uname.strip():
                        continue
                    u = uname.strip().lstrip("@")
                    if u.lower() == username.lower():
                        continue
                    other = f"twitter:{u}"
                    add(
                        {
                            "id": f"archive:mentioned:{me}->{other}:{tweet_id}:{ts}:{u}",
                            "ts": ts,
                            "type": "mentioned",
                            "source": me,
                            "target": other,
                            "tweet_id": tweet_id,
                            "url": url,
                            "text": text[:220],
                        }
                    )

            # Quote tweets (best-effort).
            if bool(tw.get("is_quote_status")) or bool(tw.get("isQuoteStatus")):
                q_user = _parse_quoted_username(tw)
                if isinstance(q_user, str) and q_user.strip():
                    other = f"twitter:{q_user.strip().lstrip('@')}"
                    add(
                        {
                            "id": f"archive:quoted:{me}->{other}:{tweet_id}:{ts}",
                            "ts": ts,
                            "type": "quoted",
                            "source": me,
                            "target": other,
                            "tweet_id": tweet_id,
                            "url": url,
                            "text": text[:220],
                        }
                    )

    def _k(e: dict) -> int:
        ms = _parse_ts_ms(e.get("ts"))
        return ms if ms is not None else 0

    # Chronological sort (real time, not string order).
    events.sort(key=_k)

    # Likes (best-effort): often present as data/like.js with entries containing a tweet URL.
    for path in like_files:
        try:
            data = _load_js_assigned_json(path)
        except Exception:
            continue
        if not isinstance(data, list):
            continue

        for entry in data:
            like = entry.get("like") if isinstance(entry, dict) else None
            if not isinstance(like, dict):
                like = entry if isinstance(entry, dict) else None
            if not isinstance(like, dict):
                continue

            ts = like.get("created_at") or like.get("createdAt") or like.get("timestamp")
            url = like.get("expandedUrl") or like.get("expanded_url") or like.get("url")
            text = like.get("fullText") or like.get("full_text") or like.get("text") or ""
            if not isinstance(url, str):
                # Try the raw text for a status URL.
                if isinstance(text, str):
                    m = _RE_TW_URL_USER.search(text)
                    url = m.group(0) if m else None
            if not isinstance(url, str):
                continue

            m = _RE_TW_URL_USER.search(url)
            if not m:
                continue
            other_user = m.group(2)
            other = f"twitter:{other_user}"
            tweet_id = str(like.get("tweetId") or like.get("tweet_id") or "").strip() or None
            if tweet_id is None:
                # Try to get id from URL.
                parts = url.rstrip("/").split("/")
                if parts and parts[-1].isdigit():
                    tweet_id = parts[-1]

            if not isinstance(ts, str) or not ts.strip():
                # Archive likes sometimes omit timestamps; we still keep the event with empty ts filtered out later.
                continue

            add(
                {
                    "id": f"archive:liked:{me}->{other}:{tweet_id or 'na'}:{ts}",
                    "ts": ts,
                    "type": "liked",
                    "source": me,
                    "target": other,
                    "tweet_id": tweet_id,
                    "url": url,
                    "text": (text or "").replace("\n", " ")[:220] if isinstance(text, str) else None,
                }
            )

    # Following (best-effort): data/following.js often contains accounts you followed.
    for path in follow_files:
        try:
            data = _load_js_assigned_json(path)
        except Exception:
            continue
        if not isinstance(data, list):
            continue

        for entry in data:
            obj = entry.get("following") if isinstance(entry, dict) else None
            if not isinstance(obj, dict):
                obj = entry if isinstance(entry, dict) else None
            if not isinstance(obj, dict):
                continue

            ts = obj.get("followed_at") or obj.get("followedAt") or obj.get("created_at") or obj.get("createdAt")
            uname = obj.get("screenName") or obj.get("screen_name") or obj.get("username") or obj.get("name")
            link = obj.get("userLink") or obj.get("user_link") or obj.get("url")

            if isinstance(link, str) and not (isinstance(uname, str) and uname.strip()):
                # Try to parse @user from a profile link.
                m = re.search(r"https?://(x|twitter)\\.com/([^/?#]+)", link, re.IGNORECASE)
                if m:
                    uname = m.group(2)

            if not isinstance(uname, str) or not uname.strip():
                continue
            if not isinstance(ts, str) or not ts.strip():
                continue

            u = uname.strip().lstrip("@")
            other = f"twitter:{u}"
            add(
                {
                    "id": f"archive:followed:{me}->{other}:na:{ts}",
                    "ts": ts,
                    "type": "followed",
                    "source": me,
                    "target": other,
                    "tweet_id": None,
                    "url": link if isinstance(link, str) else None,
                    "text": None,
                }
            )

    # Re-sort after appending.
    events.sort(key=_k)
    return events
