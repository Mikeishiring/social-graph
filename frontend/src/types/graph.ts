export interface PersonNode {
  id: string
  type: 'person'
  username: string
  display_name: string
  profile_image_url: string | null
  local_avatar_path: string | null
  followers: number
  following: number
  degree: number
  community_id: number
  is_main_character: boolean
  first_seen: string | null
  last_seen?: string | null

  // Counts relative to the main character (when available)
  inbound_count?: number
  outbound_count?: number
  interaction_count?: number

  // Recency-weighted tie strength (when available)
  inbound_strength?: number
  outbound_strength?: number
  strength?: number

  // Force graph positioning (set for main character)
  fx?: number
  fy?: number

  // Runtime properties added by force graph
  x?: number
  y?: number
  vx?: number
  vy?: number
}

export interface TweetNode {
  id: string
  type: 'tweet'
  content: string
  timestamp: string
  url: string
  likes: number
  retweets: number
  replies: number

  // Runtime properties added by force graph
  x?: number
  y?: number
  vx?: number
  vy?: number
}

export type GraphNode = PersonNode | TweetNode

export interface GraphEdgeExample {
  ts: string
  tweet_id?: string | null
  url?: string | null
  text?: string | null
}

export interface GraphEdge {
  source: string | GraphNode
  target: string | GraphNode
  type: 'mentioned' | 'replied_to' | 'followed' | 'quoted' | 'posted' | string

  // Aggregated edges
  count?: number
  weight?: number
  first_ts?: string
  last_ts?: string
  examples?: GraphEdgeExample[]

  // Back-compat: older datasets may include a single timestamp
  timestamp?: string
}

export interface GraphEvent {
  id?: string
  ts: string
  type: 'mentioned' | 'replied_to' | 'followed' | 'quoted' | 'posted' | string
  source: string
  target: string
  tweet_id?: string | null
  url?: string | null
  text?: string | null
}

export interface GraphMeta {
  generated_at: string
  total_nodes: number
  total_edges: number
  total_persons: number
  communities: number
  total_events?: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  events?: GraphEvent[]
  main_character: string
  meta: GraphMeta
}

// For react-force-graph
export interface ForceGraphData {
  nodes: GraphNode[]
  links: GraphEdge[]
}
