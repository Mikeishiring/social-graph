// Graph Theme - Minimal Neural Network Style
// See DESIGN_BIBLE.md for full specifications

// Node colors - muted, subtle palette
export const NODE_COLORS = {
  ring: '#ffffff',
  ringStroke: 'rgba(0, 0, 0, 0.08)',
  small: '#94a3b8',        // slate-400
  smallBorder: '#cbd5e1',  // slate-300
  highlight: '#3b82f6',    // blue-500
};

// Edge colors - visible on light background
export const EDGE_COLORS = {
  default: '#64748b',      // slate-500 - more visible
  highlight: '#475569',    // slate-600
  selected: '#334155',     // slate-700
  ego: '#3b82f6',          // blue-500 - YOUR connections (legacy)
  // Directional edge colors
  you_follow: '#3b82f6',   // blue-500 - people YOU follow
  followers_you: '#22c55e', // green-500 - people who follow YOU
  mutual: '#a855f7',       // purple-500 - mutual connections
  network: '#94a3b8',      // slate-400 - connections between others in your network
  // 6-Tier hierarchical colors (warm to cool gradient)
  tier_1_ego: '#ef4444',      // red-500 - direct to ego (100k+)
  tier_2_hub: '#f97316',      // orange-500 - major hubs (50k-100k)
  tier_3_bridge: '#eab308',   // yellow-500 - bridge nodes (10k-50k)
  tier_4_cluster: '#22c55e',  // green-500 - cluster cores (5k-10k)
  tier_5_outer: '#06b6d4',    // cyan-500 - outer ring (2k-5k)
  tier_6_leaf: '#94a3b8',     // slate-400 - leaf nodes (<2k)
  fallback_ego: '#3b82f6',    // blue-500 - fallback to ego
};

// Edge opacity levels - increased for visibility
export const EDGE_OPACITY = {
  default: 0.4,
  ego: 0.7,                // Your connections more visible
  hover: 0.8,
  selected: 0.9,
  dimmed: 0.15,
};

// Node size thresholds (by importance percentile)
export const NODE_TIERS = {
  hub: {
    threshold: 0.95,       // top 5%
    minSize: 1.8,
    maxSize: 3.0,
    showAvatar: true,
    ringWidth: 0.15,
  },
  notable: {
    threshold: 0.75,       // top 25%
    minSize: 0.8,
    maxSize: 1.6,
    showAvatar: true,
    ringWidth: 0.1,
  },
  background: {
    threshold: 0,
    minSize: 0.25,
    maxSize: 0.6,
    showAvatar: false,
    ringWidth: 0,
  },
};

// Community colors - soft pastels that work on light background
export const COMMUNITY_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
];

// Action ping colors - subtle, distinct
export const ACTION_COLORS = {
  like: '#f59e0b',    // amber-500
  reply: '#3b82f6',   // blue-500
  mention: '#10b981', // emerald-500
  quote: '#8b5cf6',   // violet-500
  retweet: '#22c55e', // green-500
  repost: '#22c55e',  // green-500
  default: '#94a3b8', // slate-400
};

// Legacy exports for compatibility (edges all same color now)
export const EDGE_TYPE_COLORS: Record<string, string> = {
  direct_interaction: EDGE_COLORS.default,
  co_engagement: EDGE_COLORS.default,
  ego_follow: EDGE_COLORS.default,
};

export const EDGE_TYPE_LABELS: Record<string, string> = {
  direct_interaction: 'Direct',
  co_engagement: 'Co-engage',
  ego_follow: 'Follow',
};
