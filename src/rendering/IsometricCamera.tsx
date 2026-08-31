import React, { useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { cameraOffsets, CAMERA_VIEWS } from './cameraFrame';

/**
 * Orbits an isometric-style camera around a pannable ground target. Angle,
 * zoom and target are all eased every frame so input never snaps.
 */
export const IsometricCamera: React.FC = () => {
  const { camera } = useThree();
  const cameraAngle = useGameStore((s) => s.cameraAngle);
  const cameraZoom = useGameStore((s) => s.cameraZoom);
  const cameraTarget = useGameStore((s) => s.cameraTarget);
  const cameraView = useGameStore((s) => s.cameraView);

  const angleRef = useRef(cameraAngle);
  const zoomRef = useRef(cameraZoom);
  const pitchRef = useRef(CAMERA_VIEWS[cameraView].pitch);
  const radiusScaleRef = useRef(CAMERA_VIEWS[cameraView].radiusScale);
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

    // The view button jumps between three pitches; easing them here is what
    // turns that jump into the camera swinging up over the forecourt. The
    // distance eases alongside, or the arc would swing and then lurch.
    const view = CAMERA_VIEWS[cameraView];
    pitchRef.current += (view.pitch - pitchRef.current) * ease;
    radiusScaleRef.current += (view.radiusScale - radiusScaleRef.current) * ease;

    const rad = (angleRef.current * Math.PI) / 180;
    const { distance, height } = cameraOffsets(
      zoomRef.current,
      pitchRef.current,
      radiusScaleRef.current
    );

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
