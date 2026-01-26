"""Frame builder - computes graph edges, communities, positions, and frames.

Implements the graph computation from AGENTS.md:
1. Build edges from interaction_events and post_engagers
2. Apply weights and recency decay
3. Community detection (Louvain)
4. Position calculation with layout stability
5. Frame JSON generation
"""
import json
import logging
import math
import random
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List, Set, Tuple
from dataclasses import dataclass, asdict

from sqlalchemy.orm import Session
from sqlalchemy import func

from .models import (
    Interval, Edge, Community, Position, PositionHistory, Frame,
    InteractionEvent, PostEngager, Account, FollowEvent
)
from .config import settings


logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    """Return timezone-aware UTC now."""
    return datetime.now(timezone.utc)


# =============================================================================
# Default Parameters from AGENTS.md
# =============================================================================

EDGE_WEIGHTS = {
    "reply": 4,
    "quote": 3,
    "mention": 2,
    "retweet": 1,
    "like": 0.5,
}

RECENCY_DECAY_HALF_LIFE_DAYS = 14
CO_ENGAGEMENT_WINDOW_HOURS = 72
MAX_NODES_RENDERED = 2000
MAX_EDGES_RENDERED = 12000
MAX_EDGES_PER_NODE = 50
MIN_FOLLOWERS_FOR_DISPLAY = 500  # Filter out small accounts - only show meaningful connections

# 6-Tier Hierarchy Thresholds (for network routing)
TIER_THRESHOLDS = {
    1: 100_000,  # 100k+ -> connect to ego
    2: 50_000,   # 50k-100k -> connect to tier 1
    3: 10_000,   # 10k-50k -> connect to tier 2
    4: 5_000,    # 5k-10k -> connect to tier 3
    5: 2_000,    # 2k-5k -> connect to tier 4
    6: 0,        # <2k -> connect to tier 5
}

TIER_EDGE_TYPES = {
    1: "tier_1_ego",
    2: "tier_2_hub",
    3: "tier_3_bridge",
    4: "tier_4_cluster",
    5: "tier_5_outer",
    6: "tier_6_leaf",
}

TIER_WEIGHTS = {
    1: 0.9,
    2: 0.7,
    3: 0.5,
    4: 0.4,
    5: 0.3,
    6: 0.2,
}


def classify_follower_tier(followers_count: int) -> int:
    """Classify account into tier 1-6 based on follower count."""
    if followers_count >= 100_000:
        return 1
    elif followers_count >= 50_000:
        return 2
    elif followers_count >= 10_000:
        return 3
    elif followers_count >= 5_000:
        return 4
    elif followers_count >= 2_000:
        return 5
    else:
        return 6


@dataclass
class GraphNode:
    """Node for graph computation."""
    account_id: str
    handle: Optional[str] = None
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    followers_count: int = 0
    importance: float = 0.0
    community_id: int = 0
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    is_new: bool = False  # New in this interval
    is_ego: bool = False  # The central user (you)


@dataclass
class GraphEdge:
    """Edge for graph computation."""
    src_id: str
    dst_id: str
    edge_type: str
    weight: float
    meta: dict = None


# =============================================================================
# Recency Decay
# =============================================================================

def compute_recency_decay(event_time: datetime, reference_time: datetime) -> float:
    """
    Compute recency decay factor using exponential decay.
    
    decay = 2^(-days_ago / half_life)
    """
    if not event_time or not reference_time:
        return 1.0
    
    days_ago = (reference_time - event_time).total_seconds() / 86400
    if days_ago < 0:
        return 1.0
    
    return math.pow(2, -days_ago / RECENCY_DECAY_HALF_LIFE_DAYS)


# =============================================================================
# Edge Building
# =============================================================================

def build_edges_from_interactions(
    db: Session,
    interval: Interval,
    timeframe_days: int = 30,
    reference_time: datetime = None
) -> List[GraphEdge]:
    """
    Build direct interaction edges from interaction_events.
    Edge direction: src (interactor) -> dst (target of interaction)
    """
    if not reference_time:
        reference_time = interval.end_at
    
    # Determine time window
    if timeframe_days > 0:
        window_start = reference_time - timedelta(days=timeframe_days)
    else:
        window_start = datetime.min
    
    # Query interaction events
    events = db.query(InteractionEvent).filter(
        InteractionEvent.created_at >= window_start,
        InteractionEvent.created_at <= reference_time
    ).all()
    
    # Aggregate edges by (src, dst, type)
    edge_agg: Dict[Tuple[str, str, str], float] = defaultdict(float)
    
    for event in events:
        base_weight = EDGE_WEIGHTS.get(event.interaction_type, 1.0)
        decay = compute_recency_decay(event.created_at, reference_time)
        weight = base_weight * decay
        
        key = (event.src_id, event.dst_id, "direct_interaction")
        edge_agg[key] += weight
    
    return [
        GraphEdge(src_id=src, dst_id=dst, edge_type=etype, weight=w)
        for (src, dst, etype), w in edge_agg.items()
    ]


