"""Test frame builder with graph computation."""
import pytest
import json
import math
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from social_graph.database import Base
from social_graph.models import (
    Run, Account, Snapshot, SnapshotFollower, Interval, FollowEvent,
    InteractionEvent, PostEngager, Post, Edge, Community, Position,
    PositionHistory, Frame
)
from social_graph.frame_builder import (
    FrameBuilder, GraphNode, GraphEdge,
    compute_recency_decay, simple_community_detection,
    build_edges_from_interactions, force_directed_layout,
    utc_now, EDGE_WEIGHTS, RECENCY_DECAY_HALF_LIFE_DAYS
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


@pytest.fixture
def sample_interval(db_session):
    """Create a sample interval with related data."""
    run = Run(config_version="1.0.0", status="completed")
    db_session.add(run)
    db_session.commit()
    
    snap1 = Snapshot(run_id=run.run_id, kind="followers", account_count=5)
    snap2 = Snapshot(run_id=run.run_id, kind="followers", account_count=7)
    db_session.add_all([snap1, snap2])
    db_session.commit()
    
    interval = Interval(
        snapshot_start_id=snap1.snapshot_id,
        snapshot_end_id=snap2.snapshot_id,
        start_at=datetime.now(timezone.utc) - timedelta(days=1),
        end_at=datetime.now(timezone.utc),
        new_followers_count=2,
        lost_followers_count=0
    )
    db_session.add(interval)
    db_session.commit()
    
    return interval


@pytest.fixture
def sample_accounts(db_session):
    """Create sample accounts for testing."""
    accounts = []
    for i in range(10):
        acc = Account(
            account_id=f"acc_{i}",
            handle=f"user{i}",
            name=f"User {i}",
            followers_count=100 * (i + 1)
        )
        db_session.add(acc)
        accounts.append(acc)
    db_session.commit()
    return accounts


class TestUtcNow:
    """Test UTC helper function."""
    
    def test_utc_now_returns_timezone_aware(self):
        """Ensure utc_now returns UTC timezone."""
        now = utc_now()
        assert now.tzinfo == timezone.utc


class TestRecencyDecay:
    """Test recency decay computation."""
    
    def test_decay_at_zero_days(self):
        """Decay should be 1.0 at event time."""
        reference = datetime.now(timezone.utc)
        event_time = reference
        
        decay = compute_recency_decay(event_time, reference)
        
        assert decay == pytest.approx(1.0)
    
    def test_decay_at_half_life(self):
        """Decay should be 0.5 at half-life."""
        reference = datetime.now(timezone.utc)
        event_time = reference - timedelta(days=RECENCY_DECAY_HALF_LIFE_DAYS)
        
        decay = compute_recency_decay(event_time, reference)
        
        assert decay == pytest.approx(0.5, rel=0.01)
    
    def test_decay_at_two_half_lives(self):
        """Decay should be 0.25 at 2x half-life."""
        reference = datetime.now(timezone.utc)
        event_time = reference - timedelta(days=2 * RECENCY_DECAY_HALF_LIFE_DAYS)
        
        decay = compute_recency_decay(event_time, reference)
        
        assert decay == pytest.approx(0.25, rel=0.01)
    
    def test_decay_with_none_values(self):
        """Decay returns 1.0 for None inputs."""
        assert compute_recency_decay(None, datetime.now(timezone.utc)) == 1.0
        assert compute_recency_decay(datetime.now(timezone.utc), None) == 1.0
    
    def test_decay_future_event(self):
        """Future events should return 1.0."""
        reference = datetime.now(timezone.utc)
        event_time = reference + timedelta(days=1)
        
        decay = compute_recency_decay(event_time, reference)
        
        assert decay == 1.0


class TestCommunityDetection:
    """Test simple community detection."""
    
    def test_single_node_community(self):
        """Single node should be in its own community."""
        nodes = [GraphNode(account_id="1", handle="user1")]
        edges = []
        
        communities = simple_community_detection(nodes, edges)
        
        assert "1" in communities
        assert communities["1"] == 0
    
    def test_connected_nodes_same_community(self):
        """Strongly connected nodes should end up in same community."""
        nodes = [
            GraphNode(account_id="1"),
            GraphNode(account_id="2"),
            GraphNode(account_id="3")
        ]
        edges = [
            GraphEdge(src_id="1", dst_id="2", edge_type="direct", weight=5.0),
            GraphEdge(src_id="2", dst_id="3", edge_type="direct", weight=5.0),
            GraphEdge(src_id="1", dst_id="3", edge_type="direct", weight=5.0)
        ]
        
        communities = simple_community_detection(nodes, edges)
        
        # All should be in same community
        assert len(set(communities.values())) == 1
    
    def test_disconnected_clusters(self):
        """Disconnected node clusters should be in different communities."""
        nodes = [
            GraphNode(account_id="1"),
            GraphNode(account_id="2"),
            GraphNode(account_id="3"),
            GraphNode(account_id="4")
        ]
        edges = [
            GraphEdge(src_id="1", dst_id="2", edge_type="direct", weight=5.0),
            GraphEdge(src_id="3", dst_id="4", edge_type="direct", weight=5.0)
        ]
        
        communities = simple_community_detection(nodes, edges)
        
        # Should have 2 distinct communities
        assert communities["1"] == communities["2"]
        assert communities["3"] == communities["4"]
        assert communities["1"] != communities["3"]
    
    def test_empty_nodes(self):
        """Empty node list should return empty communities."""
        communities = simple_community_detection([], [])
        assert communities == {}


class TestForceDirectedLayout:
    """Test force-directed layout algorithm."""
    
    def test_single_node_stays_put(self):
        """Single node should not move significantly."""
        nodes = [GraphNode(account_id="1")]
        edges = []
        initial = {"1": (0.0, 0.0, 0.0)}
        
        final = force_directed_layout(nodes, edges, initial, max_iterations=10)
        
        assert "1" in final
        # Should be at or near origin
        x, y, z = final["1"]
        assert abs(x) < 1.0
        assert abs(y) < 1.0
        assert abs(z) < 1.0
    
    def test_connected_nodes_converge(self):
        """Connected nodes should move closer together."""
        nodes = [GraphNode(account_id="1"), GraphNode(account_id="2")]
        edges = [GraphEdge(src_id="1", dst_id="2", edge_type="direct", weight=5.0)]
        initial = {"1": (-50.0, 0.0, 0.0), "2": (50.0, 0.0, 0.0)}
        
        final = force_directed_layout(nodes, edges, initial, max_iterations=50)
        
        x1, _, _ = final["1"]
        x2, _, _ = final["2"]
        
        # Distance should decrease
        initial_dist = 100.0
        final_dist = abs(x2 - x1)
        assert final_dist < initial_dist
    
    def test_unconnected_nodes_repel(self):
        """Unconnected nodes should repel each other."""
        nodes = [GraphNode(account_id="1"), GraphNode(account_id="2")]
        edges = []
        initial = {"1": (-1.0, 0.0, 0.0), "2": (1.0, 0.0, 0.0)}
        
        final = force_directed_layout(nodes, edges, initial, max_iterations=20)
        
        x1, _, _ = final["1"]
        x2, _, _ = final["2"]
        
        # Distance should increase
        initial_dist = 2.0
        final_dist = abs(x2 - x1)
        assert final_dist > initial_dist


class TestFrameBuilder:
    """Test FrameBuilder class."""
    
    def test_empty_frame_structure(self, db_session):
        """Test _empty_frame returns valid structure."""
        builder = FrameBuilder(db_session)
        
        frame = builder._empty_frame(timeframe_days=30)
        
        assert frame["nodes"] == []
        assert frame["edges"] == []
        assert frame["stats"]["nodeCount"] == 0
        assert frame["timeframe_days"] == 30
    
    def test_empty_frame_with_interval(self, db_session, sample_interval):
        """Test _empty_frame includes interval info."""
        builder = FrameBuilder(db_session)
        
        frame = builder._empty_frame(timeframe_days=30, interval=sample_interval)
        
        assert frame["interval_id"] == sample_interval.interval_id
    
    def test_build_frame_handles_empty_graph(self, db_session, sample_interval):
        """Test build_frame returns valid frame for empty graph."""
        builder = FrameBuilder(db_session)
        
        frame = builder.build_frame(sample_interval, timeframe_days=30)
        
        assert "nodes" in frame
        assert "edges" in frame
        assert "stats" in frame
    
    def test_build_frame_handles_none_interval(self, db_session):
        """Test build_frame handles None interval gracefully."""
        builder = FrameBuilder(db_session)
        
        frame = builder.build_frame(None, timeframe_days=30)
        
        assert frame["nodes"] == []
        assert frame["stats"]["nodeCount"] == 0
    
    def test_compute_importance(self, db_session, sample_accounts):
        """Test importance calculation."""
        builder = FrameBuilder(db_session)
        
        nodes = {
            acc.account_id: GraphNode(
                account_id=acc.account_id,
                followers_count=acc.followers_count
            )
            for acc in sample_accounts[:3]
        }
        
        edges = [
            GraphEdge(src_id="acc_0", dst_id="acc_1", edge_type="direct", weight=2.0),
            GraphEdge(src_id="acc_1", dst_id="acc_2", edge_type="direct", weight=3.0)
        ]
        
        importance = builder.compute_importance(nodes, edges)
        
        # acc_1 has most edges, should have highest importance
        assert importance["acc_1"] > importance["acc_0"]
        assert importance["acc_1"] > importance["acc_2"]
    
    def test_prune_graph_respects_limits(self, db_session):
        """Test graph pruning respects node/edge limits."""
        builder = FrameBuilder(db_session)
        
        # Create many nodes
        nodes = {
            f"node_{i}": GraphNode(
                account_id=f"node_{i}",
                importance=1.0 / (i + 1)  # Decreasing importance
            )
            for i in range(100)
        }
        
        edges = [
            GraphEdge(src_id=f"node_{i}", dst_id=f"node_{i+1}", edge_type="direct", weight=1.0)
            for i in range(99)
        ]
        
        pruned_nodes, pruned_edges = builder.prune_graph(
            nodes, edges,
            max_nodes=10,
            max_edges=5
        )
        
        assert len(pruned_nodes) <= 10
        assert len(pruned_edges) <= 5


class TestFramePersistence:
    """Test frame saving and retrieval."""
    
    def test_save_frame_creates_records(self, db_session, sample_interval, sample_accounts):
        """Test save_frame creates all required database records."""
        builder = FrameBuilder(db_session)
        
        frame_data = {
            "interval_id": sample_interval.interval_id,
            "timeframe_days": 30,
            "timestamp": utc_now().isoformat(),
            "nodes": [
                {"id": "acc_0", "handle": "user0", "name": "User 0",
                 "avatar": None, "followers": 100, "importance": 0.8,
                 "community": 0, "x": 10.0, "y": 20.0, "z": 5.0, "isNew": True},
                {"id": "acc_1", "handle": "user1", "name": "User 1",
                 "avatar": None, "followers": 200, "importance": 0.6,
                 "community": 0, "x": 15.0, "y": 25.0, "z": 8.0, "isNew": False}
            ],
            "edges": [
                {"source": "acc_0", "target": "acc_1", "type": "direct_interaction", "weight": 2.5}
            ],
            "communities": [0],
            "stats": {"nodeCount": 2, "edgeCount": 1, "communityCount": 1, "newFollowers": 1}
        }
        
        frame = builder.save_frame(sample_interval, frame_data, timeframe_window=30)
        
        # Verify frame record
        assert frame.id is not None
        assert frame.node_count == 2
        assert frame.edge_count == 1
        
        # Verify positions were saved
        positions = db_session.query(Position).filter(
            Position.interval_id == sample_interval.interval_id
        ).all()
        assert len(positions) == 2
        
        # Verify position history was saved
        history = db_session.query(PositionHistory).filter(
            PositionHistory.interval_id == sample_interval.interval_id
        ).all()
        assert len(history) == 2
        
        # Verify edges were saved
        edges = db_session.query(Edge).filter(
            Edge.interval_id == sample_interval.interval_id
        ).all()
        assert len(edges) == 1
        
        # Verify communities were saved
        communities = db_session.query(Community).filter(
            Community.interval_id == sample_interval.interval_id
        ).all()
        assert len(communities) == 2
    
    def test_get_frame_retrieves_data(self, db_session, sample_interval):
        """Test get_frame retrieves saved frame."""
        builder = FrameBuilder(db_session)
        
        frame_data = {
            "interval_id": sample_interval.interval_id,
            "timeframe_days": 30,
            "timestamp": utc_now().isoformat(),
            "nodes": [{"id": "test", "handle": "test", "name": "Test",
                       "avatar": None, "followers": 100, "importance": 1.0,
                       "community": 0, "x": 0, "y": 0, "z": 0, "isNew": False}],
            "edges": [],
            "communities": [0],
            "stats": {"nodeCount": 1, "edgeCount": 0, "communityCount": 1, "newFollowers": 0}
        }
        
        builder.save_frame(sample_interval, frame_data, timeframe_window=30)
        
        retrieved = builder.get_frame(
            interval_id=sample_interval.interval_id,
            timeframe_window=30
        )
        
        assert retrieved is not None
        assert retrieved["interval_id"] == sample_interval.interval_id
        assert len(retrieved["nodes"]) == 1
    
    def test_get_frame_returns_none_for_missing(self, db_session):
        """Test get_frame returns None when no frame exists."""
        builder = FrameBuilder(db_session)
        
        result = builder.get_frame(interval_id=999, timeframe_window=30)
        
        assert result is None


class TestEdgeWeights:
    """Test edge weight constants."""
    
    def test_reply_weight_highest(self):
        """Reply should have highest weight."""
        assert EDGE_WEIGHTS["reply"] >= EDGE_WEIGHTS["quote"]
        assert EDGE_WEIGHTS["reply"] >= EDGE_WEIGHTS["mention"]
        assert EDGE_WEIGHTS["reply"] >= EDGE_WEIGHTS["retweet"]
    
    def test_all_weights_positive(self):
        """All edge weights should be positive."""
        for weight in EDGE_WEIGHTS.values():
            assert weight > 0


class TestBuildEdgesFromInteractions:
    """Test interaction edge building."""
    
    def test_builds_edges_with_decay(self, db_session, sample_interval, sample_accounts):
        """Test edge building applies recency decay."""
        # Create interaction event
        event = InteractionEvent(
            interval_id=sample_interval.interval_id,
            created_at=datetime.now(timezone.utc) - timedelta(days=7),
            src_id="acc_0",
            dst_id="acc_1",
            interaction_type="reply"
        )
        db_session.add(event)
        db_session.commit()
        
        edges = build_edges_from_interactions(
            db_session, sample_interval, timeframe_days=30
        )
        
        assert len(edges) == 1
        # Weight should be reduced by decay
        base_weight = EDGE_WEIGHTS["reply"]
        assert edges[0].weight < base_weight
    
    def test_empty_interactions_returns_empty(self, db_session, sample_interval):
        """Test returns empty list when no interactions."""
        edges = build_edges_from_interactions(
            db_session, sample_interval, timeframe_days=30
        )
        
        assert edges == []
