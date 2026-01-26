import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface HeartbeatPulseProps {
  position: [number, number, number];
  enabled: boolean;
  baseSize?: number;
}

interface Ring {
  id: number;
  scale: number;
  opacity: number;
}

/**
 * Heartbeat pulse effect that emanates from the ego node.
 * Creates expanding rings with a double-beat rhythm like a heartbeat.
 */
export function HeartbeatPulse({
  position,
  enabled,
  baseSize = 5
}: HeartbeatPulseProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [rings, setRings] = useState<Ring[]>([]);
  const lastBeatTime = useRef(0);
  const beatPhase = useRef(0);
  const ringIdCounter = useRef(0);

  useFrame((state) => {
    if (!enabled) {
      if (rings.length > 0) setRings([]);
      return;
    }

    const time = state.clock.elapsedTime;

    // Heartbeat rhythm: two quick beats, then pause
    // Pattern: beat at 0, beat at 0.2, pause until 1.0, repeat
    const cycleTime = time % 1.2;
    const shouldBeat = (cycleTime < 0.05 && beatPhase.current === 0) ||
                       (cycleTime > 0.25 && cycleTime < 0.30 && beatPhase.current === 1);

    if (cycleTime < 0.05) {
      beatPhase.current = 0;
    } else if (cycleTime > 0.25 && cycleTime < 0.30) {
      beatPhase.current = 1;
    } else if (cycleTime > 0.5) {
      beatPhase.current = 2; // Waiting phase
    }

    // Emit new ring on beat
    if (shouldBeat && time - lastBeatTime.current > 0.15 && rings.length < 4) {
      lastBeatTime.current = time;
      ringIdCounter.current++;
      setRings(prev => [...prev, {
        id: ringIdCounter.current,
        scale: 1,
        opacity: 0.35
      }]);
    }

    // Expand and fade rings
    setRings(prev => prev
      .map(ring => ({
        ...ring,
        scale: ring.scale + 0.08,  // Expansion speed
        opacity: ring.opacity - 0.006  // Fade speed
      }))
      .filter(ring => ring.opacity > 0)
    );
  });

  if (!enabled) return null;

  return (
    <group ref={groupRef} position={position}>
      {rings.map((ring) => (
        <mesh key={ring.id} scale={ring.scale} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[baseSize * 0.9, baseSize * 1.1, 64]} />
          <meshBasicMaterial
            color="#a855f7"  // Purple to match ego/mutual theme
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

export default HeartbeatPulse;
