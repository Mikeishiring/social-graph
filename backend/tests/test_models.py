"""Test database models."""
import pytest
from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from social_graph.database import Base
from social_graph.models import (
    Run, Account, Snapshot, SnapshotFollower, SnapshotFollowing,
    Interval, FollowEvent, InteractionEvent, Post, PostEngager,
    Edge, Community, Position, PositionHistory, Frame, RawFetch,
    utc_now
)


@pytest.fixture
def db_session():
    """Create in-memory database session for testing."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_create_run(db_session):
    """Test creating a collection run."""
    run = Run(
        config_version="1.0.0",
        status="running"
    )
    db_session.add(run)
    db_session.commit()
    
    assert run.run_id is not None
    assert run.status == "running"


def test_create_account(db_session):
    """Test creating an account."""
    account = Account(
        account_id="12345",
        handle="testuser",
        name="Test User",
        followers_count=100
    )
    db_session.add(account)
    db_session.commit()
    
    fetched = db_session.query(Account).filter(
        Account.handle == "testuser"
    ).first()
    
    assert fetched is not None
    assert fetched.followers_count == 100


def test_snapshot_with_followers(db_session):
    """Test snapshot with follower entries."""
    # Create run
    run = Run(config_version="1.0.0", status="completed")
    db_session.add(run)
    db_session.commit()
    
    # Create accounts
    accounts = [
        Account(account_id=f"acc_{i}", handle=f"user{i}")
        for i in range(5)
    ]
    db_session.add_all(accounts)
    db_session.commit()
    
    # Create snapshot
    snapshot = Snapshot(
        run_id=run.run_id,
        kind="followers",
        account_count=5
    )
    db_session.add(snapshot)
    db_session.commit()
    
    # Add followers
    for account in accounts:
        follower = SnapshotFollower(
            snapshot_id=snapshot.snapshot_id,
            account_id=account.account_id
        )
        db_session.add(follower)
    db_session.commit()
    
    # Verify
    assert len(snapshot.followers) == 5


def test_interval_diff(db_session):
    """Test computing interval between snapshots."""
    run = Run(config_version="1.0.0", status="completed")
    db_session.add(run)
    db_session.commit()
    
    # Create two snapshots
    snap1 = Snapshot(run_id=run.run_id, kind="followers", account_count=3)
    snap2 = Snapshot(run_id=run.run_id, kind="followers", account_count=4)
    db_session.add_all([snap1, snap2])
    db_session.commit()
    
    # Create interval
    interval = Interval(
        snapshot_start_id=snap1.snapshot_id,
        snapshot_end_id=snap2.snapshot_id,
        start_at=snap1.captured_at,
        end_at=snap2.captured_at,
        new_followers_count=2,
        lost_followers_count=1
    )
    db_session.add(interval)
    db_session.commit()
    
    assert interval.interval_id is not None
    assert interval.new_followers_count == 2
    assert interval.lost_followers_count == 1


class TestUtcNowHelper:
    """Test timezone-aware datetime helper."""
    
    def test_utc_now_returns_timezone_aware(self):
        """utc_now should return timezone-aware datetime."""
        now = utc_now()
        assert now.tzinfo is not None
        assert now.tzinfo == timezone.utc
    
    def test_utc_now_is_current(self):
        """utc_now should be close to current time."""
        before = datetime.now(timezone.utc)
        now = utc_now()
        after = datetime.now(timezone.utc)
        
        assert before <= now <= after


class TestRawFetch:
    """Test RawFetch model."""
    
    def test_create_raw_fetch(self, db_session):
        """Test creating raw API response record."""
        run = Run(config_version="1.0.0", status="running")
        db_session.add(run)
        db_session.commit()
        
        raw = RawFetch(
            run_id=run.run_id,
            endpoint="users/followers",
            params_hash="abc123",
            cursor_in=None,
            cursor_out="next_cursor",
            truncated=False,
            payload_json='{"data": []}'
        )
        db_session.add(raw)
        db_session.commit()
        
        assert raw.id is not None
        assert raw.fetched_at is not None
    
    def test_raw_fetch_relationship(self, db_session):
        """Test RawFetch -> Run relationship."""
        run = Run(config_version="1.0.0", status="running")
        db_session.add(run)
        db_session.commit()
        
        raw = RawFetch(
            run_id=run.run_id,
            endpoint="test",
            params_hash="hash",
            payload_json="{}"
        )
        db_session.add(raw)
        db_session.commit()
        
        assert raw.run == run
        assert raw in run.raw_fetches


class TestPost:
    """Test Post model."""
    
    def test_create_post(self, db_session):
        """Test creating a post."""
        account = Account(account_id="123", handle="testuser")
        db_session.add(account)
        db_session.commit()
        
        post = Post(
            post_id="post_1",
            author_id="123",
            created_at=datetime.now(timezone.utc),
            text="Hello world!"
        )
        db_session.add(post)
        db_session.commit()
        
        assert post.post_id == "post_1"
        assert post.author == account
    
    def test_post_metrics(self, db_session):
        """Test post with metrics JSON."""
        account = Account(account_id="123", handle="testuser")
        db_session.add(account)
        db_session.commit()
        
        import json
        metrics = {"likes": 100, "retweets": 50}
        
        post = Post(
            post_id="post_1",
            author_id="123",
            created_at=datetime.now(timezone.utc),
            text="Test",
            metrics_json=json.dumps(metrics)
        )
        db_session.add(post)
        db_session.commit()
        
        loaded = json.loads(post.metrics_json)
        assert loaded["likes"] == 100


class TestInteractionEvent:
    """Test InteractionEvent model."""
    
    def test_create_interaction(self, db_session):
        """Test creating an interaction event."""
        run = Run(config_version="1.0.0", status="completed")
        db_session.add(run)
        db_session.commit()
        
        snap1 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        snap2 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        db_session.add_all([snap1, snap2])
        db_session.commit()
        
        interval = Interval(
            snapshot_start_id=snap1.snapshot_id,
            snapshot_end_id=snap2.snapshot_id,
            start_at=snap1.captured_at,
            end_at=snap2.captured_at
        )
        db_session.add(interval)
        db_session.commit()
        
        # Create accounts
        acc1 = Account(account_id="acc_1", handle="user1")
        acc2 = Account(account_id="acc_2", handle="user2")
        db_session.add_all([acc1, acc2])
        db_session.commit()
        
        interaction = InteractionEvent(
            interval_id=interval.interval_id,
            created_at=datetime.now(timezone.utc),
            src_id="acc_1",
            dst_id="acc_2",
            interaction_type="reply"
        )
        db_session.add(interaction)
        db_session.commit()
        
        assert interaction.event_id is not None
        assert interaction.interaction_type == "reply"


class TestEdge:
    """Test Edge model."""
    
    def test_create_edge(self, db_session):
        """Test creating a graph edge."""
        run = Run(config_version="1.0.0", status="completed")
        db_session.add(run)
        db_session.commit()
        
        snap1 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        snap2 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        db_session.add_all([snap1, snap2])
        db_session.commit()
        
        interval = Interval(
            snapshot_start_id=snap1.snapshot_id,
            snapshot_end_id=snap2.snapshot_id,
            start_at=snap1.captured_at,
            end_at=snap2.captured_at
        )
        db_session.add(interval)
        db_session.commit()
        
        acc1 = Account(account_id="acc_1", handle="user1")
        acc2 = Account(account_id="acc_2", handle="user2")
        db_session.add_all([acc1, acc2])
        db_session.commit()
        
        edge = Edge(
            interval_id=interval.interval_id,
            src_id="acc_1",
            dst_id="acc_2",
            edge_type="direct_interaction",
            weight=2.5
        )
        db_session.add(edge)
        db_session.commit()
        
        assert edge.id is not None
        assert edge.weight == 2.5


class TestPosition:
    """Test Position and PositionHistory models."""
    
    def test_create_position(self, db_session):
        """Test creating a node position."""
        run = Run(config_version="1.0.0", status="completed")
        db_session.add(run)
        db_session.commit()
        
        snap1 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        snap2 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        db_session.add_all([snap1, snap2])
        db_session.commit()
        
        interval = Interval(
            snapshot_start_id=snap1.snapshot_id,
            snapshot_end_id=snap2.snapshot_id,
            start_at=snap1.captured_at,
            end_at=snap2.captured_at
        )
        db_session.add(interval)
        db_session.commit()
        
        acc = Account(account_id="acc_1", handle="user1")
        db_session.add(acc)
        db_session.commit()
        
        pos = Position(
            interval_id=interval.interval_id,
            account_id="acc_1",
            x=10.5,
            y=20.3,
            z=-5.0
        )
        db_session.add(pos)
        db_session.commit()
        
        assert pos.id is not None
        assert pos.x == 10.5
        assert pos.y == 20.3
        assert pos.z == -5.0
    
    def test_position_history(self, db_session):
        """Test position history for timeline replay."""
        run = Run(config_version="1.0.0", status="completed")
        db_session.add(run)
        db_session.commit()
        
        snap1 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        snap2 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        db_session.add_all([snap1, snap2])
        db_session.commit()
        
        interval = Interval(
            snapshot_start_id=snap1.snapshot_id,
            snapshot_end_id=snap2.snapshot_id,
            start_at=snap1.captured_at,
            end_at=snap2.captured_at
        )
        db_session.add(interval)
        db_session.commit()
        
        acc = Account(account_id="acc_1", handle="user1")
        db_session.add(acc)
        db_session.commit()
        
        history = PositionHistory(
            interval_id=interval.interval_id,
            account_id="acc_1",
            x=10.0,
            y=20.0,
            z=5.0,
            source="frame_build"
        )
        db_session.add(history)
        db_session.commit()
        
        assert history.id is not None
        assert history.recorded_at is not None
        assert history.source == "frame_build"


class TestFrame:
    """Test Frame model."""
    
    def test_create_frame(self, db_session):
        """Test creating a visualization frame."""
        run = Run(config_version="1.0.0", status="completed")
        db_session.add(run)
        db_session.commit()
        
        snap1 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        snap2 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        db_session.add_all([snap1, snap2])
        db_session.commit()
        
        interval = Interval(
            snapshot_start_id=snap1.snapshot_id,
            snapshot_end_id=snap2.snapshot_id,
            start_at=snap1.captured_at,
            end_at=snap2.captured_at
        )
        db_session.add(interval)
        db_session.commit()
        
        import json
        frame_data = {"nodes": [], "edges": []}
        
        frame = Frame(
            interval_id=interval.interval_id,
            timeframe_window=30,
            frame_json=json.dumps(frame_data),
            node_count=0,
            edge_count=0
        )
        db_session.add(frame)
        db_session.commit()
        
        assert frame.id is not None
        assert frame.timeframe_window == 30
        assert frame.created_at is not None


class TestCommunity:
    """Test Community model."""
    
    def test_create_community_membership(self, db_session):
        """Test creating community membership."""
        run = Run(config_version="1.0.0", status="completed")
        db_session.add(run)
        db_session.commit()
        
        snap1 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        snap2 = Snapshot(run_id=run.run_id, kind="followers", account_count=1)
        db_session.add_all([snap1, snap2])
        db_session.commit()
        
        interval = Interval(
            snapshot_start_id=snap1.snapshot_id,
            snapshot_end_id=snap2.snapshot_id,
            start_at=snap1.captured_at,
            end_at=snap2.captured_at
        )
        db_session.add(interval)
        db_session.commit()
        
        acc = Account(account_id="acc_1", handle="user1")
        db_session.add(acc)
        db_session.commit()
        
        community = Community(
            interval_id=interval.interval_id,
            account_id="acc_1",
            community_id=0,
            confidence=0.95
        )
        db_session.add(community)
        db_session.commit()
        
        assert community.id is not None
        assert community.confidence == 0.95


class TestSnapshotFollowing:
    """Test SnapshotFollowing model."""
    
    def test_following_snapshot(self, db_session):
        """Test creating following snapshot entries."""
        run = Run(config_version="1.0.0", status="completed")
        db_session.add(run)
        db_session.commit()
        
        accounts = [
            Account(account_id=f"acc_{i}", handle=f"user{i}")
            for i in range(3)
        ]
        db_session.add_all(accounts)
        db_session.commit()
        
        snapshot = Snapshot(
            run_id=run.run_id,
            kind="following",
            account_count=3
        )
        db_session.add(snapshot)
        db_session.commit()
        
        for acc in accounts:
            following = SnapshotFollowing(
                snapshot_id=snapshot.snapshot_id,
                account_id=acc.account_id
            )
            db_session.add(following)
        db_session.commit()
        
        assert len(snapshot.following) == 3
