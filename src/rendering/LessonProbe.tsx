import React, { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { worldTarget } from '../ui/lessons/worldTarget';
import { S } from './forecourt';

/**
 * Puts the box a lesson wants lit — a car at the pump, a parcel for sale —
 * onto the screen every frame, for the overlay to cut its hole round. Lives
 * in the Canvas because that is where the camera is, and does nothing while
 * no lesson points into the scene.
 */
export const LessonProbe: React.FC = () => {
  const { camera, gl } = useThree();
  const corner = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const box = worldTarget.box;
    if (!box) {
      worldTarget.rect = null;
      return;
    }

    camera.updateMatrixWorld();
    const canvas = gl.domElement.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, box.top]) {
          corner.set((box.x + sx * box.halfX) * S, y, (box.z + sz * box.halfZ) * S).project(camera);
          if (corner.z > 1) continue;
          const px = canvas.left + ((corner.x + 1) / 2) * canvas.width;
          const py = canvas.top + ((1 - corner.y) / 2) * canvas.height;
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
        }
      }
    }

    // Behind the lens, or wholly off the screen: nothing to cut round.
    const offscreen =
      !Number.isFinite(minX) || maxX < 0 || maxY < 0 || minX > window.innerWidth || minY > window.innerHeight;
    worldTarget.rect = offscreen ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  });

  return null;
};
