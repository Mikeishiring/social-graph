"""SQLAlchemy models for Social Graph data storage.

Schema follows the PRD specification with three layers:
- Raw (append-only): raw_fetches
- Normalized (canonical): runs, accounts, posts, snapshots, follow_events, interactions
- Derived (recomputable): intervals, edges, communities, positions, frames
"""
from datetime import datetime, timezone


def utc_now():
    """Timezone-aware UTC now (replaces deprecated datetime.utcnow)."""
    return datetime.now(timezone.utc)
from typing import Optional
from sqlalchemy import (
    String, Integer, Text, DateTime, ForeignKey, JSON, Boolean, Float,
    UniqueConstraint, Index
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


# =============================================================================
# RAW LAYER (append-only)
# =============================================================================

class RawFetch(Base):
    """Raw API response storage - append only, never modified."""
    __tablename__ = "raw_fetches"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.run_id"), index=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    endpoint: Mapped[str] = mapped_column(String(255))  # e.g., "users/followers"
    params_hash: Mapped[str] = mapped_column(String(64))  # SHA256 of params
    cursor_in: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cursor_out: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    truncated: Mapped[bool] = mapped_column(Boolean, default=False)
    payload_json: Mapped[str] = mapped_column(Text)  # Raw JSON response
    
    # Relationships
    run: Mapped["Run"] = relationship(back_populates="raw_fetches")


# =============================================================================
# NORMALIZED LAYER (canonical IDs)
# =============================================================================

class Run(Base):
    """Collection run metadata."""
    __tablename__ = "runs"
    
    run_id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="running")  # running, completed, failed
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config_version: Mapped[str] = mapped_column(String(20))
    config_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Full config snapshot
    
    # Relationships
    raw_fetches: Mapped[list["RawFetch"]] = relationship(back_populates="run")
    snapshots: Mapped[list["Snapshot"]] = relationship(back_populates="run")


class Account(Base):
    """Twitter account - canonical record."""
    __tablename__ = "accounts"
    
    account_id: Mapped[str] = mapped_column(String(64), primary_key=True)  # Twitter user ID
    handle: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    followers_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    following_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tweet_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    
    # Relationships
    posts: Mapped[list["Post"]] = relationship(back_populates="author")


class Post(Base):
    """Tweet/post record."""
    __tablename__ = "posts"
    
    post_id: Mapped[str] = mapped_column(String(64), primary_key=True)  # Tweet ID
    author_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    text: Mapped[str] = mapped_column(Text)
    metrics_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # likes, retweets, etc.
    conversation_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    in_reply_to_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    
    # Relationships
    author: Mapped["Account"] = relationship(back_populates="posts")


class Snapshot(Base):
    """Point-in-time snapshot of followers/following."""
    __tablename__ = "snapshots"
    
    snapshot_id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.run_id"), index=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    kind: Mapped[str] = mapped_column(String(20))  # "followers" or "following"
    account_count: Mapped[int] = mapped_column(Integer, default=0)
    
    # Relationships
    run: Mapped["Run"] = relationship(back_populates="snapshots")
    followers: Mapped[list["SnapshotFollower"]] = relationship(back_populates="snapshot")
    following: Mapped[list["SnapshotFollowing"]] = relationship(back_populates="snapshot")


