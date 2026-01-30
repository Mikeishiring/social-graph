import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame, useThree, useLoader } from '@react-three/fiber';
import { Html, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { GraphData, GraphNode } from '../types';
import {
  NODE_COLORS,
  EDGE_COLORS,
  EDGE_OPACITY,
  NODE_TIERS,
} from '../graphTheme';
import { playHoverSound, playClickSound, playBubblePopSound } from '../sounds';
import { HeartbeatPulse } from './effects/HeartbeatPulse';
import { NodePersonality } from './effects/NodePersonality';
import { RippleEffect } from './effects/RippleEffect';
import ActionPings from './effects/ActionPings';

interface GraphViewerProps {
  data: GraphData;
  onNodeHover: (node: GraphNode | null) => void;
  onNodeClick: (node: GraphNode | null) => void;
  selectedNode: GraphNode | null;
  highlightedNodeIds?: Set<string>;
  focusMode?: boolean;
  heartbeatEnabled?: boolean;
  personalityEnabled?: boolean;
}

// Calculate node tier based on importance percentile
function getNodeTier(importance: number, maxImportance: number) {
  const percentile = maxImportance > 0 ? importance / maxImportance : 0;

  if (percentile >= NODE_TIERS.hub.threshold) return NODE_TIERS.hub;
  if (percentile >= NODE_TIERS.notable.threshold) return NODE_TIERS.notable;
  return NODE_TIERS.background;
}

// Glow ring component for selected nodes
function GlowRing({ size, intensity }: { size: number; intensity: number }) {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (ringRef.current) {
      // Breathing animation
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.15;
      ringRef.current.scale.setScalar(pulse);
      // Rotate slowly for shimmer effect
      ringRef.current.rotation.z += 0.005;
    }
  });

  return (
    <mesh ref={ringRef} position={[0, 0, -0.02]}>
      <ringGeometry args={[size * 1.2, size * 1.8, 32]} />
      <meshBasicMaterial
        color="#3b82f6"
        transparent
        opacity={intensity * 0.3}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// Particle system for hover effect
function HoverParticles({ active, size }: { active: boolean; size: number }) {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 12;

  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const vel = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = size * 1.5;
      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = Math.sin(angle) * radius;
      pos[i * 3 + 2] = 0;

      // Outward velocity
      vel[i * 3] = Math.cos(angle) * 0.02;
      vel[i * 3 + 1] = Math.sin(angle) * 0.02;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
    }

    return { positions: pos, velocities: vel };
  }, [size]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    return geo;
  }, [positions]);

  useFrame(() => {
    if (!particlesRef.current || !active) return;

    const posAttr = particlesRef.current.geometry.getAttribute('position');
    const posArray = posAttr.array as Float32Array;

    for (let i = 0; i < particleCount; i++) {
      posArray[i * 3] += velocities[i * 3];
      posArray[i * 3 + 1] += velocities[i * 3 + 1];
      posArray[i * 3 + 2] += velocities[i * 3 + 2];

      // Reset when too far
      const dist = Math.sqrt(
        posArray[i * 3] ** 2 + posArray[i * 3 + 1] ** 2
      );
      if (dist > size * 3) {
        const angle = (i / particleCount) * Math.PI * 2;
        posArray[i * 3] = Math.cos(angle) * size * 1.2;
        posArray[i * 3 + 1] = Math.sin(angle) * size * 1.2;
        posArray[i * 3 + 2] = 0;
      }
    }

    posAttr.needsUpdate = true;
  });

  if (!active) return null;

  return (
    <points ref={particlesRef} geometry={geometry}>
      <pointsMaterial
        color="#60a5fa"
        size={0.15}
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  );
}

