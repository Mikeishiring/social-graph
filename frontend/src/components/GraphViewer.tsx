import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { GraphData, GraphNode } from '../types';

// Community colors
const COMMUNITY_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f97316', // orange
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#f59e0b', // amber
  '#84cc16', // lime
];

interface GraphViewerProps {
  data: GraphData;
  onNodeHover: (node: GraphNode | null) => void;
  onNodeClick: (node: GraphNode | null) => void;
  selectedNode: GraphNode | null;
}

function NodeMesh({
  node,
  isSelected,
  isConnected,
  hasSelection,
  onHover,
  onClick,
}: {
  node: GraphNode;
  isSelected: boolean;
  isConnected: boolean;
  hasSelection: boolean;
  onHover: (node: GraphNode | null) => void;
  onClick: (node: GraphNode) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Size based on importance (min 0.5, max 3)
  const size = 0.5 + node.importance * 2.5;
  
  // Color based on community
  const color = COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length];
  
  // Glow for new nodes
  const emissive = node.isNew ? '#22c55e' : (isSelected ? '#ffffff' : '#000000');
  const emissiveIntensity = node.isNew ? 0.5 : (isSelected ? 0.3 : 0);
  
  // Calculate opacity based on selection state
  const nodeOpacity = !hasSelection ? 1 : (isSelected || isConnected ? 1 : 0.15);

  // Animate
  useFrame((state) => {
    if (meshRef.current) {
      // Pulse new nodes
      if (node.isNew) {
        const scale = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.1;
        meshRef.current.scale.setScalar(scale);
      }
      
      // Highlight selected
      if (isSelected) {
        const scale = 1.2 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
        meshRef.current.scale.setScalar(scale);
      }
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={[node.x, node.y, node.z]}
      onPointerEnter={(e) => {
        e.stopPropagation();
        onHover(node);
        document.body.style.cursor = 'pointer';
      }}
      onPointerLeave={() => {
        onHover(null);
        document.body.style.cursor = 'auto';
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(node);
      }}
    >
      <sphereGeometry args={[size, 16, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        metalness={0.3}
        roughness={0.7}
        transparent={true}
        opacity={nodeOpacity}
      />
    </mesh>
  );
}

function EdgeLine({
  start,
  end,
  weight,
  type,
  isHighlighted,
}: {
  start: [number, number, number];
  end: [number, number, number];
  weight: number;
  type: string;
  isHighlighted: boolean;
}) {
  const points = useMemo(() => {
    return [new THREE.Vector3(...start), new THREE.Vector3(...end)];
  }, [start, end]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return geo;
  }, [points]);

  // Color based on edge type
  const getColor = () => {
    if (isHighlighted) return '#ffffff';
    switch (type) {
      case 'direct_interaction':
        return '#4f46e5';
      case 'co_engagement':
        return '#06b6d4';
      case 'ego_follow':
        return '#10b981';
      default:
        return '#3b82f6';
    }
  };

  // Opacity based on weight and highlight
  const opacity = isHighlighted ? 0.8 : Math.min(0.1 + weight * 0.5, 0.5);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial
        color={getColor()}
        transparent={true}
        opacity={opacity}
        linewidth={1}
      />
    </line>
  );
}

function NodeLabels({
  nodes,
  maxLabels = 20,
}: {
  nodes: GraphNode[];
  maxLabels?: number;
}) {
  // Only show labels for top N nodes by importance
  const topNodes = useMemo(() => {
    return [...nodes]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, maxLabels);
  }, [nodes, maxLabels]);

  return (
    <>
      {topNodes.map((node) => (
        <Html
          key={node.id}
          position={[node.x, node.y + 3, node.z]}
          center
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div className="px-2 py-1 bg-black/70 rounded text-xs text-white whitespace-nowrap">
            @{node.handle || node.id.slice(0, 8)}
          </div>
        </Html>
      ))}
    </>
  );
}

export default function GraphViewer({
  data,
  onNodeHover,
  onNodeClick,
  selectedNode,
}: GraphViewerProps) {
  // Build node lookup for edge rendering
  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    data.nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [data.nodes]);

  // Find connected nodes for highlighting
  const connectedNodes = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    
    const connected = new Set<string>();
    data.edges.forEach((edge) => {
      if (edge.source === selectedNode.id) {
        connected.add(edge.target);
      }
      if (edge.target === selectedNode.id) {
        connected.add(edge.source);
      }
    });
    return connected;
  }, [selectedNode, data.edges]);

  // Filter edges connected to selected node for highlighting
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

  return (
    <group>
      {/* Edges */}
      {data.edges.map((edge, idx) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        
        if (!sourceNode || !targetNode) return null;
        
        const isHighlighted = highlightedEdges.has(`${edge.source}-${edge.target}`);
        
        // Hide non-connected edges when a node is selected
        if (selectedNode && !isHighlighted) {
          return null;
        }
        
        return (
          <EdgeLine
            key={`${edge.source}-${edge.target}-${idx}`}
            start={[sourceNode.x, sourceNode.y, sourceNode.z]}
            end={[targetNode.x, targetNode.y, targetNode.z]}
            weight={edge.weight}
            type={edge.type}
            isHighlighted={isHighlighted}
          />
        );
      })}

      {/* Nodes */}
      {data.nodes.map((node) => (
        <NodeMesh
          key={node.id}
          node={node}
          isSelected={selectedNode?.id === node.id}
          isConnected={connectedNodes.has(node.id)}
          hasSelection={selectedNode !== null}
          onHover={onNodeHover}
          onClick={onNodeClick}
        />
      ))}

      {/* Labels for top nodes */}
      <NodeLabels nodes={data.nodes} maxLabels={15} />
    </group>
  );
}
