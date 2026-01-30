import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { ActionEvent, GraphNode } from '../../types';
import { ACTION_COLORS } from '../../graphTheme';

interface ActionPingsProps {
  events: ActionEvent[];
  nodeMap: Map<string, GraphNode>;
  enabled?: boolean;
  maxPulses?: number;
}

interface ActionPulse {
  id: number;
  position: [number, number, number];
  color: string;
  start: number;
  duration: number;
  baseRadius: number;
  strength: number;
  inferred: boolean;
}

const BASE_DURATION = 1.6;
const BASE_RADIUS = 0.8;

export default function ActionPings({
  events,
  nodeMap,
  enabled = true,
  maxPulses = 120,
}: ActionPingsProps) {
  const [pulses, setPulses] = useState<ActionPulse[]>([]);
  const idCounter = useRef(0);
  const timeRef = useRef(0);

  useFrame((state) => {
    timeRef.current = state.clock.elapsedTime;

    setPulses((prev) =>
      prev
        .map((pulse) => {
          const progress = (timeRef.current - pulse.start) / pulse.duration;
          return {
            ...pulse,
            strength: Math.max(0, 1 - progress),
          };
        })
        .filter((pulse) => pulse.strength > 0)
    );
  });

  useEffect(() => {
    if (!enabled || events.length === 0) {
      setPulses([]);
      return;
    }

    const available = events.filter((event) => nodeMap.has(event.account_id));
    if (available.length === 0) {
      setPulses([]);
      return;
    }

    const limit = Math.min(maxPulses, available.length);
    const step = Math.max(1, Math.floor(available.length / limit));
    const sampled = available.filter((_, idx) => idx % step === 0).slice(0, limit);

    const baseStart = timeRef.current;
    const nextPulses: ActionPulse[] = sampled.map((event, index) => {
      const node = nodeMap.get(event.account_id)!;
      const color = ACTION_COLORS[event.type] ?? ACTION_COLORS.default;
      const strength = typeof event.strength === 'number' ? event.strength : 1;
      const inferred = Boolean(event.inferred);

      idCounter.current += 1;
      return {
        id: idCounter.current,
        position: [node.x, node.y, node.z],
        color,
        start: baseStart + index * 0.04,
        duration: BASE_DURATION + (inferred ? 0.3 : 0),
        baseRadius: BASE_RADIUS + (strength * 0.4),
        strength,
        inferred,
      };
    });

    setPulses(nextPulses);
  }, [enabled, events, maxPulses, nodeMap]);

  if (!enabled || pulses.length === 0) return null;

  return (
    <group>
      {pulses.map((pulse) => {
        const progress = Math.max(0, Math.min(1, (timeRef.current - pulse.start) / pulse.duration));
        const radius = pulse.baseRadius + progress * (2.2 + pulse.strength);
        const opacity = Math.max(0, 0.5 * (1 - progress)) * (pulse.inferred ? 0.7 : 1);

        return (
          <Billboard
            key={pulse.id}
            position={[pulse.position[0], pulse.position[1], pulse.position[2] - 0.4]}
          >
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[radius, radius + 0.4, 40]} />
              <meshBasicMaterial
                color={pulse.color}
                transparent
                opacity={opacity}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          </Billboard>
        );
      })}
    </group>
  );
}
