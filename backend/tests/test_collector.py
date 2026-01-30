"""Test data collector with retry logic."""
import pytest
import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from social_graph.database import Base
from social_graph.models import (
    Run, Account, Snapshot, SnapshotFollower, SnapshotFollowing,
    Interval, FollowEvent, RawFetch
)
from social_graph.collector import (
    Collector, CollectorError, RetryableAPIError, utc_now
)
from social_graph.twitter_client import TwitterAPIError


@pytest.fixture
def db_session():
    """Create in-memory database session for testing."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def mock_twitter_client():
    """Create mock Twitter client."""
    client = AsyncMock()
    return client


class TestUtcNow:
    """Test UTC timezone handling."""
    
    def test_utc_now_is_timezone_aware(self):
        """Ensure utc_now returns timezone-aware datetime."""
        now = utc_now()
        assert now.tzinfo is not None
        assert now.tzinfo == timezone.utc
    
    def test_utc_now_is_not_naive(self):
        """Ensure we're not using naive datetime."""
        now = utc_now()
        # Should not raise when comparing with timezone-aware datetime
        other = datetime.now(timezone.utc)
        assert (now - other).total_seconds() < 1


class TestCollectorRun:
    """Test collection run management."""
    
    def test_start_run_creates_record(self, db_session, mock_twitter_client):
        """Test that _start_run creates a Run record."""
        collector = Collector(db_session, mock_twitter_client)
        run = collector._start_run()
        
        assert run.run_id is not None
        assert run.status == "running"
        assert run.started_at is not None
        assert run.finished_at is None
    
    def test_finish_run_updates_status(self, db_session, mock_twitter_client):
        """Test that _finish_run updates status and time."""
        collector = Collector(db_session, mock_twitter_client)
        collector._start_run()
        
        collector._finish_run(status="completed", notes="Test complete")
        
        assert collector.run.status == "completed"
        assert collector.run.finished_at is not None
        assert collector.run.notes == "Test complete"
    
    def test_finish_run_with_failure(self, db_session, mock_twitter_client):
        """Test run marked as failed."""
        collector = Collector(db_session, mock_twitter_client)
        collector._start_run()
        
        collector._finish_run(status="failed", notes="API timeout")
        
        assert collector.run.status == "failed"
        assert "timeout" in collector.run.notes


class TestAccountUpsert:
    """Test account creation and updates."""
    
    def test_create_new_account(self, db_session, mock_twitter_client):
        """Test creating a new account."""
        collector = Collector(db_session, mock_twitter_client)
        collector._start_run()
        
        user_data = {
            "id": "12345",
            "username": "testuser",
            "name": "Test User",
            "profile_image_url": "https://example.com/avatar.jpg",
            "description": "Test bio",
            "public_metrics": {
                "followers_count": 100,
                "following_count": 50,
                "tweet_count": 1000
            }
        }
        
        account = collector._upsert_account(user_data)
        
        assert account.account_id == "12345"
        assert account.handle == "testuser"
        assert account.followers_count == 100
    
    def test_update_existing_account(self, db_session, mock_twitter_client):
        """Test updating an existing account."""
        # Create initial account
        existing = Account(
            account_id="12345",
            handle="oldhandle",
            followers_count=50
        )
        db_session.add(existing)
        db_session.commit()
        
        collector = Collector(db_session, mock_twitter_client)
        collector._start_run()
        
        user_data = {
            "id": "12345",
            "username": "newhandle",
            "name": "Updated Name",
            "public_metrics": {
                "followers_count": 200
            }
        }
        
        account = collector._upsert_account(user_data)
        
        assert account.handle == "newhandle"
        assert account.followers_count == 200


