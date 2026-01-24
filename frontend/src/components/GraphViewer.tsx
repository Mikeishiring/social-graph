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
import { playHoverSound, playClickSound } from '../sounds';

interface GraphViewerProps {
  data: GraphData;
  onNodeHover: (node: GraphNode | null) => void;
  onNodeClick: (node: GraphNode | null) => void;
  selectedNode: GraphNode | null;
  highlightedNodeIds?: Set<string>;
  focusMode?: boolean;
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

  // Entrance animation with spring physics
  useFrame((state) => {
    // Handle entrance animation
    if (entranceStartTime.current === null) {
      entranceStartTime.current = state.clock.elapsedTime + entranceDelay;
    }

    const elapsed = state.clock.elapsedTime - entranceStartTime.current;
    if (elapsed > 0 && entranceScale < 1) {
      // Spring-like ease out
      const t = Math.min(1, elapsed / 0.4);
      const spring = 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 2) * 0.3;
      setEntranceScale(Math.min(1, spring));
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
      // Quick pop-in
      const t = Math.min(1, elapsed / 0.3);
      setEntranceScale(1 - Math.pow(1 - t, 3));
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
}) {
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
    );
  }

  return (
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
  );
}

// Subtle edge line
function EdgeLine({
  start,
  end,
  isHighlighted,
  isSelected,
}: {
  start: [number, number, number];
  end: [number, number, number];
  isHighlighted: boolean;
  isSelected: boolean;
}) {
  const lineRef = useRef<THREE.Line>(null);

  const geometry = useMemo(() => {
    const points = [new THREE.Vector3(...start), new THREE.Vector3(...end)];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [start, end]);

  // All edges same muted color
  const color = isSelected
    ? EDGE_COLORS.selected
    : (isHighlighted ? EDGE_COLORS.highlight : EDGE_COLORS.default);

  // Subtle opacity
  const opacity = isSelected
    ? EDGE_OPACITY.selected
    : (isHighlighted ? EDGE_OPACITY.hover : EDGE_OPACITY.default);

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
}: GraphViewerProps) {
  const { camera } = useThree();
  const [dynamicLabelCap, setDynamicLabelCap] = useState(10);
  const frameStatsRef = useRef({ frames: 0, accum: 0, lastCap: 10 });
  const highlightSet = highlightedNodeIds ?? new Set<string>();
  const highlightActive = highlightSet.size > 0 && !selectedNode;
  const focusDim = highlightActive && focusMode;
  const [dataKey, setDataKey] = useState(0);

  // Reset entrance animations when data changes
  useEffect(() => {
    setDataKey((k) => k + 1);
  }, [data.nodes.length]);

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

  // Connected nodes for selection highlighting
  const connectedNodes = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const connected = new Set<string>();
    data.edges.forEach((edge) => {
      if (edge.source === selectedNode.id) connected.add(edge.target);
      if (edge.target === selectedNode.id) connected.add(edge.source);
    });
    return connected;
  }, [selectedNode, data.edges]);

  // Highlighted edges
  const highlightedEdges = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const edges = new Set<string>();
    data.edges.forEach((edge) => {
      if (edge.source === selectedNode.id || edge.target === selectedNode.id) {
        edges.add(`${edge.source}-${edge.target}`);
      }
    });
    return edges;
  }, [selectedNode, data.edges]);

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

  return (
    <group key={dataKey}>
      {/* Ambient floating particles */}
      <AmbientParticles bounds={graphBounds} />

      {/* Edges - render first (behind nodes) */}
      {data.edges.map((edge, idx) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);

        if (!sourceNode || !targetNode) return null;

        const isEdgeHighlighted = selectedNode
          ? highlightedEdges.has(`${edge.source}-${edge.target}`)
          : (highlightActive && highlightSet.has(edge.source) && highlightSet.has(edge.target));

        // Hide non-connected edges when selection/highlight active
        if (selectedNode && !isEdgeHighlighted) return null;
        if (focusDim && !isEdgeHighlighted) return null;

        return (
          <EdgeLine
            key={`${edge.source}-${edge.target}-${idx}`}
            start={[sourceNode.x, sourceNode.y, sourceNode.z]}
            end={[targetNode.x, targetNode.y, targetNode.z]}
            isHighlighted={isEdgeHighlighted && !selectedNode}
            isSelected={isEdgeHighlighted && !!selectedNode}
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
          onClick={onNodeClick}
        />
      ))}

      {/* Labels for top nodes */}
      <NodeLabels nodes={data.nodes} maxLabels={labelCap} />
    </group>
  );
}
