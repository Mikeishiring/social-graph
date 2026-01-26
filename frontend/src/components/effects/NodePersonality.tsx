import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface NodePersonalityProps {
  nodeId: string;
  enabled: boolean;
  children: React.ReactNode;
}

/**
 * Wrapper component that adds subtle bob/sway animation to nodes.
 * Each node has a unique animation based on a hash of its ID.
 */
export function NodePersonality({
  nodeId,
  enabled,
  children
}: NodePersonalityProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Generate unique animation parameters from node ID
  const params = useMemo(() => {
    // Simple hash from node ID
    let hash = 0;
    for (let i = 0; i < nodeId.length; i++) {
      hash = ((hash << 5) - hash) + nodeId.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    hash = Math.abs(hash);

    return {
      // Vertical bob parameters
      bobFrequency: 0.4 + (hash % 100) / 250,  // 0.4-0.8 Hz
      bobAmplitude: 0.08 + (hash % 60) / 800,  // 0.08-0.15 units

      // Horizontal sway parameters
      swayFrequency: 0.25 + (hash % 80) / 320, // 0.25-0.5 Hz
      swayAmplitude: 0.04 + (hash % 40) / 1000, // 0.04-0.08 units

      // Phase offset so nodes don't move in sync
      phaseOffset: (hash % 628) / 100, // 0 to ~2*PI
    };
  }, [nodeId]);

  useFrame((state) => {
    if (!enabled || !groupRef.current) return;

    const t = state.clock.elapsedTime + params.phaseOffset;

    // Gentle bob up and down
    const bobY = Math.sin(t * params.bobFrequency * Math.PI * 2) * params.bobAmplitude;

    // Subtle horizontal sway
    const swayX = Math.sin(t * params.swayFrequency * Math.PI * 2) * params.swayAmplitude;

    // Apply as offset from origin (the node's actual position)
    groupRef.current.position.set(swayX, bobY, 0);
  });

  if (!enabled) {
    return <>{children}</>;
  }

  return <group ref={groupRef}>{children}</group>;
}

export default NodePersonality;