def build_edges_from_coengagement(
    db: Session,
    interval: Interval,
    timeframe_days: int = 30,
    reference_time: datetime = None
) -> List[GraphEdge]:
    """
    Build co-engagement edges: accounts that engaged with the same post
    within the co-engagement window form an edge.
    
    Edge is undirected (we normalize to src < dst).
    """
    if not reference_time:
        reference_time = interval.end_at
    
    if timeframe_days > 0:
        window_start = reference_time - timedelta(days=timeframe_days)
    else:
        window_start = datetime.min
    
    # Query post engagers within window
    engagers = db.query(PostEngager).join(
        Interval, PostEngager.interval_id == Interval.interval_id
    ).filter(
        Interval.end_at >= window_start,
        Interval.end_at <= reference_time
    ).all()
    
    # Group by post
    post_engagers: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
    for pe in engagers:
        post_engagers[pe.post_id].append((pe.account_id, pe.engager_type))
    
    # Build co-engagement edges
    edge_agg: Dict[Tuple[str, str], float] = defaultdict(float)
    
    for post_id, engager_list in post_engagers.items():
        account_ids = list(set(aid for aid, _ in engager_list))
        
        # Create edges between all pairs
        for i, aid_i in enumerate(account_ids):
            for aid_j in account_ids[i + 1:]:
                # Normalize direction
                if aid_i < aid_j:
                    key = (aid_i, aid_j)
                else:
                    key = (aid_j, aid_i)
                
                edge_agg[key] += 1.0  # Count shared engagements
    
    return [
        GraphEdge(src_id=src, dst_id=dst, edge_type="co_engagement", weight=w)
        for (src, dst), w in edge_agg.items()
    ]


def build_ego_follow_edges(
    db: Session,
    interval: Interval,
    ego_id: str = None
) -> List[GraphEdge]:
    """
    Build ego follow edges from follow events in this interval.
    These are for inspection/attribution, not heavy in layout.
    """
    if not ego_id:
        return []

    follow_events = db.query(FollowEvent).filter(
        FollowEvent.interval_id == interval.interval_id,
        FollowEvent.kind == "new"
    ).all()

    return [
        GraphEdge(
            src_id=ego_id,
            dst_id=fe.account_id,
            edge_type="ego_follow",
            weight=0.5,
            meta={"kind": fe.kind}
        )
        for fe in follow_events
    ]


def build_edges_from_follow_events(
    db: Session,
    interval: Interval,
    existing_node_ids: Set[str] = None
) -> List[GraphEdge]:
    """
    Build edges connecting new followers to the existing network.

    Strategy:
    1. Connect new followers to EXISTING nodes (from previous intervals)
       based on follower count similarity - this makes the graph grow outward
    2. Connect new followers to each other in small clusters
    """
    from .models import SnapshotFollower, Snapshot

    # Get new followers in this interval
    new_followers = db.query(FollowEvent).filter(
        FollowEvent.interval_id == interval.interval_id,
        FollowEvent.kind == "new"
    ).all()

    if not new_followers:
        return []

    new_ids = set(fe.account_id for fe in new_followers)

    # Get existing nodes from previous intervals (nodes that aren't new)
    if existing_node_ids is None:
        # Query all accounts that were followers before this interval
        prev_snapshots = db.query(Snapshot).filter(
            Snapshot.kind == "followers",
            Snapshot.captured_at < interval.start_at
        ).all()

        existing_node_ids = set()
        for snap in prev_snapshots:
            for sf in snap.followers:
                existing_node_ids.add(sf.account_id)

    # Remove new IDs from existing (they're new, not existing)
    existing_node_ids = existing_node_ids - new_ids

    # Get account data for all relevant accounts
    all_ids = list(new_ids | existing_node_ids)
    accounts = db.query(Account).filter(
        Account.account_id.in_(all_ids)
    ).all()
    account_map = {a.account_id: a for a in accounts}

    edges = []

    # 1. Connect each new follower to nearby EXISTING nodes (growth edges)
    # This creates the "growing outward" effect
    existing_list = list(existing_node_ids)

    for new_id in new_ids:
        new_acc = account_map.get(new_id)
        if not new_acc:
            continue

        new_followers_count = new_acc.followers_count or 1

        # Find best matches in existing network based on follower tier
        candidates = []
        for exist_id in existing_list:
            exist_acc = account_map.get(exist_id)
            if not exist_acc:
                continue

            exist_followers = exist_acc.followers_count or 1

            # Calculate tier similarity (log scale)
            ratio = max(new_followers_count, exist_followers) / max(min(new_followers_count, exist_followers), 1)

            # Score: prefer similar tier accounts
            if ratio < 100:  # Within 2 orders of magnitude
                score = 1.0 / (1 + math.log10(ratio + 1))
                candidates.append((exist_id, score))

        # Connect to top 3-5 most similar existing nodes
        candidates.sort(key=lambda x: -x[1])
        for exist_id, score in candidates[:5]:
            edges.append(GraphEdge(
                src_id=exist_id,  # Existing node as source
                dst_id=new_id,    # New node as target (grows outward)
                edge_type="network_growth",
                weight=score
            ))

    # 2. Connect new followers to each other in small clusters
    # (accounts that joined together likely have affinity)
    new_list = list(new_ids)
    for i, id1 in enumerate(new_list):
        acc1 = account_map.get(id1)
        if not acc1:
            continue
        f1 = acc1.followers_count or 1

        # Only connect to a few nearby new nodes (limit clustering)
        connections = 0
        for id2 in new_list[i+1:]:
            if connections >= 3:  # Max 3 peer connections per node
                break

            acc2 = account_map.get(id2)
            if not acc2:
                continue
            f2 = acc2.followers_count or 1

            ratio = max(f1, f2) / max(min(f1, f2), 1)

            if ratio < 5:  # Very similar accounts
                weight = 0.5 / ratio
                edges.append(GraphEdge(
                    src_id=id1,
                    dst_id=id2,
                    edge_type="cohort",
                    weight=weight
                ))
                connections += 1

    return edges