class TestIntervalDiff:
    """Test interval computation."""
    
    def test_compute_interval_diff_new_followers(self, db_session, mock_twitter_client):
        """Test computing new followers between snapshots."""
        # Setup
        collector = Collector(db_session, mock_twitter_client)
        collector._start_run()
        
        # Create accounts
        for i in range(5):
            acc = Account(account_id=f"acc_{i}", handle=f"user{i}")
            db_session.add(acc)
        db_session.commit()
        
        # Create first snapshot with accounts 0,1,2
        snap1 = Snapshot(run_id=collector.run.run_id, kind="followers", account_count=3)
        db_session.add(snap1)
        db_session.commit()
        
        for i in range(3):
            sf = SnapshotFollower(snapshot_id=snap1.snapshot_id, account_id=f"acc_{i}")
            db_session.add(sf)
        db_session.commit()
        
        # Create second snapshot with accounts 1,2,3,4 (lost 0, gained 3,4)
        snap2 = Snapshot(run_id=collector.run.run_id, kind="followers", account_count=4)
        db_session.add(snap2)
        db_session.commit()
        
        for i in range(1, 5):
            sf = SnapshotFollower(snapshot_id=snap2.snapshot_id, account_id=f"acc_{i}")
            db_session.add(sf)
        db_session.commit()
        
        # Compute diff
        interval = collector.compute_interval_diff(snap1, snap2)
        
        assert interval.new_followers_count == 2  # acc_3, acc_4
        assert interval.lost_followers_count == 1  # acc_0
        
        # Verify follow events
        events = db_session.query(FollowEvent).filter(
            FollowEvent.interval_id == interval.interval_id
        ).all()
        
        new_events = [e for e in events if e.kind == "new"]
        lost_events = [e for e in events if e.kind == "lost"]
        
        assert len(new_events) == 2
        assert len(lost_events) == 1
    
    def test_compute_interval_diff_mismatched_kinds_raises(self, db_session, mock_twitter_client):
        """Test that diffing different snapshot kinds raises error."""
        collector = Collector(db_session, mock_twitter_client)
        collector._start_run()
        
        snap1 = Snapshot(run_id=collector.run.run_id, kind="followers", account_count=1)
        snap2 = Snapshot(run_id=collector.run.run_id, kind="following", account_count=1)
        db_session.add_all([snap1, snap2])
        db_session.commit()
        
        with pytest.raises(CollectorError, match="different kinds"):
            collector.compute_interval_diff(snap1, snap2)


class TestRawFetchStorage:
    """Test raw API response storage."""
    
    def test_store_raw_fetch(self, db_session, mock_twitter_client):
        """Test storing raw API responses."""
        collector = Collector(db_session, mock_twitter_client)
        collector._start_run()
        
        raw = collector._store_raw_fetch(
            endpoint="users/123/followers",
            params={"max_results": 100},
            cursor_in=None,
            cursor_out="next_cursor_abc",
            truncated=False,
            payload={"data": [{"id": "1"}, {"id": "2"}]}
        )
        db_session.commit()
        
        assert raw.run_id == collector.run.run_id
        assert raw.endpoint == "users/123/followers"
        assert raw.cursor_out == "next_cursor_abc"
        assert "data" in json.loads(raw.payload_json)


@pytest.mark.asyncio
class TestCollectFollowersRetry:
    """Test collector retry logic."""
    
    async def test_successful_collection(self, db_session, mock_twitter_client):
        """Test successful follower collection."""
        # Mock paginate_followers to yield one page
        async def mock_paginate(*args, **kwargs):
            yield [
                {"id": "1", "username": "user1", "name": "User 1", "public_metrics": {}},
                {"id": "2", "username": "user2", "name": "User 2", "public_metrics": {}}
            ], None, "cursor_out", False
        
        mock_twitter_client.paginate_followers = mock_paginate
        
        collector = Collector(db_session, mock_twitter_client)
        collector._start_run()
        
        snapshot = await collector.collect_followers("target_user_id", max_pages=1)
        
        assert snapshot.account_count == 2
        assert snapshot.kind == "followers"
    
    async def test_retry_on_api_error(self, db_session, mock_twitter_client):
        """Test that API errors trigger retry."""
        call_count = 0
        
        async def failing_then_success(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise TwitterAPIError(429, "Rate limited")
            yield [
                {"id": "1", "username": "user1", "name": "User 1", "public_metrics": {}}
            ], None, None, False
        
        mock_twitter_client.paginate_followers = failing_then_success
        
        collector = Collector(db_session, mock_twitter_client)
        collector._start_run()
        
        # Should succeed after retry
        snapshot = await collector.collect_followers("target_user_id", max_pages=1)
        
        assert snapshot.account_count == 1
        assert call_count == 2  # Failed once, succeeded once


class TestLatestSnapshot:
    """Test getting latest snapshot."""
    
    def test_get_latest_snapshot(self, db_session, mock_twitter_client):
        """Test retrieving most recent snapshot."""
        collector = Collector(db_session, mock_twitter_client)
        collector._start_run()
        
        # Create multiple snapshots
        snap1 = Snapshot(run_id=collector.run.run_id, kind="followers", account_count=10)
        snap2 = Snapshot(run_id=collector.run.run_id, kind="followers", account_count=20)
        snap3 = Snapshot(run_id=collector.run.run_id, kind="following", account_count=5)
        
        db_session.add_all([snap1, snap2, snap3])
        db_session.commit()
        
        latest_followers = collector.get_latest_snapshot("followers")
        latest_following = collector.get_latest_snapshot("following")
        
        assert latest_followers.account_count == 20
        assert latest_following.account_count == 5
    
    def test_get_latest_snapshot_none_exists(self, db_session, mock_twitter_client):
        """Test returns None when no snapshots exist."""
        collector = Collector(db_session, mock_twitter_client)
        
        result = collector.get_latest_snapshot("followers")
        
        assert result is None