class SnapshotFollower(Base):
    """Follower membership in a snapshot."""
    __tablename__ = "snapshot_followers"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("snapshots.snapshot_id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    
    # Relationships
    snapshot: Mapped["Snapshot"] = relationship(back_populates="followers")
    
    __table_args__ = (
        UniqueConstraint("snapshot_id", "account_id", name="uq_snapshot_follower"),
    )


class SnapshotFollowing(Base):
    """Following membership in a snapshot."""
    __tablename__ = "snapshot_following"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("snapshots.snapshot_id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    
    # Relationships
    snapshot: Mapped["Snapshot"] = relationship(back_populates="following")
    
    __table_args__ = (
        UniqueConstraint("snapshot_id", "account_id", name="uq_snapshot_following"),
    )


class FollowEvent(Base):
    """Follow/unfollow event derived from snapshot diffs."""
    __tablename__ = "follow_events"
    
    event_id: Mapped[int] = mapped_column(primary_key=True)
    interval_id: Mapped[int] = mapped_column(ForeignKey("intervals.interval_id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # "new" or "lost"
    
    # Relationships
    interval: Mapped["Interval"] = relationship(back_populates="follow_events")


class InteractionEvent(Base):
    """Direct interaction event (reply, mention, quote, retweet)."""
    __tablename__ = "interaction_events"
    
    event_id: Mapped[int] = mapped_column(primary_key=True)
    interval_id: Mapped[int] = mapped_column(ForeignKey("intervals.interval_id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    src_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    dst_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    interaction_type: Mapped[str] = mapped_column(String(20))  # reply, quote, mention, retweet
    post_id: Mapped[Optional[str]] = mapped_column(ForeignKey("posts.post_id"), nullable=True)
    raw_ref_id: Mapped[Optional[int]] = mapped_column(ForeignKey("raw_fetches.id"), nullable=True)
    
    # Relationships
    interval: Mapped["Interval"] = relationship(back_populates="interaction_events")


class PostEngager(Base):
    """Accounts that engaged with a specific post."""
    __tablename__ = "post_engagers"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    interval_id: Mapped[int] = mapped_column(ForeignKey("intervals.interval_id"), index=True)
    post_id: Mapped[str] = mapped_column(ForeignKey("posts.post_id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    engager_type: Mapped[str] = mapped_column(String(20))  # like, retweet, reply, quote
    
    __table_args__ = (
        UniqueConstraint("interval_id", "post_id", "account_id", "engager_type", 
                        name="uq_post_engager"),
    )


# =============================================================================
# DERIVED LAYER (recomputable caches)
# =============================================================================

class Interval(Base):
    """Time interval between two snapshots."""
    __tablename__ = "intervals"
    
    interval_id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_start_id: Mapped[int] = mapped_column(ForeignKey("snapshots.snapshot_id"))
    snapshot_end_id: Mapped[int] = mapped_column(ForeignKey("snapshots.snapshot_id"))
    start_at: Mapped[datetime] = mapped_column(DateTime)
    end_at: Mapped[datetime] = mapped_column(DateTime)
    new_followers_count: Mapped[int] = mapped_column(Integer, default=0)
    lost_followers_count: Mapped[int] = mapped_column(Integer, default=0)
    
    # Relationships
    follow_events: Mapped[list["FollowEvent"]] = relationship(back_populates="interval")
    interaction_events: Mapped[list["InteractionEvent"]] = relationship(back_populates="interval")
    edges: Mapped[list["Edge"]] = relationship(back_populates="interval")
    communities: Mapped[list["Community"]] = relationship(back_populates="interval")
    positions: Mapped[list["Position"]] = relationship(back_populates="interval")
    position_history: Mapped[list["PositionHistory"]] = relationship(back_populates="interval")
    frames: Mapped[list["Frame"]] = relationship(back_populates="interval")


class Edge(Base):
    """Graph edge for visualization."""
    __tablename__ = "edges"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    interval_id: Mapped[int] = mapped_column(ForeignKey("intervals.interval_id"), index=True)
    src_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    dst_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    edge_type: Mapped[str] = mapped_column(String(30))  # direct_interaction, co_engagement, ego_follow
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    meta_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Relationships
    interval: Mapped["Interval"] = relationship(back_populates="edges")


class Community(Base):
    """Community detection results."""
    __tablename__ = "communities"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    interval_id: Mapped[int] = mapped_column(ForeignKey("intervals.interval_id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    community_id: Mapped[int] = mapped_column(Integer)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    
    # Relationships
    interval: Mapped["Interval"] = relationship(back_populates="communities")
    
    __table_args__ = (
        UniqueConstraint("interval_id", "account_id", name="uq_community_membership"),
    )


class Position(Base):
    """Node position for stable layout."""
    __tablename__ = "positions"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    interval_id: Mapped[int] = mapped_column(ForeignKey("intervals.interval_id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    
    # Relationships
    interval: Mapped["Interval"] = relationship(back_populates="positions")
    
    __table_args__ = (
        UniqueConstraint("interval_id", "account_id", name="uq_position"),
    )


class PositionHistory(Base):
    """Append-only position history for playback analysis."""
    __tablename__ = "position_history"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    interval_id: Mapped[int] = mapped_column(ForeignKey("intervals.interval_id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.account_id"), index=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    source: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    
    # Relationships
    interval: Mapped["Interval"] = relationship(back_populates="position_history")


class Frame(Base):
    """Pre-computed frame for visualization."""
    __tablename__ = "frames"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    interval_id: Mapped[int] = mapped_column(ForeignKey("intervals.interval_id"), index=True)
    timeframe_window: Mapped[int] = mapped_column(Integer)  # 7, 30, 90, or 0 for all
    frame_json: Mapped[str] = mapped_column(Text)  # Full frame data
    node_count: Mapped[int] = mapped_column(Integer)
    edge_count: Mapped[int] = mapped_column(Integer)
    build_meta_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    
    # Relationships
    interval: Mapped["Interval"] = relationship(back_populates="frames")
    
    __table_args__ = (
        UniqueConstraint("interval_id", "timeframe_window", name="uq_frame"),
    )


class PostAttribution(Base):
    """Derived post attribution summary for UI overlays."""
    __tablename__ = "post_attributions"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[str] = mapped_column(ForeignKey("posts.post_id"), index=True)
    interval_id: Mapped[Optional[int]] = mapped_column(ForeignKey("intervals.interval_id"), index=True, nullable=True)
    timeframe_window: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    payload_json: Mapped[str] = mapped_column(Text)
    built_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    __table_args__ = (
        UniqueConstraint("post_id", "timeframe_window", name="uq_post_attribution"),
    )


# =============================================================================
# INDEXES
# =============================================================================

Index("ix_raw_fetches_endpoint", RawFetch.endpoint)
Index("ix_posts_created_at", Post.created_at)
Index("ix_interaction_events_created", InteractionEvent.created_at)
Index("ix_intervals_time", Interval.start_at, Interval.end_at)
Index("ix_position_history_interval_account", PositionHistory.interval_id, PositionHistory.account_id, PositionHistory.recorded_at)
Index("ix_post_attributions_timeframe_created", PostAttribution.timeframe_window, PostAttribution.created_at)
