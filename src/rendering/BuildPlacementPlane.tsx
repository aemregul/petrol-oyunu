import React, { useMemo } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { ownedBounds } from '../domain/services/land';

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
  const pinBuildPreviewAt = useGameStore((s) => s.pinBuildPreviewAt);

  // The clamp has to follow every parcel the player owns, including columns
  // left of the origin and the rows across the road, which sit at negative
  // coordinates. Clamping to [0, width] made that land unreachable.
  const bounds = useMemo(
    () => ownedBounds(plots.ownedParcels),
    [plots.ownedParcels]
  );

  if (!buildMode.active) return null;

  const toGrid = (point: THREE.Vector3): [number, number] => [
    Math.max(bounds.minX, Math.min(bounds.width, Math.round(point.x / 2))),
    Math.max(bounds.minZ, Math.min(bounds.height, Math.round(point.z / 2)))
  ];

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    // Hold the preview still while the camera is being dragged or after the
    // player has clicked once to hand control over to the fine-tuning pad.
    if (pointerState.current.pointerDown || buildMode.pinned) return;
    e.stopPropagation();
    setBuildPreviewPos(toGrid(e.point));
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // A click that was really a camera drag should not anchor the preview.
    if (pointerState.current.dragged) return;
    e.stopPropagation();
    pinBuildPreviewAt(toGrid(e.point));
  };

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[
        ((bounds.minX + bounds.width) / 2) * 2,
        0.04,
        ((bounds.minZ + bounds.height) / 2) * 2
      ]}
      onPointerMove={handleMove}
      onClick={handleClick}
    >
      {/* Generous overhang so the pointer still registers past the kerb. */}
      <planeGeometry args={[(bounds.width - bounds.minX) * 6, (bounds.height - bounds.minZ) * 6]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
};
