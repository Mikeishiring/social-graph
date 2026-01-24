"""Mock post overlay data for M3 previews."""
from __future__ import annotations

import json
import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy.orm import Session

from .models import Account, Interval, Community, Post, PostAttribution
from .models import utc_now


POST_SNIPPETS = [
    "Shipping the timeline stability pass today. Clusters are locking in.",
    "Mapping new follower bursts to post waves. Early results look strong.",
    "Trying a tighter attribution window to reduce noise in the graph.",
    "Community bridges are showing up after the last post drop.",
    "New co-engagement clusters formed within the first 24 hours.",
    "Testing a lighter layout pass for smoother replay.",
    "Exploring how replies reshape the core cluster.",
    "Focusing on high-signal posts to cut the long tail.",
]

EVIDENCE_POOL = [
    "Direct engagement within 24h window",
    "Follower delta spike in next interval",
    "Shared co-engagement cluster with post engagers",
    "Mentions and replies concentrated in same window",
    "High overlap with top engagers",
]


def _ensure_mock_accounts(db: Session, target: int = 80) -> None:
    existing_count = db.query(Account).count()
    if existing_count >= target:
        return

    needed = target - existing_count
    start_index = existing_count + 1

    for index in range(needed):
        account_id = f"mock_user_{start_index + index}"
        exists = db.query(Account).filter(Account.account_id == account_id).first()
        if exists:
            continue
        db.add(Account(
            account_id=account_id,
            handle=f"mockuser{start_index + index}",
            name=f"Mock User {start_index + index}",
            avatar_url=None,
            bio="Synthetic account for mock attribution previews.",
            followers_count=0,
            following_count=0,
            tweet_count=0,
        ))
    db.flush()


@dataclass(frozen=True)
class IntervalLike:
    interval_id: int
    end_at: datetime
    new_followers_count: int


def _ensure_intervals(db: Session, limit: int) -> list[IntervalLike]:
    intervals = db.query(Interval).order_by(Interval.end_at.asc()).limit(limit).all()
    if intervals:
        return [
            IntervalLike(
                interval_id=interval.interval_id,
                end_at=interval.end_at,
                new_followers_count=interval.new_followers_count or 0,
            )
            for interval in intervals
        ]

    fallback_count = max(6, min(limit, 12))
    now = utc_now()
    return [
        IntervalLike(
            interval_id=index + 1,
            end_at=now - timedelta(days=(fallback_count - 1 - index)),
            new_followers_count=12 + (index * 2),
        )
        for index in range(fallback_count)
    ]


def _pick_unique(items: list[str], count: int, rng: random.Random) -> list[str]:
    if count <= 0 or not items:
        return []
    count = min(count, len(items))
    indices = rng.sample(range(len(items)), count)
    return [items[index] for index in indices]


def _community_ids_for_accounts(
    db: Session,
    interval_id: int,
    account_ids: Iterable[str],
) -> list[int]:
    account_ids = list(account_ids)
    if not account_ids:
        return []

    communities = db.query(Community).filter(
        Community.interval_id == interval_id,
        Community.account_id.in_(account_ids),
    ).all()

    if communities:
        return sorted({community.community_id for community in communities})

    fallback_ids = {
        sum(ord(char) for char in account_id) % 5 for account_id in account_ids
    }
    return sorted(fallback_ids)


