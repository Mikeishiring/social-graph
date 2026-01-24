import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { playWhooshSound } from '../sounds';

interface CameraFocusProps {
  target: [number, number, number] | null;
  controlsRef: React.RefObject<{ target?: THREE.Vector3; update?: () => void } | null>;
}

// Smooth easing function (ease-out cubic)
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export default function CameraFocus({ target, controlsRef }: CameraFocusProps) {
  const { camera } = useThree();
  const desiredTarget = useRef<THREE.Vector3 | null>(null);
  const desiredPosition = useRef<THREE.Vector3 | null>(null);
  const startTarget = useRef<THREE.Vector3 | null>(null);
  const startPosition = useRef<THREE.Vector3 | null>(null);
  const animationProgress = useRef(0);
  const isAnimating = useRef(false);
  const lastTarget = useRef<string | null>(null);

  useEffect(() => {
    if (!target) {
      desiredTarget.current = null;
      desiredPosition.current = null;
      isAnimating.current = false;
      lastTarget.current = null;
      return;
    }

    const targetKey = target.join(',');
    if (lastTarget.current === targetKey) return;
    lastTarget.current = targetKey;

    const nextTarget = new THREE.Vector3(...target);
    const controls = controlsRef.current;
    const currentTarget = controls?.target?.clone() ?? new THREE.Vector3();
    const offset = camera.position.clone().sub(currentTarget);

    // Zoom in a bit when focusing
    const focusDistance = Math.min(60, offset.length() * 0.7);
    offset.setLength(focusDistance);

    // Store start positions for smooth animation
    startTarget.current = currentTarget.clone();
    startPosition.current = camera.position.clone();
    desiredTarget.current = nextTarget;
    desiredPosition.current = nextTarget.clone().add(offset);

    // Reset animation progress
    animationProgress.current = 0;
    isAnimating.current = true;

    // Play whoosh sound for cinematic effect
    playWhooshSound();
  }, [camera, controlsRef, target]);

  useFrame((_, delta) => {
    if (!isAnimating.current || !desiredTarget.current || !desiredPosition.current) return;
    if (!startTarget.current || !startPosition.current) return;

    // Animate over ~0.6 seconds
    const duration = 0.6;
    animationProgress.current = Math.min(1, animationProgress.current + delta / duration);
    const easedProgress = easeOutCubic(animationProgress.current);

    // Interpolate camera position
    camera.position.lerpVectors(startPosition.current, desiredPosition.current, easedProgress);

    // Interpolate controls target
    const controls = controlsRef.current;
    if (controls?.target) {
      controls.target.lerpVectors(startTarget.current, desiredTarget.current, easedProgress);
      controls.update?.();
    } else {
      camera.lookAt(
        new THREE.Vector3().lerpVectors(startTarget.current, desiredTarget.current, easedProgress)
      );
    }

    // Stop animating when complete
    if (animationProgress.current >= 1) {
      isAnimating.current = false;
    }
  });

  return null;
}
