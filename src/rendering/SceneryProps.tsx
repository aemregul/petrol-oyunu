import React, { useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import { useGameStore } from '../store/gameStore';
import { LAYOUT, getLayout } from '../domain/services/simulationEngine';
import {
  parseParcelKey,
  parcelBounds,
  PARCEL,
  LAND_BOUNDS,
  FAR_SIDE_FRONT
} from '../domain/services/land';

const S = 2;
const roadZ = LAYOUT.roadZ * S;

/** Nothing decorative may stand this close to owned land or tarmac. */
const CLEARANCE = 1.5;

/**
 * The whole area the map can ever cover, in world units, plus a margin of
 * countryside. Scenery is scattered across all of it and then cleared where
 * the player has built, so buying land removes the trees standing on it and
 * never shuffles the rest.
 */
const WORLD = {
  minX: (LAND_BOUNDS.minCol - 2) * PARCEL.width * S,
  maxX: (LAND_BOUNDS.maxCol + 3) * PARCEL.width * S,
  minZ: (FAR_SIDE_FRONT - (-LAND_BOUNDS.minRow) * PARCEL.depth - 14) * S,
  maxZ: ((LAND_BOUNDS.maxRow + 1) * PARCEL.depth + 14) * S
};

/** Roughly one prop per cell, jittered so the scatter never looks like a grid. */
const SCATTER_CELL = 13;

/**
 * Instance buffer capacities. drei's <Instances> allocates its matrix buffer
 * once, from the `limit` it sees on first render, and never resizes it — so
 * `limit` has to be a fixed ceiling and only `range` may vary. Passing a live
 * count instead left the buffer stuck at whatever the scene happened to need
 * at mount, and anything above that silently stopped rendering.
 */
const MAX_TREES = 400;
const MAX_BUSHES = 400;
const MAX_LAMPS = 32;

/** Deterministic pseudo-random so scenery never reshuffles between frames. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

interface Placement {
  position: [number, number, number];
  scale: number;
  rotation: number;
}

/**
 * Trees, shrubs and street lights around the plot. Everything is drawn with
 * instanced meshes and casts no shadows: scenery is set dressing, and drawing
 * it per-object cost more frame time than the whole station put together.
 */
export const SceneryProps: React.FC = () => {
  const plots = useGameStore((s) => s.gameState.station.plots);
  const roadLevel = useGameStore((s) => s.gameState.station.roadLevel);

  const layout = useMemo(() => getLayout({ station: { plots } }), [plots]);
  const roadHalfWidth = layout.roadHalfWidth * S;
  const farRoadZ = layout.farRoadLaneZ * S;

  /**
   * The band of ground the roadworks occupy: one carriageway now, both plus
   * the median once the road is widened.
   */
  const corridor = useMemo(
    () => ({
      minZ: (roadLevel >= 2 ? farRoadZ : roadZ) - roadHalfWidth,
      maxZ: roadZ + roadHalfWidth
    }),
    [roadLevel, farRoadZ, roadHalfWidth]
  );

  const { trees, bushes, lamps } = useMemo(() => {
    const rand = seeded(20240822);
    const treeList: Placement[] = [];
    const bushList: Placement[] = [];

    /**
     * Land the player has bought, and the roadworks themselves, are cleared:
     * a tree left standing on fresh concrete or in the middle of a new
     * carriageway is the one thing that gives the scenery away as decoration.
     */
    const isCleared = (x: number, z: number): boolean => {
      if (z > corridor.minZ - CLEARANCE && z < corridor.maxZ + CLEARANCE) return true;

      return plots.ownedParcels.some((key) => {
        const { col, row } = parseParcelKey(key);
        const b = parcelBounds(col, row);
        return (
          x > b.minX * S - CLEARANCE &&
          x < b.maxX * S + CLEARANCE &&
          z > b.minZ * S - CLEARANCE &&
          z < b.maxZ * S + CLEARANCE
        );
      });
    };

    const push = (x: number, z: number, scaleBase: number) => {
      // Draw the die either way so the layout stays stable as land is bought.
      const rotation = rand() * Math.PI * 2;
      const isTree = rand() > 0.34;
      if (isCleared(x, z)) return;

      const placement: Placement = { position: [x, 0, z], scale: scaleBase, rotation };
      if (isTree) treeList.push(placement);
      else bushList.push(placement);
    };

    // Jittered scatter across the whole map. Position depends only on the
    // cell, so a prop never moves when the plot changes size — it is either
    // there or it has been cleared away.
    for (let x = WORLD.minX; x < WORLD.maxX; x += SCATTER_CELL) {
      for (let z = WORLD.minZ; z < WORLD.maxZ; z += SCATTER_CELL) {
        const jitterX = x + rand() * SCATTER_CELL;
        const jitterZ = z + rand() * SCATTER_CELL;
        const scale = 0.6 + rand() * 1;
        // Leave natural gaps rather than covering every cell.
        const keep = rand() > 0.42;
        if (keep) push(jitterX, jitterZ, scale);
      }
    }

    // Lamps sit on the verge beyond whatever the road currently occupies.
    const lampZ = corridor.minZ - 4;
    const lampList: Placement[] = Array.from({ length: 9 }, (_, i) => ({
      position: [-30 + i * 22, 0, lampZ] as [number, number, number],
      scale: 1,
      rotation: 0
    }));

    // Never hand <Instances> more than its fixed buffer can hold.
    if (treeList.length > MAX_TREES || bushList.length > MAX_BUSHES) {
      console.warn(
        `[Scenery] Instance tavanı aşıldı (ağaç ${treeList.length}/${MAX_TREES}, ` +
          `çalı ${bushList.length}/${MAX_BUSHES}); fazlası çizilmeyecek.`
      );
    }

    return {
      trees: treeList.slice(0, MAX_TREES),
      bushes: bushList.slice(0, MAX_BUSHES),
      lamps: lampList.slice(0, MAX_LAMPS)
    };
  }, [plots.ownedParcels, corridor]);

  return (
    <group>
      {/* Trunks */}
      <Instances limit={MAX_TREES} range={trees.length}>
        <cylinderGeometry args={[0.24, 0.34, 2.8, 5]} />
        <meshStandardMaterial color="#5b4534" roughness={1} />
        {trees.map((t, i) => (
          <Instance
            key={i}
            position={[t.position[0], 1.4 * t.scale, t.position[2]]}
            scale={t.scale}
            rotation={[0, t.rotation, 0]}
          />
        ))}
      </Instances>

      {/* Canopies */}
      <Instances limit={MAX_TREES} range={trees.length}>
        <icosahedronGeometry args={[1.9, 0]} />
        <meshStandardMaterial color="#41802f" roughness={0.95} flatShading />
        {trees.map((t, i) => (
          <Instance
            key={i}
            position={[t.position[0], 3.9 * t.scale, t.position[2]]}
            scale={t.scale}
            rotation={[0, t.rotation, 0]}
          />
        ))}
      </Instances>

      {/* Shrubs */}
      <Instances limit={MAX_BUSHES} range={bushes.length}>
        <icosahedronGeometry args={[1.0, 0]} />
        <meshStandardMaterial color="#4d8f3c" roughness={1} flatShading />
        {bushes.map((b, i) => (
          <Instance
            key={i}
            position={[b.position[0], 0.65 * b.scale, b.position[2]]}
            scale={b.scale}
            rotation={[0, b.rotation, 0]}
          />
        ))}
      </Instances>

      {/* Street light columns */}
      <Instances limit={MAX_LAMPS} range={lamps.length}>
        <cylinderGeometry args={[0.16, 0.22, 6.8, 5]} />
        <meshStandardMaterial color="#64748b" roughness={0.6} metalness={0.4} />
        {lamps.map((l, i) => (
          <Instance key={i} position={[l.position[0], 3.4, l.position[2]]} />
        ))}
      </Instances>

      {/* Street light heads */}
      <Instances limit={MAX_LAMPS} range={lamps.length}>
        <boxGeometry args={[0.4, 0.25, 2.2]} />
        <meshStandardMaterial color="#475569" roughness={0.6} metalness={0.4} />
        {lamps.map((l, i) => (
          <Instance key={i} position={[l.position[0], 6.8, l.position[2] + 1.1]} />
        ))}
      </Instances>
    </group>
  );
};