// Avatar node with circular photo and white ring
function AvatarNode({
  node,
  size,
  ringWidth,
  isSelected,
  opacity,
  entranceDelay,
  onHover,
  onClick,
}: {
  node: GraphNode;
  size: number;
  ringWidth: number;
  isSelected: boolean;
  opacity: number;
  entranceDelay: number;
  onHover: (node: GraphNode | null) => void;
  onClick: (node: GraphNode) => void;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [entranceScale, setEntranceScale] = useState(0);
  const entranceStartTime = useRef<number | null>(null);

  // Load avatar texture with fallback
  const texture = useLoader(
    THREE.TextureLoader,
    node.avatar || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect fill="%2394a3b8" width="64" height="64"/><text x="32" y="40" font-size="28" fill="white" text-anchor="middle">' + (node.handle || node.id)[0].toUpperCase() + '</text></svg>'),
  );

  // Track if we've played the pop sound
  const hasPlayedPop = useRef(false);

  // Entrance animation with bubble pop physics
  useFrame((state) => {
    // Handle entrance animation
    if (entranceStartTime.current === null) {
      entranceStartTime.current = state.clock.elapsedTime + entranceDelay;
    }

    const elapsed = state.clock.elapsedTime - entranceStartTime.current;
    if (elapsed > 0 && entranceScale < 1) {
      // Bubble pop easing: elastic overshoot then settle
      const t = Math.min(1, elapsed / 0.5);
      // Elastic ease-out with overshoot
      const c4 = (2 * Math.PI) / 3;
      const bubble = t === 0 ? 0 : t === 1 ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
      setEntranceScale(Math.min(1.0, Math.max(0, bubble)));

      // Play pop sound at peak of overshoot (around t=0.3)
      if (!hasPlayedPop.current && t > 0.25 && t < 0.4) {
        // Pitch based on node size (smaller nodes = higher pitch)
        const pitch = 0.8 + (1 - size / 3) * 0.6;
        playBubblePopSound(pitch);
        hasPlayedPop.current = true;
      }
    }

    // Handle selection/hover animations
    if (meshRef.current) {
      let targetScale = entranceScale;

      if (isSelected) {
        // Gentle pulse for selected
        targetScale *= 1 + Math.sin(state.clock.elapsedTime * 2.5) * 0.08;
      } else if (hovered) {
        targetScale *= 1.15;
      }

      meshRef.current.scale.setScalar(targetScale);
    }
  });

  const actualSize = size;
  const ringColor = isSelected ? NODE_COLORS.highlight : NODE_COLORS.ring;

  return (
    <Billboard
      follow={true}
      lockX={false}
      lockY={false}
      lockZ={false}
      position={[node.x, node.y, node.z]}
    >
      <group
        ref={meshRef}
        onPointerEnter={(e) => {
          e.stopPropagation();
          setHovered(true);
          onHover(node);
          playHoverSound();
          document.body.style.cursor = 'pointer';
        }}
        onPointerLeave={() => {
          setHovered(false);
          onHover(null);
          document.body.style.cursor = 'auto';
        }}
        onClick={(e) => {
          e.stopPropagation();
          playClickSound();
          onClick(node);
        }}
      >
        {/* Glow ring for selected */}
        {isSelected && <GlowRing size={actualSize} intensity={1} />}

        {/* Particle effect on hover */}
        <HoverParticles active={hovered && !isSelected} size={actualSize} />

        {/* White ring background */}
        <mesh>
          <circleGeometry args={[actualSize + ringWidth, 32]} />
          <meshBasicMaterial
            color={ringColor}
            transparent
            opacity={opacity}
          />
        </mesh>

        {/* Avatar circle */}
        <mesh position={[0, 0, 0.01]}>
          <circleGeometry args={[actualSize, 32]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={opacity}
          />
        </mesh>

        {/* Subtle shadow ring */}
        <mesh position={[0.05, -0.05, -0.01]}>
          <circleGeometry args={[actualSize + ringWidth, 32]} />
          <meshBasicMaterial
            color="#000000"
            transparent
            opacity={opacity * 0.08}
          />
        </mesh>
      </group>
    </Billboard>
  );
}

// Simple dot node for background nodes
function DotNode({
  node,
  size,
  isSelected,
  isHighlighted,
  opacity,
  entranceDelay,
  onHover,
  onClick,
}: {
  node: GraphNode;
  size: number;
  isSelected: boolean;
  isHighlighted: boolean;
  opacity: number;
  entranceDelay: number;
  onHover: (node: GraphNode | null) => void;
  onClick: (node: GraphNode) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [entranceScale, setEntranceScale] = useState(0);
  const entranceStartTime = useRef<number | null>(null);

  useFrame((state) => {
    // Handle entrance animation
    if (entranceStartTime.current === null) {
      entranceStartTime.current = state.clock.elapsedTime + entranceDelay;
    }

    const elapsed = state.clock.elapsedTime - entranceStartTime.current;
    if (elapsed > 0 && entranceScale < 1) {
      // Bubble pop for dots - simpler but still bouncy
      const t = Math.min(1, elapsed / 0.35);
      // Quick elastic pop
      const bounce = t < 0.6
        ? 1.15 * (1 - Math.pow(1 - t / 0.6, 3))  // Overshoot to 1.15
        : 1 + 0.15 * Math.pow(1 - (t - 0.6) / 0.4, 2);  // Settle back to 1
      setEntranceScale(Math.min(1, bounce));
    }

    if (meshRef.current) {
      const targetScale = entranceScale * (hovered ? 1.4 : 1);
      meshRef.current.scale.lerp(
        new THREE.Vector3(targetScale, targetScale, targetScale),
        0.15
      );
    }
  });

  // Use community color with low saturation for dots
  const color = isHighlighted
    ? NODE_COLORS.highlight
    : (isSelected ? NODE_COLORS.highlight : NODE_COLORS.small);

  return (
    <Billboard
      follow={true}
      lockX={false}
      lockY={false}
      lockZ={false}
      position={[node.x, node.y, node.z]}
    >
      <mesh
        ref={meshRef}
        onPointerEnter={(e) => {
          e.stopPropagation();
          setHovered(true);
          onHover(node);
          playHoverSound();
          document.body.style.cursor = 'pointer';
        }}
        onPointerLeave={() => {
          setHovered(false);
          onHover(null);
          document.body.style.cursor = 'auto';
        }}
        onClick={(e) => {
          e.stopPropagation();
          playClickSound();
          onClick(node);
        }}
      >
        <circleGeometry args={[size, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
        />
      </mesh>
    </Billboard>
  );
}

// Wrapper component that chooses avatar or dot based on tier
function NodeMesh({
  node,
  maxImportance,
  isSelected,
  isConnected,
  hasSelection,
  isHighlighted,
  hasHighlight,
  entranceDelay,
  onHover,
  onClick,
  nodeCount,
  personalityEnabled,
}: {
  node: GraphNode;
  maxImportance: number;
  isSelected: boolean;
  isConnected: boolean;
  hasSelection: boolean;
  isHighlighted: boolean;
  hasHighlight: boolean;
  entranceDelay: number;
  onHover: (node: GraphNode | null) => void;
  onClick: (node: GraphNode) => void;
  nodeCount: number;
  personalityEnabled: boolean;
}) {
  // Disable personality animation for performance when many nodes, or when toggled off
  const enablePersonality = personalityEnabled && nodeCount < 600 && !hasSelection;

  // Ego node gets special treatment - much larger, always shows avatar
  if (node.isEgo) {
    return (
      <NodePersonality nodeId={node.id} enabled={false}>
        <AvatarNode
          node={node}
          size={5.0}  // Much larger than other nodes
          ringWidth={0.3}
          isSelected={true}  // Always appear selected
          opacity={1}
          entranceDelay={0}  // Appear first
          onHover={onHover}
          onClick={onClick}
        />
      </NodePersonality>
    );
  }

  const tier = getNodeTier(node.importance, maxImportance);

  // Calculate size within tier range
  const normalizedImportance = maxImportance > 0 ? node.importance / maxImportance : 0;
  const size = tier.minSize + (tier.maxSize - tier.minSize) * normalizedImportance;

  // Calculate opacity based on selection/highlight state
  let opacity = 1;
  if (hasSelection) {
    opacity = isSelected || isConnected ? 1 : 0.2;
  } else if (hasHighlight) {
    opacity = isHighlighted ? 1 : 0.15;
  }

  // Determine if we should show avatar
  const showAvatar = tier.showAvatar && node.avatar;

  if (showAvatar) {
    return (
      <NodePersonality nodeId={node.id} enabled={enablePersonality}>
        <AvatarNode
          node={node}
          size={size}
          ringWidth={tier.ringWidth}
          isSelected={isSelected}
          opacity={opacity}
          entranceDelay={entranceDelay}
          onHover={onHover}
          onClick={onClick}
        />
      </NodePersonality>
    );
  }

  return (
    <NodePersonality nodeId={node.id} enabled={enablePersonality}>
      <DotNode
        node={node}
        size={size}
        isSelected={isSelected}
        isHighlighted={isHighlighted}
        opacity={opacity}
        entranceDelay={entranceDelay}
        onHover={onHover}
        onClick={onClick}
      />
    </NodePersonality>
  );
}

// Subtle edge line with directional colors
function EdgeLine({
  start,
  end,
  isHighlighted,
  isSelected,
  edgeType,
}: {
  start: [number, number, number];
  end: [number, number, number];
  isHighlighted: boolean;
  isSelected: boolean;
  edgeType: string;
}) {
  const lineRef = useRef<THREE.Line>(null);

  const geometry = useMemo(() => {
    const points = [new THREE.Vector3(...start), new THREE.Vector3(...end)];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [start, end]);

  // Get color based on edge type
  const getEdgeColor = () => {
    if (isSelected) return EDGE_COLORS.selected;
    if (isHighlighted) return EDGE_COLORS.highlight;

    // Check for tier-based colors first
    const tierColor = EDGE_COLORS[edgeType as keyof typeof EDGE_COLORS];
    if (tierColor) return tierColor;

    // Directional edge colors
    switch (edgeType) {
      case 'you_follow':
        return EDGE_COLORS.you_follow;  // Blue - you follow them
      case 'followers_you':
        return EDGE_COLORS.followers_you;  // Green - they follow you
      case 'mutual':
        return EDGE_COLORS.mutual;  // Purple - mutual
      case 'ego_connection':
        return EDGE_COLORS.ego;
      case 'network':
        return EDGE_COLORS.network;  // Gray - connections between others
      default:
        return EDGE_COLORS.default;
    }
  };

  // Ego-related, tier, and network edges are more visible
  const isTierEdge = edgeType.startsWith('tier_') || edgeType === 'fallback_ego';
  const isEgoRelated = isTierEdge || ['you_follow', 'followers_you', 'mutual', 'ego_connection', 'network'].includes(edgeType);
  const opacity = isSelected
    ? EDGE_OPACITY.selected
    : (isEgoRelated ? EDGE_OPACITY.ego : (isHighlighted ? EDGE_OPACITY.hover : EDGE_OPACITY.default));

  const color = getEdgeColor();

  const material = useMemo(() => {
    return new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
    });
  }, [color, opacity]);

  return <primitive ref={lineRef} object={new THREE.Line(geometry, material)} />;
}

// Floating labels for top nodes
function NodeLabels({
  nodes,
  maxLabels = 10,
}: {
  nodes: GraphNode[];
  maxLabels?: number;
}) {
  const topNodes = useMemo(() => {
    if (maxLabels <= 0) return [];
    return [...nodes]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, maxLabels);
  }, [nodes, maxLabels]);

  return (
    <>
      {topNodes.map((node) => (
        <Html
          key={node.id}
          position={[node.x, node.y + 2.5, node.z]}
          center
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          <div className="node-label">
            @{node.handle || node.id.slice(0, 8)}
          </div>
        </Html>
      ))}
    </>
  );
}

// Ambient floating particles in background
function AmbientParticles({ bounds }: { bounds: number }) {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 50;

  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const vel = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      pos[i * 3] = (Math.random() - 0.5) * bounds * 2;
      pos[i * 3 + 1] = (Math.random() - 0.5) * bounds * 2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * bounds * 2;

      vel[i * 3] = (Math.random() - 0.5) * 0.02;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }

    return { positions: pos, velocities: vel };
  }, [bounds]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  useFrame(() => {
    if (!particlesRef.current) return;

    const posAttr = particlesRef.current.geometry.getAttribute('position');
    const posArray = posAttr.array as Float32Array;

    for (let i = 0; i < particleCount; i++) {
      posArray[i * 3] += velocities[i * 3];
      posArray[i * 3 + 1] += velocities[i * 3 + 1];
      posArray[i * 3 + 2] += velocities[i * 3 + 2];

      // Wrap around bounds
      for (let j = 0; j < 3; j++) {
        if (Math.abs(posArray[i * 3 + j]) > bounds) {
          posArray[i * 3 + j] *= -0.9;
        }
      }
    }

    posAttr.needsUpdate = true;
  });

  return (
    <points ref={particlesRef} geometry={geometry}>
      <pointsMaterial
        color="#cbd5e1"
        size={0.3}
        transparent
        opacity={0.4}
        sizeAttenuation
      />
    </points>
  );
}

export default function GraphViewer({
  data,
  onNodeHover,
  onNodeClick,
  selectedNode,
  highlightedNodeIds,
  focusMode = true,
  heartbeatEnabled = true,
  personalityEnabled = true,
}: GraphViewerProps) {
  const { camera } = useThree();
  const [dynamicLabelCap, setDynamicLabelCap] = useState(10);
  const frameStatsRef = useRef({ frames: 0, accum: 0, lastCap: 10 });
  const highlightSet = highlightedNodeIds ?? new Set<string>();
  const highlightActive = highlightSet.size > 0 && !selectedNode;
  const focusDim = highlightActive && focusMode;
  const [dataKey, setDataKey] = useState(0);

  // Progressive edge disclosure - start with 20, grow to 100 max
  const [visibleEdgeLimit, setVisibleEdgeLimit] = useState(20);

  // Ripple effect state - triggered on node click
  const [rippleNode, setRippleNode] = useState<GraphNode | null>(null);

  // Handle node click with ripple effect
  const handleNodeClick = (node: GraphNode | null) => {
    if (node) {
      setRippleNode(node);
    }
    onNodeClick(node);
  };

  // Reset entrance animations and edge limit when data changes
  useEffect(() => {
    setDataKey((k) => k + 1);
    setVisibleEdgeLimit(20); // Reset to initial state
  }, [data.nodes.length]);

  // Progressive edge reveal - grow from 20 to 100 over 3 seconds
  useEffect(() => {
    if (visibleEdgeLimit >= 100) return;
    const timer = setInterval(() => {
      setVisibleEdgeLimit((prev) => Math.min(prev + 10, 100));
    }, 300);
    return () => clearInterval(timer);
  }, [visibleEdgeLimit, data.nodes.length]);

  // Sort edges by importance (tier + weight) for progressive reveal
  const sortedEdges = useMemo(() => {
    const tierPriority: Record<string, number> = {
      mutual: 7,
      tier_1_ego: 6,
      you_follow: 5,
      tier_2_hub: 5,
      followers_you: 4,
      tier_3_bridge: 4,
      tier_4_cluster: 3,
      tier_5_outer: 2,
      tier_6_leaf: 1,
      fallback_ego: 1,
    };
    return [...data.edges].sort((a, b) => {
      const aPriority = tierPriority[a.type] || 0;
      const bPriority = tierPriority[b.type] || 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return b.weight - a.weight;
    });
  }, [data.edges]);

  // Visible edges based on current limit
  const visibleEdges = useMemo(() => {
    return sortedEdges.slice(0, visibleEdgeLimit);
  }, [sortedEdges, visibleEdgeLimit]);

  // Calculate max importance for scaling
  const maxImportance = useMemo(() => {
    return Math.max(...data.nodes.map((n) => n.importance), 0.01);
  }, [data.nodes]);

  // Calculate bounds for ambient particles
  const graphBounds = useMemo(() => {
    let maxDist = 50;
    data.nodes.forEach((node) => {
      const dist = Math.sqrt(node.x ** 2 + node.y ** 2 + node.z ** 2);
      if (dist > maxDist) maxDist = dist;
    });
    return maxDist * 1.2;
  }, [data.nodes]);

  // Dynamic label count based on FPS and zoom
  useFrame((_, delta) => {
    const stats = frameStatsRef.current;
    stats.frames += 1;
    stats.accum += delta;

    if (stats.accum >= 1) {
      const fps = stats.frames / stats.accum;
      const distance = camera.position.length();
      let cap = distance < 60 ? 12 : (distance < 100 ? 8 : (distance < 150 ? 5 : 0));

      if (fps < 35) cap = Math.min(cap, 4);
      if (fps < 25) cap = 0;

      if (cap !== stats.lastCap) {
        stats.lastCap = cap;
        setDynamicLabelCap(cap);
      }

      stats.frames = 0;
      stats.accum = 0;
    }
  });

  // Build node lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    data.nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [data.nodes]);

  // Connected nodes for selection highlighting (use visible edges)
  const connectedNodes = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const connected = new Set<string>();
    visibleEdges.forEach((edge) => {
      if (edge.source === selectedNode.id) connected.add(edge.target);
      if (edge.target === selectedNode.id) connected.add(edge.source);
    });
    return connected;
  }, [selectedNode, visibleEdges]);

  // Highlighted edges (use visible edges)
  const highlightedEdges = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const edges = new Set<string>();
    visibleEdges.forEach((edge) => {
      if (edge.source === selectedNode.id || edge.target === selectedNode.id) {
        edges.add(`${edge.source}-${edge.target}`);
      }
    });
    return edges;
  }, [selectedNode, visibleEdges]);

  // Calculate entrance delays based on importance (more important = earlier)
  const entranceDelays = useMemo(() => {
    const delays = new Map<string, number>();
    const sorted = [...data.nodes].sort((a, b) => b.importance - a.importance);
    sorted.forEach((node, index) => {
      // Stagger over 0.8 seconds, most important first
      delays.set(node.id, (index / sorted.length) * 0.8);
    });
    return delays;
  }, [data.nodes]);

  const baseLabelCap = data.nodes.length > 600 ? 0 : (data.nodes.length > 300 ? 6 : 10);
  const labelCap = Math.min(baseLabelCap, dynamicLabelCap);

  // Find the ego node for heartbeat effect
  const egoNode = useMemo(() => data.nodes.find(n => n.isEgo), [data.nodes]);

  return (
    <group key={dataKey}>
      {/* Ambient floating particles */}
      <AmbientParticles bounds={graphBounds} />

      {/* Heartbeat pulse emanating from ego node */}
      {egoNode && (
        <HeartbeatPulse
          position={[egoNode.x, egoNode.y, egoNode.z - 0.5]}
          enabled={heartbeatEnabled && !selectedNode}  // Disable when node selected or toggled off
          baseSize={5}
        />
      )}

      {/* Action pings (engagement pulses) */}
      <ActionPings
        events={data.actions ?? []}
        nodeMap={nodeMap}
        enabled={!selectedNode}
      />

      {/* Ripple effect on node click */}
      <RippleEffect
        sourceNode={rippleNode}
        nodes={data.nodes}
        edges={data.edges}
        onComplete={() => setRippleNode(null)}
      />

      {/* Edges - render first (behind nodes) - progressive disclosure */}
      {visibleEdges.map((edge, idx) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);

        if (!sourceNode || !targetNode) return null;

        // Check if this is an ego-related edge (directional connections or tier hierarchy)
        const isTierEdge = edge.type.startsWith('tier_') || edge.type === 'fallback_ego';
        const isEgoRelated = isTierEdge || ['you_follow', 'followers_you', 'mutual', 'ego_connection'].includes(edge.type);

        const isEdgeHighlighted = selectedNode
          ? highlightedEdges.has(`${edge.source}-${edge.target}`)
          : (highlightActive && highlightSet.has(edge.source) && highlightSet.has(edge.target));

        // Hide non-connected edges when selection/highlight active
        // BUT always show ego-related edges (your connections)
        if (selectedNode && !isEdgeHighlighted && !isEgoRelated) return null;
        if (focusDim && !isEdgeHighlighted && !isEgoRelated) return null;

        return (
          <EdgeLine
            key={`${edge.source}-${edge.target}-${idx}`}
            start={[sourceNode.x, sourceNode.y, sourceNode.z]}
            end={[targetNode.x, targetNode.y, targetNode.z]}
            isHighlighted={isEdgeHighlighted && !selectedNode}
            isSelected={isEdgeHighlighted && !!selectedNode}
            edgeType={edge.type}
          />
        );
      })}

      {/* Nodes */}
      {data.nodes.map((node) => (
        <NodeMesh
          key={node.id}
          node={node}
          maxImportance={maxImportance}
          isSelected={selectedNode?.id === node.id}
          isConnected={connectedNodes.has(node.id)}
          hasSelection={selectedNode !== null}
          isHighlighted={highlightActive && highlightSet.has(node.id)}
          hasHighlight={focusDim}
          entranceDelay={entranceDelays.get(node.id) ?? 0}
          onHover={onNodeHover}
          onClick={handleNodeClick}
          nodeCount={data.nodes.length}
          personalityEnabled={personalityEnabled}
        />
      ))}

      {/* Labels for top nodes */}
      <NodeLabels nodes={data.nodes} maxLabels={labelCap} />
    </group>
  );
}