# =============================================================================
# Community Detection (Simple Louvain)
# =============================================================================

def simple_community_detection(
    nodes: List[GraphNode],
    edges: List[GraphEdge]
) -> Dict[str, int]:
    """
    Simple community detection using label propagation.
    
    For production, use python-louvain or networkx.community,
    but this gives us a working baseline.
    """
    # Build adjacency with weights
    adjacency: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    
    for edge in edges:
        adjacency[edge.src_id][edge.dst_id] += edge.weight
        adjacency[edge.dst_id][edge.src_id] += edge.weight
    
    # Initialize: each node in its own community
    node_ids = [n.account_id for n in nodes]
    communities = {nid: i for i, nid in enumerate(node_ids)}
    
    # Label propagation iterations
    changed = True
    max_iterations = 10
    iteration = 0
    
    while changed and iteration < max_iterations:
        changed = False
        iteration += 1
        
        for node_id in node_ids:
            if node_id not in adjacency:
                continue
            
            # Count community weights among neighbors
            community_weights: Dict[int, float] = defaultdict(float)
            for neighbor_id, weight in adjacency[node_id].items():
                if neighbor_id in communities:
                    community_weights[communities[neighbor_id]] += weight
            
            if not community_weights:
                continue
            
            # Assign to highest-weight community
            best_community = max(community_weights.keys(), key=lambda c: community_weights[c])
            
            if communities[node_id] != best_community:
                communities[node_id] = best_community
                changed = True
    
    # Renumber communities to be contiguous
    unique_communities = sorted(set(communities.values()))
    remap = {old: new for new, old in enumerate(unique_communities)}
    
    return {nid: remap[cid] for nid, cid in communities.items()}


# =============================================================================
# Layout Computation (Force-Directed with Stability)
# =============================================================================

def compute_positions(
    db: Session,
    interval: Interval,
    nodes: List[GraphNode],
    edges: List[GraphEdge],
    communities: Dict[str, int],
    ego_id: str = None
) -> Dict[str, Tuple[float, float, float]]:
    """
    Compute node positions using force-directed layout with stability.

    - Ego user pinned at center (0, 0, 0)
    - Use previous positions as seeds when available
    - New nodes seeded near their strongest neighbor
    - Bounded iterations for stability
    """
    # Get previous positions if available
    prev_positions: Dict[str, Tuple[float, float, float]] = {}
    
    prev_interval = db.query(Interval).filter(
        Interval.interval_id < interval.interval_id
    ).order_by(Interval.interval_id.desc()).first()
    
    if prev_interval:
        prev_pos_records = db.query(Position).filter(
            Position.interval_id == prev_interval.interval_id
        ).all()
        prev_positions = {p.account_id: (p.x, p.y, p.z) for p in prev_pos_records}
    
    # Build adjacency for neighbor lookup
    adjacency: Dict[str, List[Tuple[str, float]]] = defaultdict(list)
    for edge in edges:
        adjacency[edge.src_id].append((edge.dst_id, edge.weight))
        adjacency[edge.dst_id].append((edge.src_id, edge.weight))
    
    # Initialize positions
    positions: Dict[str, Tuple[float, float, float]] = {}
    
    for node in nodes:
        if node.account_id in prev_positions:
            # Use previous position
            positions[node.account_id] = prev_positions[node.account_id]
        else:
            # Seed near strongest neighbor or use community-based position
            neighbors = adjacency.get(node.account_id, [])
            
            if neighbors:
                # Find strongest neighbor with a position
                neighbors.sort(key=lambda x: -x[1])
                for neighbor_id, _ in neighbors:
                    if neighbor_id in positions:
                        nx, ny, nz = positions[neighbor_id]
                        # Add small random offset
                        offset = 2.0
                        positions[node.account_id] = (
                            nx + random.uniform(-offset, offset),
                            ny + random.uniform(-offset, offset),
                            nz + random.uniform(-offset, offset)
                        )
                        break
            
            if node.account_id not in positions:
                # Use community-based positioning
                community = communities.get(node.account_id, 0)
                num_communities = max(len(set(communities.values())), 1)
                angle = community * 2.0 * math.pi / num_communities
                radius = 50 + (hash(node.account_id) % 30)
                
                positions[node.account_id] = (
                    radius * math.cos(angle) + random.uniform(-5, 5),
                    radius * math.sin(angle) + random.uniform(-5, 5),
                    random.uniform(-10, 10)
                )
    
    # Pin ego at center before layout
    if ego_id:
        positions[ego_id] = (0.0, 0.0, 0.0)

    # Simple force-directed relaxation (bounded iterations)
    positions = force_directed_layout(nodes, edges, positions, max_iterations=50, ego_id=ego_id)

    return positions


