import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

interface OrbitModeProps {
  enabled: boolean;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  speed?: number;
  radius?: number;
  verticalAmplitude?: number;
}

/**
 * Cinematic orbit mode that slowly rotates the camera around the graph.
 * Creates a screensaver-like effect with gentle elliptical camera path.
 */
export function OrbitMode({
  enabled,
  controlsRef,
  speed = 0.15,
  radius = 120,
  verticalAmplitude = 20,
}: OrbitModeProps) {
  const { camera } = useThree();
  const angleRef = useRef(0);
  const initialY = useRef<number | null>(null);

  useFrame((_state, delta) => {
    if (!enabled || !controlsRef.current) return;

    // Store initial Y on first frame
    if (initialY.current === null) {
      initialY.current = camera.position.y;
    }

    // Increment angle
    angleRef.current += delta * speed;

    // Elliptical path (wider on X, narrower on Z)
    const x = Math.cos(angleRef.current) * radius;
    const z = Math.sin(angleRef.current) * radius * 0.7;

    // Gentle vertical oscillation
    const y = initialY.current + Math.sin(angleRef.current * 0.5) * verticalAmplitude;

    // Update camera position
    camera.position.set(x, y, z);

    // Always look at center
    camera.lookAt(0, 0, 0);

    // Update controls target
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  });

  return null;
}

export default OrbitMode;
