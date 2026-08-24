import React from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';

export interface PointerState {
  /** A button is currently held, so the camera may be being panned. */
  pointerDown: boolean;
  /** The press moved far enough to count as a drag rather than a click. */
  dragged: boolean;
}

interface BuildPlacementPlaneProps {
  pointerState: React.MutableRefObject<PointerState>;
}

/**
 * Invisible ground plane that turns pointer position into a build location.
 *
 * This has to live inside the Canvas as a real mesh: only a raycast against
 * scene geometry produces an intersection point. A handler on the <Canvas>
 * element is just a DOM listener and never sees where in the world the
 * pointer is, which is why placement never followed the cursor.
 */
export const BuildPlacementPlane: React.FC<BuildPlacementPlaneProps> = ({ pointerState }) => {
  const buildMode = useGameStore((s) => s.buildMode);
  const plots = useGameStore((s) => s.gameState.station.plots);
  const setBuildPreviewPos = useGameStore((s) => s.setBuildPreviewPos);
  const confirmBuildPlacement = useGameStore((s) => s.confirmBuildPlacement);

  if (!buildMode.active) return null;

  // Snap to whole grid cells, clamped to the plot the player actually owns.
  const toGrid = (point: THREE.Vector3): [number, number] => [
    Math.max(0, Math.min(plots.width, Math.round(point.x / 2))),
    Math.max(0, Math.min(plots.height, Math.round(point.z / 2)))
  ];

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    // Hold the preview still while the camera is being dragged.
    if (pointerState.current.pointerDown) return;
    e.stopPropagation();
    setBuildPreviewPos(toGrid(e.point));
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // A click that was really a camera drag should not drop a building.
    if (pointerState.current.dragged) return;
    e.stopPropagation();
    setBuildPreviewPos(toGrid(e.point));
    confirmBuildPlacement();
  };

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[plots.width, 0.04, plots.height]}
      onPointerMove={handleMove}
      onClick={handleClick}
    >
      {/* Generous overhang so the pointer still registers past the kerb. */}
      <planeGeometry args={[plots.width * 4, plots.height * 4]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
};
