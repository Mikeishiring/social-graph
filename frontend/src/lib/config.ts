/**
 * Visual configuration for the social graph.
 * The key goal is a graph that stays readable as it grows: strong grouping, low visual noise.
 */
export const VISUAL_CONFIG = {
  // Colors
  background: '#ffffff',
  nodeBorderColor: '#e8e8e8',
  placeholderColor: '#d0d0d0',
  tooltipBackground: '#ffffff',
  tooltipBorder: '#e0e0e0',
  textPrimary: '#333333',
  textSecondary: '#888888',

  // Node sizes
  minNodeSize: 5,
  maxNodeSize: 26,
  mainCharacterSize: 44,

  // Border styling
  nodeBorderWidth: 1.5,

  // Link styling
  linkWidth: 0.6,
  linkWidthHighlight: 1.8,
  linkOpacity: 0.22,
  linkOpacitySecondary: 0.08,
  linkOpacityHighlight: 0.75,

  // Force simulation
  chargeStrength: -140,
  chargeDistanceMax: 900,
  linkDistance: 70,
  linkDistanceSecondary: 110,
  clusterRingRadius: 260,
  clusterStrength: 0.11,
  timelineStrength: 0.22,
  timelineMinRadius: 90,
  timelineMaxRadius: 640,
  collisionPadding: 4,

  // Animation / interaction
  warmupTicks: 120,
  cooldownTicks: 240,
  zoomDuration: 500,

  // Zoom limits
  minZoom: 0.1,
  maxZoom: 8,

  // Playback
  playbackFadeMs: 700,
  playbackRecentEdgeMs: 1400
} as const

/**
 * Community colors: soft pastels behind nodes.
 */
export const COMMUNITY_COLORS = [
  'rgba(99, 102, 241, 0.15)', // Indigo
  'rgba(236, 72, 153, 0.15)', // Pink
  'rgba(34, 197, 94, 0.15)', // Green
  'rgba(249, 115, 22, 0.15)', // Orange
  'rgba(6, 182, 212, 0.15)', // Cyan
  'rgba(168, 85, 247, 0.15)', // Purple
  'rgba(234, 179, 8, 0.15)', // Yellow
  'rgba(239, 68, 68, 0.15)' // Red
] as const

export function getCommunityColor(communityId: number): string {
  return COMMUNITY_COLORS[communityId % COMMUNITY_COLORS.length]
}

/**
 * Edge colors by interaction type. We vary alpha at render time.
 */
export const EDGE_RGB = {
  mentioned: [99, 102, 241], // Indigo
  replied_to: [34, 197, 94], // Green
  quoted: [249, 115, 22], // Orange
  followed: [107, 114, 128], // Gray
  liked: [236, 72, 153], // Pink
  retweeted: [6, 182, 212], // Cyan
  posted: [17, 24, 39] // Near-black
} as const

export function edgeRgba(type: keyof typeof EDGE_RGB | string, alpha: number): string {
  const rgb = (EDGE_RGB as Record<string, readonly [number, number, number]>)[type] || ([107, 114, 128] as const)
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}
