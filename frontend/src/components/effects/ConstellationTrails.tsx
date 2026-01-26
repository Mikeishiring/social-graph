import { useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface TrailPoint {
  id: number;
  position: THREE.Vector3;
  opacity: number;
  size: number;
}

interface ConstellationTrailsProps {
  enabled: boolean;
  isDragging: boolean;
  maxPoints?: number;
}

/**
 * Constellation trails effect that creates sparkly points during camera rotation.
 * Points fade over time creating a trailing effect.
 */
export function ConstellationTrails({
  enabled,
  isDragging,
  maxPoints = 80,
}: ConstellationTrailsProps) {
  const { camera, pointer } = useThree();
  const [trails, setTrails] = useState<TrailPoint[]>([]);
  const pointIdCounter = useRef(0);
  const lastPosition = useRef<THREE.Vector3 | null>(null);
  const emitTimer = useRef(0);

  // Convert screen pointer to 3D world position
  const getPointerWorld = () => {
    const vec = new THREE.Vector3(pointer.x, pointer.y, 0.5);
    vec.unproject(camera);
    const dir = vec.sub(camera.position).normalize();
    const distance = 60; // Fixed distance in front of camera
    return camera.position.clone().add(dir.multiplyScalar(distance));
  };

  useFrame((_state, delta) => {
    if (!enabled) {
      if (trails.length > 0) setTrails([]);
      return;
    }

    // Emit new points while dragging
    if (isDragging) {
      emitTimer.current += delta;

      // Emit every 50ms
      if (emitTimer.current > 0.05) {
        emitTimer.current = 0;

        const worldPos = getPointerWorld();

        // Only emit if moved enough
        if (!lastPosition.current || worldPos.distanceTo(lastPosition.current) > 1) {
          lastPosition.current = worldPos.clone();

          pointIdCounter.current++;
          const newPoint: TrailPoint = {
            id: pointIdCounter.current,
            position: worldPos,
            opacity: 0.7,
            size: 0.3 + Math.random() * 0.2,
          };

          setTrails(prev => {
            const updated = [...prev, newPoint];
            // Keep only last maxPoints
            return updated.slice(-maxPoints);
          });
        }
      }
    } else {
      lastPosition.current = null;
    }

    // Fade existing points
    setTrails(prev =>
      prev
        .map(point => ({
          ...point,
          opacity: point.opacity - delta * 0.4,
          size: point.size * 0.995, // Gentle shrink
        }))
        .filter(point => point.opacity > 0)
    );
  });

  if (!enabled || trails.length === 0) return null;

  return (
    <group>
      {trails.map(point => (
        <mesh key={point.id} position={point.position}>
          <sphereGeometry args={[point.size, 8, 8]} />
          <meshBasicMaterial
            color="#60a5fa"
            transparent
            opacity={point.opacity}
            depthWrite={false}
          />
        </mesh>
      ))}
      {/* Connect nearby points with faint lines */}
      {trails.length > 1 && (
        <TrailLines points={trails} />
      )}
    </group>
  );
}

function TrailLines({ points }: { points: TrailPoint[] }) {
  const geometry = useRef<THREE.BufferGeometry>(null);

  useEffect(() => {
    if (!geometry.current || points.length < 2) return;

    // Create line segments between consecutive points
    const positions: number[] = [];
    const opacities: number[] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      // Only connect if close enough
      if (p1.position.distanceTo(p2.position) < 15) {
        positions.push(p1.position.x, p1.position.y, p1.position.z);
        positions.push(p2.position.x, p2.position.y, p2.position.z);
        opacities.push(Math.min(p1.opacity, p2.opacity) * 0.3);
        opacities.push(Math.min(p1.opacity, p2.opacity) * 0.3);
      }
    }

    geometry.current.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
  }, [points]);

  if (points.length < 2) return null;

  const avgOpacity = points.reduce((sum, p) => sum + p.opacity, 0) / points.length;

  return (
    <lineSegments>
      <bufferGeometry ref={geometry} />
      <lineBasicMaterial
        color="#93c5fd"
        transparent
        opacity={avgOpacity * 0.25}
        depthWrite={false}
      />
    </lineSegments>
  );
}

export default ConstellationTrails;