def force_directed_layout(
    nodes: List[GraphNode],
    edges: List[GraphEdge],
    initial_positions: Dict[str, Tuple[float, float, float]],
    max_iterations: int = 50,
    cooling_factor: float = 0.95,
    ego_id: str = None
) -> Dict[str, Tuple[float, float, float]]:
    """
    Simple 3D force-directed layout with ego node pinned at center.

    - Ego user stays at origin (0, 0, 0)
    - Repulsion between all nodes
    - Attraction along edges
    - Bounded iterations for stability
    """
    positions = dict(initial_positions)

    # Pin ego at center if specified
    if ego_id:
        positions[ego_id] = (0.0, 0.0, 0.0)

    # Parameters
    k_repulsion = 1000.0  # Repulsion constant
    k_attraction = 0.01   # Attraction constant
    temperature = 10.0    # Initial movement limit

    node_ids = [n.account_id for n in nodes]
    
    # Build edge lookup
    edge_pairs: Set[Tuple[str, str]] = set()
    edge_weights: Dict[Tuple[str, str], float] = {}
    
    for edge in edges:
        pair = (edge.src_id, edge.dst_id)
        edge_pairs.add(pair)
        edge_pairs.add((edge.dst_id, edge.src_id))
        edge_weights[pair] = edge.weight
        edge_weights[(edge.dst_id, edge.src_id)] = edge.weight
    
    for iteration in range(max_iterations):
        forces: Dict[str, Tuple[float, float, float]] = {nid: (0, 0, 0) for nid in node_ids}
        
        # Repulsion between all node pairs (O(n²) - fine for < 2000 nodes)
        for i, nid_i in enumerate(node_ids):
            if nid_i not in positions:
                continue
            xi, yi, zi = positions[nid_i]
            
            for nid_j in node_ids[i + 1:]:
                if nid_j not in positions:
                    continue
                xj, yj, zj = positions[nid_j]
                
                dx = xi - xj
                dy = yi - yj
                dz = zi - zj
                dist = math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01
                
                # Repulsion force
                force = k_repulsion / (dist * dist)
                fx = force * dx / dist
                fy = force * dy / dist
                fz = force * dz / dist
                
                forces[nid_i] = (forces[nid_i][0] + fx, forces[nid_i][1] + fy, forces[nid_i][2] + fz)
                forces[nid_j] = (forces[nid_j][0] - fx, forces[nid_j][1] - fy, forces[nid_j][2] - fz)
        
        # Attraction along edges
        for edge in edges:
            if edge.src_id not in positions or edge.dst_id not in positions:
                continue
            
            x1, y1, z1 = positions[edge.src_id]
            x2, y2, z2 = positions[edge.dst_id]
            
            dx = x2 - x1
            dy = y2 - y1
            dz = z2 - z1
            dist = math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01
            
            # Attraction force (proportional to distance and weight)
            force = k_attraction * dist * edge.weight
            fx = force * dx / dist
            fy = force * dy / dist
            fz = force * dz / dist
            
            forces[edge.src_id] = (forces[edge.src_id][0] + fx, forces[edge.src_id][1] + fy, forces[edge.src_id][2] + fz)
            forces[edge.dst_id] = (forces[edge.dst_id][0] - fx, forces[edge.dst_id][1] - fy, forces[edge.dst_id][2] - fz)
        
        # Apply forces with temperature limit
        for nid in node_ids:
            if nid not in positions:
                continue

            # Keep ego pinned at center
            if nid == ego_id:
                positions[nid] = (0.0, 0.0, 0.0)
                continue

            fx, fy, fz = forces[nid]
            force_mag = math.sqrt(fx * fx + fy * fy + fz * fz) + 0.01

            # Limit movement by temperature
            movement = min(force_mag, temperature)

            x, y, z = positions[nid]
            positions[nid] = (
                x + (fx / force_mag) * movement,
                y + (fy / force_mag) * movement,
                z + (fz / force_mag) * movement
            )

        # Cool down
        temperature *= cooling_factor

    # Ensure ego stays at center
    if ego_id:
        positions[ego_id] = (0.0, 0.0, 0.0)

    return positions


# =============================================================================
# Frame Builder
# =============================================================================

