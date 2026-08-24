import React, { useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';

/**
 * Orbits an isometric-style camera around a pannable ground target. Angle,
 * zoom and target are all eased every frame so input never snaps.
 */
export const IsometricCamera: React.FC = () => {
  const { camera } = useThree();
  const cameraAngle = useGameStore((s) => s.cameraAngle);
  const cameraZoom = useGameStore((s) => s.cameraZoom);
  const cameraTarget = useGameStore((s) => s.cameraTarget);

  const angleRef = useRef(cameraAngle);
  const zoomRef = useRef(cameraZoom);
  const targetRef = useRef(new THREE.Vector3(cameraTarget[0], 0, cameraTarget[1]));
  const lookAtRef = useRef(new THREE.Vector3(cameraTarget[0], 1, cameraTarget[1]));
  const desiredPos = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    // Cap the blend factor so a long frame cannot overshoot.
    const ease = Math.min(1, delta * 7);

    // Rotate the short way round so 350deg -> 10deg does not spin backwards.
    let angleDiff = ((cameraAngle - angleRef.current + 540) % 360) - 180;
    angleRef.current += angleDiff * ease;

    zoomRef.current += (cameraZoom - zoomRef.current) * ease;
    targetRef.current.x += (cameraTarget[0] - targetRef.current.x) * ease;
    targetRef.current.z += (cameraTarget[1] - targetRef.current.z) * ease;

    const rad = (angleRef.current * Math.PI) / 180;
    const zoomOut = 7 - zoomRef.current;
    const distance = 26 + zoomOut * 7;
    const height = 20 + zoomOut * 5;

    desiredPos.current.set(
      targetRef.current.x + Math.sin(rad) * distance,
      height,
      targetRef.current.z + Math.cos(rad) * distance
    );

    camera.position.copy(desiredPos.current);

    lookAtRef.current.set(targetRef.current.x, 1, targetRef.current.z);
    camera.lookAt(lookAtRef.current);
  });

  return null;
};
