import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { Package } from 'lucide-react';
import { GAME_CONFIG } from '../config/gameConfig';
import { BuildingMesh } from '../rendering/BuildingMesh';
import { PumpMesh } from '../rendering/PumpMesh';
import { BuildingEntity, PumpEntity } from '../domain/types/gameState';
import { BUILDING_MODEL_URLS } from '../rendering/models/buildingModels';

/**
 * Pictures of the catalogue, drawn with the very meshes the forecourt uses.
 *
 * A card showing a hand-drawn icon would be a second source of truth about what
 * the player is buying, and it would go stale the first time a model changed.
 * So these are real renders — taken once, as images.
 *
 * Giving each card its own live canvas was tried and abandoned: a browser
 * grants a page only a handful of WebGL contexts, and mounting and dropping
 * them as twenty-six cards scrolled cost the *game* its context — the forecourt
 * behind the modal went black, measurably. One canvas, one photograph per item,
 * cached for the session: the catalogue costs nothing to reopen and the game is
 * never at risk of losing its renderer.
 */

const shots = new Map<string, string | null>();
const listeners = new Set<() => void>();

/** Re-renders the caller whenever another photograph is taken. */
function useShots(): Map<string, string | null> {
  const [, bump] = useState(0);

  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return shots;
}

function entityFor(type: string) {
  const size = GAME_CONFIG.buildings[type]?.size ?? [2, 2];

  return {
    building: {
      id: `preview_${type}`,
      type,
      level: 1,
      position: [0, 0],
      rotation: 0,
      size,
      health: 100,
      constructionState: 'ACTIVE',
      builtAtTimestamp: 0
    } as BuildingEntity,
    pump: {
      id: `preview_${type}`,
      level: 1,
      position: [0, 0],
      rotation: 0,
      supportedFuels: ['gasoline'],
      state: 'IDLE',
      health: 100,
      employeeId: null,
      currentVehicleId: null,
      flowRateLps: 8
    } as PumpEntity
  };
}

/**
 * Photographs the whole catalogue from one scene.
 *
 * Every item is mounted once, together, and only the one being shot is left
 * visible; the camera is moved from item to item and the buffer read after
 * each render. Setting them up one at a time instead meant tearing down and
 * rebuilding the canvas contents for every card, and on a slow machine that
 * cost most of a second each — long enough that a watchdog meant to catch a
 * broken model was writing off perfectly good ones. Nothing is torn down here,
 * so a pass costs a frame an item.
 *
 * Each item carries its own suspense boundary, so one model that is slow to
 * arrive — or never arrives — holds up nothing but itself. The pass simply
 * runs again, and picks up whatever has appeared since.
 */
const Booth: React.FC<{
  types: string[];
  onShot: (type: string, url: string | null) => void;
}> = ({ types, onShot }) => {
  const { gl, scene, camera, size } = useThree();
  const holders = useRef(new Map<string, THREE.Group>());

  useEffect(() => {
    let stop = false;
    const done = new Set<string>();
    let rounds = 0;

    const frame = (group: THREE.Group): string | null => {
      const box = new THREE.Box3().setFromObject(group);
      // Still empty means the model has not landed yet; try again next round.
      if (box.isEmpty()) return null;

      const extent = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const radius = Math.max(0.5, extent.length() / 2);

      const lens = camera as THREE.PerspectiveCamera;
      const vertical = (lens.fov * Math.PI) / 180;
      // Fit whichever axis runs out first, so a wide item is held by the
      // card's width rather than spilling over it.
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * (size.width / size.height));
      const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.06;

      lens.position.copy(centre).addScaledVector(new THREE.Vector3(0.72, 0.62, 1).normalize(), distance);
      lens.near = Math.max(0.05, distance - radius * 3);
      lens.far = distance + radius * 6;
      lens.lookAt(centre);
      lens.updateProjectionMatrix();

      holders.current.forEach((g, t) => (g.visible = t === group.name));
      gl.render(scene, lens);
      return gl.domElement.toDataURL('image/webp', 0.85);
    };

    const pass = () => {
      if (stop) return;

      for (const type of types) {
        if (done.has(type)) continue;
        const group = holders.current.get(type);
        if (!group) continue;

        const url = frame(group);
        if (url) {
          done.add(type);
          onShot(type, url);
        }
      }

      holders.current.forEach((g) => (g.visible = false));

      if (done.size >= types.length) return;

      // Twenty rounds at a third of a second is nearly seven seconds of grace
      // for a model to arrive. Whatever is still missing after that never
      // loaded, and its card says so instead of spinning for ever.
      if (++rounds >= 20) {
        for (const type of types) if (!done.has(type)) onShot(type, null);
        return;
      }

      window.setTimeout(() => requestAnimationFrame(pass), 300);
    };

    const id = requestAnimationFrame(pass);
    return () => {
      stop = true;
      cancelAnimationFrame(id);
    };
  }, [types, gl, scene, camera, size.width, size.height, onShot]);

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[8, 14, 9]} intensity={2.2} />
      <hemisphereLight groundColor="#2b333f" intensity={0.55} />

      {types.map((type) => {
        const { building, pump } = entityFor(type);
        return (
          <group
            key={type}
            name={type}
            visible={false}
            ref={(g) => {
              if (g) holders.current.set(type, g);
              else holders.current.delete(type);
            }}
          >
            {/* One boundary each: a model that never loads costs its own card
                a picture and nothing else. */}
            <Suspense fallback={null}>
              {type === 'pump_standard' ? (
                <PumpMesh pump={pump} />
              ) : (
                <BuildingMesh building={building} />
              )}
            </Suspense>
          </group>
        );
      })}
    </>
  );
};

/**
 * The one canvas behind every card. Renders off-screen, works through whatever
 * has not been photographed yet, and unmounts once the set is complete.
 */
export const CatalogPhotoBooth: React.FC<{ types: string[] }> = ({ types }) => {
  const taken = useShots();

  // Every model at once rather than one per photograph: they are fetched in
  // parallel while the first frames are being drawn.
  useEffect(() => {
    for (const url of BUILDING_MODEL_URLS) useGLTF.preload(url);
  }, []);

  const record = useCallback((type: string, url: string | null) => {
    shots.set(type, url);
    listeners.forEach((fn) => fn());
  }, []);

  const outstanding = types.some((t) => !taken.has(t));
  if (!outstanding) return null;

  return (
    <div
      aria-hidden
      // Parked off-screen rather than hidden: a display:none canvas draws
      // nothing, and there would be nothing to photograph.
      style={{ position: 'fixed', left: -9999, top: 0, width: 320, height: 240 }}
    >
      <Canvas
        dpr={1.5}
        frameloop="demand"
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        camera={{ fov: 34 }}
      >
        <Booth types={types} onShot={record} />
      </Canvas>
    </div>
  );
};

export const CatalogPreview: React.FC<{ type: string }> = ({ type }) => {
  const taken = useShots();
  const tried = taken.has(type);
  const shot = taken.get(type);

  return (
    <div className="relative h-28 rounded-2xl overflow-hidden bg-gradient-to-b from-slate-800/70 to-slate-950/70 border border-slate-700/60">
      {shot ? (
        <img src={shot} alt="" className="w-full h-full object-contain" draggable={false} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          {tried ? (
            // Tried and came back empty. The card still has its name, size and
            // description, so it stays usable — it just has no portrait.
            <Package className="w-8 h-8 text-slate-600" />
          ) : (
            <div className="w-7 h-7 rounded-full border-2 border-slate-600 border-t-slate-400 animate-spin" />
          )}
        </div>
      )}
    </div>
  );
};
