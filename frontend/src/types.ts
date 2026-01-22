/**
 * Type definitions for Social Graph visualization
 */

export interface GraphNode {
  id: string;
  handle: string | null;
  name: string | null;
  avatar: string | null;
  followers: number;
  importance: number;
  community: number;
  x: number;
  y: number;
  z: number;
  isNew: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'direct_interaction' | 'co_engagement' | 'ego_follow';
  weight: number;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  newFollowers?: number;
}

export interface GraphData {
  interval_id: number;
  timeframe_days: number;
  timestamp: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: number[];
  stats: GraphStats;
}

export interface ApiStats {
  total_runs: number;
  completed_runs: number;
  total_accounts: number;
  total_snapshots: number;
  total_intervals: number;
  latest_snapshot: {
    snapshot_id: number;
    captured_at: string;
    kind: string;
    account_count: number;
  } | null;
}

export interface FrameSummary {
  id: number;
  interval_id: number;
  timeframe_window: number;
  node_count: number;
  edge_count: number;
  created_at: string;
}
