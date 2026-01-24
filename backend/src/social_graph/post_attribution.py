"""Post attribution computation and persistence."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from .config import settings
from .models import (
    Community,
    FollowEvent,
    InteractionEvent,
    Interval,
    Post,
    PostAttribution,
    PostEngager,
)
from .models import utc_now


def _reference_time(db: Session) -> datetime:
    latest_interval = db.query(Interval).order_by(Interval.end_at.desc()).first()
    if latest_interval and latest_interval.end_at:
        return latest_interval.end_at
    return utc_now()


def _parse_metrics(metrics_json: Optional[str]) -> dict:
    if not metrics_json:
        return {"likes": 0, "replies": 0, "reposts": 0, "quotes": 0}
    try:
        data = json.loads(metrics_json)
    except json.JSONDecodeError:
        return {"likes": 0, "replies": 0, "reposts": 0, "quotes": 0}

    return {
        "likes": int(data.get("like_count", data.get("likes", 0)) or 0),
        "replies": int(data.get("reply_count", data.get("replies", 0)) or 0),
        "reposts": int(data.get("retweet_count", data.get("reposts", 0)) or 0),
        "quotes": int(data.get("quote_count", data.get("quotes", 0)) or 0),
    }


def _resolve_post_interval(db: Session, post: Post) -> Optional[Interval]:
    interval = db.query(Interval).filter(
        Interval.start_at <= post.created_at,
        Interval.end_at >= post.created_at,
    ).first()
    if interval:
        return interval

    intervals = db.query(Interval).order_by(Interval.end_at.desc()).limit(200).all()
    if not intervals:
        return None

    return min(intervals, key=lambda item: abs((item.end_at - post.created_at).total_seconds()))


def _interval_ids_within_window(
    db: Session,
    start_at: datetime,
    lookback_days: int,
) -> list[int]:
    window_end = start_at + timedelta(days=lookback_days)
    intervals = db.query(Interval).filter(
        Interval.end_at >= start_at,
        Interval.end_at <= window_end,
    ).all()
    return [interval.interval_id for interval in intervals]


def _community_ids_for_accounts(
    db: Session,
    interval_id: Optional[int],
    account_ids: Iterable[str],
) -> list[int]:
    account_ids = list(account_ids)
    if not account_ids or interval_id is None:
        return []

    rows = db.query(Community).filter(
        Community.interval_id == interval_id,
        Community.account_id.in_(account_ids),
    ).all()

    return sorted({row.community_id for row in rows})


def _compute_post_payload(
    db: Session,
    post: Post,
    timeframe_window: int,
) -> Optional[dict]:
    post_interval = _resolve_post_interval(db, post)
    if not post_interval:
        return None
    interval_ids = _interval_ids_within_window(
        db,
        post.created_at,
        settings.attribution_lookback_days,
    )

    if post_interval.interval_id not in interval_ids:
        interval_ids.append(post_interval.interval_id)

    if not interval_ids:
        return None

    new_followers = db.query(FollowEvent).filter(
        FollowEvent.interval_id.in_(interval_ids),
        FollowEvent.kind == "new",
    ).all()
    new_follower_ids = {event.account_id for event in new_followers}

    engagers = db.query(PostEngager).filter(PostEngager.post_id == post.post_id).all()
    engager_ids = {engager.account_id for engager in engagers}

    interactions = db.query(InteractionEvent).filter(
        InteractionEvent.post_id == post.post_id
    ).all()
    for interaction in interactions:
        engager_ids.add(interaction.src_id)

    high_ids = new_follower_ids.intersection(engager_ids)

    medium_ids: set[str] = set()
    if post_interval:
        same_interval = db.query(FollowEvent).filter(
            FollowEvent.interval_id == post_interval.interval_id,
            FollowEvent.kind == "new",
        ).all()
        medium_ids = {event.account_id for event in same_interval}
        medium_ids -= high_ids

    low_ids = new_follower_ids - high_ids - medium_ids

    evidence: list[str] = []
    if engager_ids:
        evidence.append("Direct engagement within attribution window")
    if post_interval:
        evidence.append("New followers in same interval as post")
    if len(interval_ids) > 1:
        evidence.append("Followed within lookback window")
    if not evidence:
        evidence.append("Interval-based correlation")

    follower_delta = len(medium_ids)
    attributed_ids = list(high_ids | medium_ids | low_ids)
    community_ids = _community_ids_for_accounts(
        db,
        post_interval.interval_id,
        attributed_ids,
    )

    payload = {
        "id": post.post_id,
        "interval_id": post_interval.interval_id,
        "created_at": post.created_at.isoformat(),
        "text": post.text,
        "metrics": _parse_metrics(post.metrics_json),
        "attribution": {
            "high": len(high_ids),
            "medium": len(medium_ids),
            "low": len(low_ids),
        },
        "evidence": evidence,
        "follower_delta": follower_delta,
        "attributed_follower_ids": attributed_ids,
        "community_ids": community_ids,
        "timeframe_days": timeframe_window,
        "is_mock": False,
    }

    return payload


def load_post_attributions(
    db: Session,
    timeframe_window: int,
    limit: int,
) -> list[dict]:
    rows = db.query(PostAttribution).filter(
        PostAttribution.timeframe_window == timeframe_window
    ).order_by(PostAttribution.created_at.desc()).limit(limit).all()

    results = []
    for row in rows:
        try:
            results.append(json.loads(row.payload_json))
        except json.JSONDecodeError:
            continue

    return results


def build_post_attributions(
    db: Session,
    timeframe_window: int,
    limit: int,
    rebuild: bool = False,
) -> list[dict]:
    if rebuild:
        db.query(PostAttribution).filter(
            PostAttribution.timeframe_window == timeframe_window
        ).delete()
        db.commit()

    existing = load_post_attributions(db, timeframe_window, limit)
    if existing and not rebuild:
        return existing

    reference_time = _reference_time(db)
    posts_query = db.query(Post)
    if timeframe_window > 0:
        posts_query = posts_query.filter(
            Post.created_at >= reference_time - timedelta(days=timeframe_window)
        )

    posts = posts_query.order_by(Post.created_at.desc()).limit(limit).all()
    if not posts:
        return []

    results: list[dict] = []
    for post in posts:
        payload = _compute_post_payload(db, post, timeframe_window)
        if not payload:
            continue

        existing_row = db.query(PostAttribution).filter(
            PostAttribution.post_id == post.post_id,
            PostAttribution.timeframe_window == timeframe_window,
        ).first()

        if existing_row:
            existing_row.interval_id = payload.get("interval_id")
            existing_row.created_at = post.created_at
            existing_row.payload_json = json.dumps(payload)
            existing_row.built_at = utc_now()
        else:
            db.add(PostAttribution(
                post_id=post.post_id,
                interval_id=payload.get("interval_id"),
                timeframe_window=timeframe_window,
                created_at=post.created_at,
                payload_json=json.dumps(payload),
                built_at=utc_now(),
            ))

        results.append(payload)

    db.commit()
    results.sort(key=lambda item: item["created_at"], reverse=True)
    return results[:limit]