class FrameBuilder:
    """Builds visualization frames from intervals."""
    
    def __init__(self, db: Session):
        self.db = db
    
    def _empty_frame(
        self,
        timeframe_days: int = 30,
        interval: Optional[Interval] = None
    ) -> dict:
        """Return an empty frame structure for edge cases."""
        timestamp = interval.end_at.isoformat() if interval and interval.end_at else utc_now().isoformat()
        interval_id = interval.interval_id if interval else 0
        
        return {
            "interval_id": interval_id,
            "timeframe_days": timeframe_days,
            "timestamp": timestamp,
            "nodes": [],
            "edges": [],
            "communities": [],
            "stats": {
                "nodeCount": 0,
                "edgeCount": 0,
                "communityCount": 0,
                "newFollowers": 0
            }
        }
    
    def get_accounts_for_frame(
        self,
        interval: Interval,
        account_ids: Set[str]
    ) -> Dict[str, GraphNode]:
        """Load account data for nodes."""
        accounts = self.db.query(Account).filter(
            Account.account_id.in_(account_ids)
        ).all()
        
        # Get new followers in this interval
        new_follower_ids = set(
            fe.account_id for fe in self.db.query(FollowEvent).filter(
                FollowEvent.interval_id == interval.interval_id,
                FollowEvent.kind == "new"
            ).all()
        )
        
        nodes = {}
        for acc in accounts:
            nodes[acc.account_id] = GraphNode(
                account_id=acc.account_id,
                handle=acc.handle,
                name=acc.name,
                avatar_url=acc.avatar_url,
                followers_count=acc.followers_count or 0,
                is_new=acc.account_id in new_follower_ids
            )
        
        return nodes
    
    def compute_importance(
        self,
        nodes: Dict[str, GraphNode],
        edges: List[GraphEdge]
    ) -> Dict[str, float]:
        """
        Compute importance score for each node.
        Based on: edge weight sum + follower count (normalized).
        """
        edge_weights: Dict[str, float] = defaultdict(float)
        
        for edge in edges:
            edge_weights[edge.src_id] += edge.weight
            edge_weights[edge.dst_id] += edge.weight
        
        # Normalize
        max_edge_weight = max(edge_weights.values()) if edge_weights else 1.0
        max_followers = max((n.followers_count for n in nodes.values()), default=1)
        max_followers_log = math.log1p(max_followers) if max_followers > 0 else 1.0

        importance = {}
        for account_id, node in nodes.items():
            edge_score = edge_weights.get(account_id, 0) / max_edge_weight
            follower_score = math.log1p(node.followers_count) / max_followers_log
            importance[account_id] = 0.7 * edge_score + 0.3 * follower_score
        
        return importance
    
    def prune_graph(
        self,
        nodes: Dict[str, GraphNode],
        edges: List[GraphEdge],
        max_nodes: int = MAX_NODES_RENDERED,
        max_edges: int = MAX_EDGES_RENDERED,
        max_edges_per_node: int = MAX_EDGES_PER_NODE,
        min_followers: int = MIN_FOLLOWERS_FOR_DISPLAY
    ) -> Tuple[Dict[str, GraphNode], List[GraphEdge]]:
        """
        Prune graph to fit performance bounds.
        First filter by minimum follower count, then keep top nodes by importance.
        """
        # Filter out very small accounts first (reduces initial lag)
        if min_followers > 0:
            nodes = {
                aid: node for aid, node in nodes.items()
                if node.followers_count >= min_followers
            }
            logger.info(f"After min_followers filter ({min_followers}): {len(nodes)} nodes")

        # Compute importance
        importance = self.compute_importance(nodes, edges)

        # Update nodes with importance
        for account_id, imp in importance.items():
            if account_id in nodes:
                nodes[account_id].importance = imp

        # Prune nodes
        if len(nodes) > max_nodes:
            sorted_nodes = sorted(nodes.items(), key=lambda x: -x[1].importance)
            nodes = dict(sorted_nodes[:max_nodes])
        
        # Filter edges to only include kept nodes
        node_ids = set(nodes.keys())
        edges = [e for e in edges if e.src_id in node_ids and e.dst_id in node_ids]
        
        # Prune edges per node
        edge_by_node: Dict[str, List[GraphEdge]] = defaultdict(list)
        for edge in edges:
            edge_by_node[edge.src_id].append(edge)
            edge_by_node[edge.dst_id].append(edge)
        
        kept_edges: Set[Tuple[str, str, str]] = set()
        for node_id, node_edges in edge_by_node.items():
            # Keep top edges by weight
            sorted_edges = sorted(node_edges, key=lambda e: -e.weight)
            for edge in sorted_edges[:max_edges_per_node]:
                key = (min(edge.src_id, edge.dst_id), max(edge.src_id, edge.dst_id), edge.edge_type)
                kept_edges.add(key)
        
        edges = [
            e for e in edges
            if (min(e.src_id, e.dst_id), max(e.src_id, e.dst_id), e.edge_type) in kept_edges
        ]
        
        # Global edge cap
        if len(edges) > max_edges:
            edges = sorted(edges, key=lambda e: -e.weight)[:max_edges]
        
        return nodes, edges
    
    def build_frame(
        self,
        interval: Interval,
        timeframe_days: int = 30,
        ego_id: str = None
    ) -> dict:
        """
        Build a complete frame for visualization.

        Edge types:
        - followers_you: They follow you (green) - edge FROM them TO you
        - you_follow: You follow them (blue) - edge FROM you TO them
        - mutual: Both directions (purple)

        The goal: See who you followed first that led to others following them.
        """
        from .models import Snapshot, SnapshotFollower, SnapshotFollowing

        if not interval:
            logger.warning("build_frame called with None interval")
            return self._empty_frame(timeframe_days)

        reference_time = interval.end_at
        if not reference_time:
            logger.warning(f"Interval {interval.interval_id} has no end_at")
            reference_time = utc_now()

        # Get followers (people who follow YOU) up to this time
        follower_snapshots = self.db.query(Snapshot).filter(
            Snapshot.kind == "followers",
            Snapshot.captured_at <= reference_time
        ).order_by(Snapshot.captured_at.asc()).all()

        follower_ids: Set[str] = set()
        for snap in follower_snapshots:
            for sf in snap.followers:
                follower_ids.add(sf.account_id)

        # Get following (people YOU follow) up to this time
        following_snapshots = self.db.query(Snapshot).filter(
            Snapshot.kind == "following",
            Snapshot.captured_at <= reference_time
        ).order_by(Snapshot.captured_at.asc()).all()

        following_ids: Set[str] = set()
        for snap in following_snapshots:
            for sf in snap.following:
                following_ids.add(sf.account_id)

        # Calculate relationship types
        mutual_ids = follower_ids & following_ids
        only_followers = follower_ids - following_ids  # They follow you, you don't follow back
        only_following = following_ids - follower_ids  # You follow them, they don't follow back

        logger.info(f"Frame {interval.interval_id}: {len(follower_ids)} followers, {len(following_ids)} following, {len(mutual_ids)} mutual")

        # Get new followers in THIS interval (for highlighting)
        new_follower_ids: Set[str] = set()
        try:
            new_followers = self.db.query(FollowEvent).filter(
                FollowEvent.interval_id == interval.interval_id,
                FollowEvent.kind == "new"
            ).all()
            new_follower_ids = {fe.account_id for fe in new_followers}
        except Exception as e:
            logger.error(f"Failed to query follow events: {e}")

        # Build directional edges from ego
        all_edges: List[GraphEdge] = []

        # All relevant account IDs
        all_account_ids = follower_ids | following_ids
        if ego_id:
            all_account_ids.add(ego_id)

        # Handle empty graph case
        if not all_account_ids:
            logger.info(f"No accounts found for interval {interval.interval_id}")
            return self._empty_frame(timeframe_days, interval)

        # Get account data
        nodes = self.get_accounts_for_frame_cumulative(
            interval, all_account_ids, new_follower_ids, ego_id
        )

        # Prune nodes first (before adding ego edges)
        nodes, all_edges = self.prune_graph(nodes, all_edges)

        # After pruning, recalculate which IDs remain
        remaining_ids = set(nodes.keys())
        remaining_followers = follower_ids & remaining_ids
        remaining_following = following_ids & remaining_ids
        remaining_mutual = mutual_ids & remaining_ids

        # Add network edges (connections BETWEEN accounts in your network)
        # This creates the routing/topology instead of starburst
        from .models import NetworkConnection
        network_edges = self._build_network_edges(
            remaining_ids,
            ego_id,
            mutual_ids=remaining_mutual,
            follower_ids=remaining_followers,
            following_ids=remaining_following
        )
        all_edges.extend(network_edges)
        logger.info(f"Added {len(network_edges)} network edges between accounts")

        # Create directional edges from ego AFTER pruning
        # Only add ego edges for accounts NOT connected via network
        ego_edges = []
        if ego_id:
            # Ensure ego is in nodes
            if ego_id not in nodes:
                ego_account = self.db.query(Account).filter(Account.account_id == ego_id).first()
                if ego_account:
                    nodes[ego_id] = GraphNode(
                        account_id=ego_id,
                        handle=ego_account.handle,
                        name=ego_account.name,
                        avatar_url=ego_account.avatar_url,
                        followers_count=ego_account.followers_count or 0,
                        is_ego=True,
                        importance=1.0
                    )

            # Find accounts that have network connections
            accounts_with_network_edges = set()
            for edge in network_edges:
                accounts_with_network_edges.add(edge.src_id)
                accounts_with_network_edges.add(edge.dst_id)

            # First: ALL mutuals ALWAYS get a mutual edge to ego
            # (This includes hub mutuals that also have network edges)
            for account_id in remaining_mutual:
                if account_id == ego_id:
                    continue
                ego_edges.append(GraphEdge(
                    src_id=ego_id,
                    dst_id=account_id,
                    edge_type="mutual",
                    weight=1.0
                ))

            # Second: Non-mutuals WITHOUT network connections get direct ego edges
            # (This is the fallback for isolated nodes that couldn't route through mutuals)
            for account_id in remaining_ids:
                if account_id == ego_id:
                    continue
                if account_id in remaining_mutual:
                    continue  # Already handled above
                if account_id in accounts_with_network_edges:
                    continue  # Has network routing, no need for direct edge

                if account_id in remaining_following:
                    ego_edges.append(GraphEdge(
                        src_id=ego_id,
                        dst_id=account_id,
                        edge_type="you_follow",
                        weight=0.8
                    ))
                elif account_id in remaining_followers:
                    ego_edges.append(GraphEdge(
                        src_id=account_id,
                        dst_id=ego_id,
                        edge_type="followers_you",
                        weight=0.6
                    ))

            all_edges = ego_edges + all_edges
            logger.info(f"Added {len(ego_edges)} direct ego edges for unconnected accounts")

        # Community detection
        communities = simple_community_detection(list(nodes.values()), all_edges)

        # Update nodes with community (ego gets community 0)
        for account_id, community_id in communities.items():
            if account_id in nodes:
                nodes[account_id].community_id = community_id
        if ego_id and ego_id in nodes:
            nodes[ego_id].community_id = 0

        # Compute positions (ego pinned at center)
        positions = compute_positions(
            self.db, interval, list(nodes.values()), all_edges, communities, ego_id
        )

        # Update nodes with positions
        for account_id, (x, y, z) in positions.items():
            if account_id in nodes:
                nodes[account_id].x = x
                nodes[account_id].y = y
                nodes[account_id].z = z

        # Build frame JSON
        frame_data = {
            "interval_id": interval.interval_id,
            "timeframe_days": timeframe_days,
            "timestamp": reference_time.isoformat(),
            "ego_id": ego_id,
            "nodes": [
                {
                    "id": n.account_id,
                    "handle": n.handle,
                    "name": n.name,
                    "avatar": n.avatar_url,
                    "followers": n.followers_count,
                    "importance": round(n.importance, 4),
                    "community": n.community_id,
                    "x": round(n.x, 2),
                    "y": round(n.y, 2),
                    "z": round(n.z, 2),
                    "isNew": n.is_new,
                    "isEgo": n.is_ego
                }
                for n in nodes.values()
            ],
            "edges": [
                {
                    "source": e.src_id,
                    "target": e.dst_id,
                    "type": e.edge_type,
                    "weight": round(e.weight, 4)
                }
                for e in all_edges
            ],
            "communities": list(set(communities.values())),
            "stats": {
                "nodeCount": len(nodes),
                "edgeCount": len(all_edges),
                "communityCount": len(set(communities.values())),
                "newFollowers": len([n for n in nodes.values() if n.is_new])
            }
        }

        return frame_data

    def get_accounts_for_frame_cumulative(
        self,
        interval: Interval,
        account_ids: Set[str],
        new_follower_ids: Set[str],
        ego_id: str = None
    ) -> Dict[str, GraphNode]:
        """Load account data for nodes, marking which are new in this interval."""
        accounts = self.db.query(Account).filter(
            Account.account_id.in_(account_ids)
        ).all()

        nodes = {}
        for acc in accounts:
            is_ego = ego_id and acc.account_id == ego_id
            nodes[acc.account_id] = GraphNode(
                account_id=acc.account_id,
                handle=acc.handle,
                name=acc.name,
                avatar_url=acc.avatar_url,
                followers_count=acc.followers_count or 0,
                is_new=acc.account_id in new_follower_ids,
                is_ego=is_ego,
                importance=1.0 if is_ego else 0.0  # Ego has max importance
            )

        return nodes
    
    def save_frame(
        self,
        interval: Interval,
        frame_data: dict,
        timeframe_window: int = 30
    ) -> Frame:
        """Save computed frame to database."""
        # Delete existing data for this interval to allow rebuilds
        self.db.query(Edge).filter(Edge.interval_id == interval.interval_id).delete()
        self.db.query(Community).filter(Community.interval_id == interval.interval_id).delete()
        self.db.query(Position).filter(Position.interval_id == interval.interval_id).delete()
        self.db.query(Frame).filter(Frame.interval_id == interval.interval_id).delete()
        self.db.commit()

        # Store edges
        for edge_data in frame_data["edges"]:
            edge = Edge(
                interval_id=interval.interval_id,
                src_id=edge_data["source"],
                dst_id=edge_data["target"],
                edge_type=edge_data["type"],
                weight=edge_data["weight"]
            )
            self.db.add(edge)
        
        # Store communities
        for node_data in frame_data["nodes"]:
            community = Community(
                interval_id=interval.interval_id,
                account_id=node_data["id"],
                community_id=node_data["community"]
            )
            self.db.add(community)
            
            # Store position
            position = Position(
                interval_id=interval.interval_id,
                account_id=node_data["id"],
                x=node_data["x"],
                y=node_data["y"],
                z=node_data["z"]
            )
            self.db.add(position)
            
            # Also store to position history for stable timeline replay
            position_history = PositionHistory(
                interval_id=interval.interval_id,
                account_id=node_data["id"],
                x=node_data["x"],
                y=node_data["y"],
                z=node_data["z"],
                source="frame_build"
            )
            self.db.add(position_history)
        
        # Store frame
        frame = Frame(
            interval_id=interval.interval_id,
            timeframe_window=timeframe_window,
            frame_json=json.dumps(frame_data),
            node_count=frame_data["stats"]["nodeCount"],
            edge_count=frame_data["stats"]["edgeCount"],
            build_meta_json=json.dumps({
                "version": "1.0.0",
                "built_at": utc_now().isoformat()
            })
        )
        self.db.add(frame)
        self.db.commit()
        self.db.refresh(frame)
        
        return frame
    
    def _build_network_edges(
        self,
        account_ids: Set[str],
        ego_id: str = None,
        mutual_ids: Set[str] = None,
        follower_ids: Set[str] = None,
        following_ids: Set[str] = None
    ) -> List[GraphEdge]:
        """
        Build 6-tier hierarchical edges based on follower counts.

        Creates multi-hop paths instead of starburst:
        - Tier 1 (100k+) -> Ego
        - Tier 2 (50k-100k) -> Nearest Tier 1
        - Tier 3 (10k-50k) -> Nearest Tier 2
        - Tier 4 (5k-10k) -> Nearest Tier 3
        - Tier 5 (2k-5k) -> Nearest Tier 4
        - Tier 6 (<2k) -> Nearest Tier 5
        """
        edges = []

        # Get account data
        accounts = self.db.query(Account).filter(
            Account.account_id.in_(account_ids)
        ).all()
        account_map = {a.account_id: a for a in accounts}

        # Classify all accounts into tiers
        tier_buckets: Dict[int, List[str]] = defaultdict(list)
        account_tiers: Dict[str, int] = {}

        for aid in account_ids:
            if aid == ego_id:
                continue
            acc = account_map.get(aid)
            if not acc:
                continue
            tier = classify_follower_tier(acc.followers_count or 0)
            tier_buckets[tier].append(aid)
            account_tiers[aid] = tier

        # Sort each tier bucket by follower count (descending)
        for tier in tier_buckets:
            tier_buckets[tier].sort(
                key=lambda x: account_map.get(x, Account()).followers_count or 0,
                reverse=True
            )

        # Log tier distribution
        tier_counts = {t: len(ids) for t, ids in tier_buckets.items()}
        logger.info(f"Tier distribution: {tier_counts}")

        def find_nearest_in_tier(account_id: str, target_tier: int) -> Optional[str]:
            """Find nearest account in target tier by follower count similarity."""
            candidates = tier_buckets.get(target_tier, [])
            if not candidates:
                return None

            acc = account_map.get(account_id)
            if not acc:
                return candidates[0] if candidates else None

            acc_followers = acc.followers_count or 1
            best_match = None
            best_ratio = float('inf')

            # Check top candidates in tier (limit for performance)
            for cid in candidates[:50]:
                c_acc = account_map.get(cid)
                if not c_acc:
                    continue
                c_followers = c_acc.followers_count or 1
                # Ratio of larger to smaller - closer to 1 is better match
                ratio = max(acc_followers, c_followers) / max(min(acc_followers, c_followers), 1)
                if ratio < best_ratio:
                    best_ratio = ratio
                    best_match = cid

            return best_match or (candidates[0] if candidates else None)

        def find_any_higher_tier(account_id: str, current_tier: int) -> Optional[tuple]:
            """Find any account in a higher tier, searching upward."""
            for search_tier in range(current_tier - 1, 0, -1):
                target = find_nearest_in_tier(account_id, search_tier)
                if target:
                    return (target, search_tier)
            return None

        # Build hierarchical edges from lowest tier to highest
        for tier in range(6, 0, -1):
            accounts_in_tier = tier_buckets.get(tier, [])

            for aid in accounts_in_tier:
                # Mutuals are handled separately (connect to ego)
                if mutual_ids and aid in mutual_ids:
                    continue

                if tier == 1:
                    # Tier 1 connects directly to ego
                    if ego_id:
                        edges.append(GraphEdge(
                            src_id=aid,
                            dst_id=ego_id,
                            edge_type=TIER_EDGE_TYPES[tier],
                            weight=TIER_WEIGHTS[tier]
                        ))
                else:
                    # Try to connect to the tier immediately above
                    target = find_nearest_in_tier(aid, tier - 1)

                    if target:
                        edges.append(GraphEdge(
                            src_id=aid,
                            dst_id=target,
                            edge_type=TIER_EDGE_TYPES[tier],
                            weight=TIER_WEIGHTS[tier]
                        ))
                    else:
                        # No accounts in tier above, search further up
                        result = find_any_higher_tier(aid, tier)
                        if result:
                            target, found_tier = result
                            edges.append(GraphEdge(
                                src_id=aid,
                                dst_id=target,
                                edge_type=TIER_EDGE_TYPES[tier],
                                weight=TIER_WEIGHTS[tier] * 0.8  # Slightly lower for skip
                            ))
                        elif ego_id and tier <= 3:
                            # High-tier fallback: connect to ego if no other option
                            edges.append(GraphEdge(
                                src_id=aid,
                                dst_id=ego_id,
                                edge_type="fallback_ego",
                                weight=0.4
                            ))

        logger.info(f"Created {len(edges)} hierarchical edges")
        return edges

    def build_and_save(
        self,
        interval_id: int,
        timeframe_days: int = 30,
        ego_id: str = None
    ) -> Frame:
        """Build frame for interval and save to database."""
        interval = self.db.query(Interval).filter(
            Interval.interval_id == interval_id
        ).first()

        if not interval:
            raise ValueError(f"Interval {interval_id} not found")

        frame_data = self.build_frame(interval, timeframe_days, ego_id)
        return self.save_frame(interval, frame_data, timeframe_days)
    
    def get_frame(
        self,
        interval_id: int = None,
        timeframe_window: int = 30
    ) -> Optional[dict]:
        """Get frame from database, or latest if no interval specified."""
        query = self.db.query(Frame).filter(
            Frame.timeframe_window == timeframe_window
        )
        
        if interval_id:
            query = query.filter(Frame.interval_id == interval_id)
        
        frame = query.order_by(Frame.created_at.desc()).first()
        
        if frame:
            return json.loads(frame.frame_json)
        
        return None
