import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GraphNode, GraphEdge } from '../../types';
import { playRippleSound } from '../../sounds';

interface RippleEffectProps {
  sourceNode: GraphNode | null;
  nodes: GraphNode[];  // For future edge-based propagation
  edges: GraphEdge[];  // For future edge-based propagation
  onComplete: () => void;
}

interface RippleRing {
  id: number;
  radius: number;
  opacity: number;
}

/**
 * Ripple effect that propagates through the graph from a clicked node.
 * Creates expanding rings that travel along edges.
 */
export function RippleEffect({
  sourceNode,
  nodes: _nodes,
  edges: _edges,
  onComplete
}: RippleEffectProps) {
  const [rings, setRings] = useState<RippleRing[]>([]);
  const [isActive, setIsActive] = useState(false);
  const ringIdCounter = useRef(0);
  const startTime = useRef<number | null>(null);
  const hasPlayedSound = useRef(false);

  // Future: Build adjacency list for edge-based BFS propagation
  // Currently using simple expanding rings
  // const adjacencyMap = useRef<Map<string, Set<string>>>(new Map());
  // useEffect(() => {
  //   const map = new Map<string, Set<string>>();
  //   _edges.forEach(edge => {
  //     if (!map.has(edge.source)) map.set(edge.source, new Set());
  //     if (!map.has(edge.target)) map.set(edge.target, new Set());
  //     map.get(edge.source)!.add(edge.target);
  //     map.get(edge.target)!.add(edge.source);
  //   });
  //   adjacencyMap.current = map;
  // }, [_edges]);

  // Start ripple when source node changes
  useEffect(() => {
    if (sourceNode) {
      setIsActive(true);
      startTime.current = null;
      hasPlayedSound.current = false;
      setRings([]);
    } else {
      setIsActive(false);
    }
  }, [sourceNode]);

  useFrame((state) => {
    if (!isActive || !sourceNode) return;

    // Initialize start time
    if (startTime.current === null) {
      startTime.current = state.clock.elapsedTime;
      // Play sound
      if (!hasPlayedSound.current) {
        playRippleSound();
        hasPlayedSound.current = true;
      }
    }

    const elapsed = state.clock.elapsedTime - startTime.current;
    const duration = 2.0; // Total animation duration

    // Emit new rings at intervals
    const ringInterval = 0.3;
    const expectedRings = Math.min(5, Math.floor(elapsed / ringInterval) + 1);

    if (rings.length < expectedRings && elapsed < duration * 0.6) {
      ringIdCounter.current++;
      setRings(prev => [...prev, {
        id: ringIdCounter.current,
        radius: 0,
        opacity: 0.5
      }]);
    }

    // Update existing rings
    setRings(prev => prev
      .map(ring => ({
        ...ring,
        radius: ring.radius + 1.5,  // Expansion speed
        opacity: ring.opacity - 0.008  // Fade speed
      }))
      .filter(ring => ring.opacity > 0)
    );

    // Complete when all rings faded
    if (elapsed > duration && rings.length === 0) {
      setIsActive(false);
      onComplete();
    }
  });

  if (!isActive || !sourceNode) return null;

  return (
    <group position={[sourceNode.x, sourceNode.y, sourceNode.z - 0.3]}>
      {rings.map((ring) => (
        <mesh key={ring.id} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ring.radius, ring.radius + 0.8, 64]} />
          <meshBasicMaterial
            color="#3b82f6"  // Blue ripple
            transparent
            opacity={ring.opacity}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export default RippleEffect;