def generate_mock_posts(
    db: Session,
    timeframe_window: int,
    limit: int,
) -> list[dict]:
    intervals = _ensure_intervals(db, limit)
    accounts = db.query(Account).limit(500).all()
    account_ids = [account.account_id for account in accounts]

    posts: list[dict] = []

    for index, interval in enumerate(intervals):
        seed_base = interval.interval_id * 101 + index * 17
        rng = random.Random(seed_base)
        should_create = index in (0, len(intervals) - 1) or rng.random() > 0.55
        if not should_create:
            continue

        post_count = 1 + (1 if rng.random() > 0.7 else 0)
        for post_index in range(post_count):
            post_seed = seed_base + post_index * 37
            post_rng = random.Random(post_seed)

            snippet = POST_SNIPPETS[(interval.interval_id + post_index) % len(POST_SNIPPETS)]
            total_attributed = 6 + post_rng.randint(0, 14)
            if account_ids:
                total_attributed = min(total_attributed, len(account_ids))
            else:
                total_attributed = 0

            high = max(1, int(total_attributed * (0.35 + post_rng.random() * 0.15))) if total_attributed else 0
            medium = max(1, int(total_attributed * (0.35 + post_rng.random() * 0.15))) if total_attributed else 0
            low = max(total_attributed - high - medium, 0)

            attributed_ids = _pick_unique(account_ids, total_attributed, post_rng)
            community_ids = _community_ids_for_accounts(db, interval.interval_id, attributed_ids)
            evidence = _pick_unique(EVIDENCE_POOL, 2 + (1 if post_rng.random() > 0.6 else 0), post_rng)

            created_at = interval.end_at - timedelta(hours=post_rng.randint(1, 6))

            posts.append({
                "id": f"mock_post_{interval.interval_id}_{post_index}",
                "interval_id": interval.interval_id,
                "created_at": created_at.isoformat(),
                "text": snippet,
                "metrics": {
                    "likes": 40 + post_rng.randint(0, 420),
                    "replies": 5 + post_rng.randint(0, 70),
                    "reposts": 10 + post_rng.randint(0, 110),
                    "quotes": 2 + post_rng.randint(0, 22),
                },
                "attribution": {
                    "high": high,
                    "medium": medium,
                    "low": low,
                },
                "evidence": evidence,
                "follower_delta": max(total_attributed, 1) + post_rng.randint(0, 6),
                "attributed_follower_ids": attributed_ids,
                "community_ids": community_ids,
                "is_mock": True,
                "timeframe_days": timeframe_window,
            })

    return sorted(posts, key=lambda post: post["created_at"])


def seed_mock_post_attributions(
    db: Session,
    timeframe_window: int,
    limit: int,
    rebuild: bool = False,
) -> list[dict]:
    _ensure_mock_accounts(db)
    posts = generate_mock_posts(db, timeframe_window, limit)
    if not posts:
        return []

    author_id = "mock_author"
    author = db.query(Account).filter(Account.account_id == author_id).first()
    if not author:
        author = Account(
            account_id=author_id,
            handle="mockdata",
            name="Mock Author",
            avatar_url=None,
            bio="Synthetic author for mock attribution previews.",
            followers_count=0,
            following_count=0,
            tweet_count=0,
        )
        db.add(author)
        db.flush()

    if rebuild:
        db.query(PostAttribution).filter(
            PostAttribution.timeframe_window == timeframe_window,
            PostAttribution.post_id.like("mock_post_%"),
        ).delete(synchronize_session=False)

    for post in posts:
        created_at = datetime.fromisoformat(post["created_at"])
        metrics_json = json.dumps(post.get("metrics", {}))

        existing_post = db.query(Post).filter(Post.post_id == post["id"]).first()
        if existing_post:
            existing_post.author_id = author.account_id
            existing_post.created_at = created_at
            existing_post.text = post.get("text", "")
            existing_post.metrics_json = metrics_json
            existing_post.last_seen_at = utc_now()
        else:
            db.add(Post(
                post_id=post["id"],
                author_id=author.account_id,
                created_at=created_at,
                text=post.get("text", ""),
                metrics_json=metrics_json,
                conversation_id=None,
                in_reply_to_id=None,
            ))

        interval_id = post.get("interval_id")
        interval_exists = False
        if isinstance(interval_id, int):
            interval_exists = db.query(Interval).filter(
                Interval.interval_id == interval_id
            ).first() is not None

        existing_attr = db.query(PostAttribution).filter(
            PostAttribution.post_id == post["id"],
            PostAttribution.timeframe_window == timeframe_window,
        ).first()

        payload_json = json.dumps(post)
        if existing_attr:
            existing_attr.interval_id = interval_id if interval_exists else None
            existing_attr.created_at = created_at
            existing_attr.payload_json = payload_json
            existing_attr.built_at = utc_now()
        else:
            db.add(PostAttribution(
                post_id=post["id"],
                interval_id=interval_id if interval_exists else None,
                timeframe_window=timeframe_window,
                created_at=created_at,
                payload_json=payload_json,
                built_at=utc_now(),
            ))

    db.commit()
    return posts
