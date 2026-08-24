import React, { useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { IsometricCamera } from './IsometricCamera';
import { GroundGrid } from './GroundGrid';
import { PumpMesh } from './PumpMesh';
import { VehicleMesh } from './VehicleMesh';
import { BuildingMesh } from './BuildingMesh';
import { TankerTruckMesh } from './TankerTruckMesh';
import { BuildPreviewMesh } from './BuildPreviewMesh';
import { SceneLighting } from './SceneLighting';
import { SceneryProps } from './SceneryProps';
import { RenderStatsProbe } from './RenderStatsProbe';
import { BuildPlacementPlane } from './BuildPlacementPlane';
import { LandParcelLayer } from './LandParcelLayer';
import { useGameStore } from '../store/gameStore';

/** Drag has to exceed this many pixels before it counts as a pan, not a click. */
const DRAG_THRESHOLD_PX = 4;

export const StationScene: React.FC = () => {
  const pumps = useGameStore((s) => s.gameState.pumps);
  const vehicles = useGameStore((s) => s.gameState.vehicles);
  const buildings = useGameStore((s) => s.gameState.buildings);
  const fuelOrders = useGameStore((s) => s.gameState.fuelOrders);
  const graphicsQuality = useGameStore((s) => s.gameState.settings.graphicsQuality);
  const buildMode = useGameStore((s) => s.buildMode);
  const selectVehicle = useGameStore((s) => s.selectVehicle);
  const selectPump = useGameStore((s) => s.selectPump);
  const selectBuilding = useGameStore((s) => s.selectBuilding);
  const panCamera = useGameStore((s) => s.panCamera);
  const setCameraZoom = useGameStore((s) => s.setCameraZoom);

  const [isPanning, setIsPanning] = useState(false);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  /**
   * `pointerDown` gates hover behaviour while the camera is being dragged;
   * `dragged` survives until the next press so the click that ends a drag is
   * not mistaken for a deliberate click.
   */
  const pointerState = useRef({ pointerDown: false, dragged: false });

  const activeOrders = fuelOrders.filter((o) => o.state === 'UNLOADING');

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragOrigin.current = { x: e.clientX, y: e.clientY };
    lastPointer.current = { x: e.clientX, y: e.clientY };
    pointerState.current = { pointerDown: true, dragged: false };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragOrigin.current || !lastPointer.current) return;

      const totalDx = e.clientX - dragOrigin.current.x;
      const totalDy = e.clientY - dragOrigin.current.y;

      if (!pointerState.current.dragged && Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD_PX) {
        pointerState.current.dragged = true;
        setIsPanning(true);
      }

      if (pointerState.current.dragged) {
        panCamera(e.clientX - lastPointer.current.x, e.clientY - lastPointer.current.y);
      }

      lastPointer.current = { x: e.clientX, y: e.clientY };
    },
    [panCamera]
  );

  const handlePointerUp = useCallback(() => {
    dragOrigin.current = null;
    lastPointer.current = null;
    // `dragged` is deliberately left set until the next press.
    pointerState.current.pointerDown = false;
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      setCameraZoom((z) => z + (e.deltaY < 0 ? 0.5 : -0.5));
    },
    [setCameraZoom]
  );

  const handleSceneClick = () => {
    // A click that was really a drag should not clear the selection.
    if (pointerState.current.dragged) return;
    selectVehicle(null);
    selectPump(null);
    selectBuilding(null);
  };

  return (
    <div
      className={`w-full h-full relative ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
    >
      <Canvas
        shadows={graphicsQuality !== 'LOW'}
        dpr={graphicsQuality === 'HIGH' ? [1, 2] : [1, 1.5]}
        camera={{ position: [30, 25, 30], fov: 32 }}
        onPointerMissed={handleSceneClick}
        gl={{ antialias: graphicsQuality !== 'LOW', powerPreference: 'high-performance' }}
      >
        <IsometricCamera />
        <SceneLighting />
        <RenderStatsProbe />

        <GroundGrid />
        <SceneryProps />

        {Object.values(pumps).map((pump) => (
          <PumpMesh key={pump.id} pump={pump} />
        ))}

        {Object.values(vehicles).map((vehicle) => (
          <VehicleMesh key={vehicle.id} vehicle={vehicle} />
        ))}

        {Object.values(buildings).map((bld) => (
          <BuildingMesh key={bld.id} building={bld} />
        ))}

        {activeOrders.map((order) => (
          <TankerTruckMesh key={order.id} order={order} />
        ))}

        <BuildPlacementPlane pointerState={pointerState} />
        <LandParcelLayer pointerState={pointerState} />
        <BuildPreviewMesh />
      </Canvas>
    </div>
  );
};
