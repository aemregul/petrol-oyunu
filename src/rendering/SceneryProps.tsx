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
import { lampsAreLit } from './LightPole';
import { LampGlow } from './LampGlow';

const S = 2;
const roadZ = LAYOUT.roadZ * S;

/** Nothing decorative may stand this close to owned land or tarmac. */
const CLEARANCE = 1.5;

/** Grass between a road kerb and the forecourt — the ground the ramps cross. */
const VERGE_DEPTH = LAYOUT.vergeDepth * S;

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

/** Lighting columns: a regular run either side of the plot, motorway-spaced. */
const LAMP_SPACING = 26;
const LAMP_COUNT = 13;
const LAMP_FIRST_X = -60;

/**
 * How far the arm reaches from the column. The forecourt lamp only has to
 * clear its own base, but a column standing in the central reservation has to
 * get its lens out over the kerb or it lights nothing but the grass it stands
 * on — which is exactly what a short arm did.
 */
const LAMP_ARM = 2.6;
/** Length and tilt of the arm that spans it, from column top to lens. */
const LAMP_ARM_LENGTH = Math.hypot(LAMP_ARM, 0.5);
const LAMP_ARM_TILT = -Math.atan2(LAMP_ARM, 0.5);

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
  const gameTime = useGameStore((s) => s.gameState.dayState.gameTime);
  const weather = useGameStore((s) => s.gameState.dayState.weather);

  const isDark = lampsAreLit(gameTime, weather);

  const layout = useMemo(() => getLayout({ station: { plots } }), [plots]);
  const roadHalfWidth = layout.roadHalfWidth * S;
  const farRoadZ = layout.farRoadLaneZ * S;

  /**
   * The band of ground the roadworks occupy: the carriageways, the median
   * between them, and — the part that used to be missed — the verges either
   * side that the driveways are built across.
   *
   * Leaving the verges out left a strip of ground the scatter still treated as
   * countryside even though it is where every ramp lands, so a shrub could end
   * up standing in the middle of one. The far verge is deeper than the near
   * one, because the parcels over there already begin clear of the road.
   */
  const corridor = useMemo(
    () => ({
      minZ:
        roadLevel >= 2
          ? Math.min(
              farRoadZ - roadHalfWidth - VERGE_DEPTH,
              parcelBounds(0, -1).maxZ * S
            )
          : roadZ - roadHalfWidth,
      maxZ: roadZ + roadHalfWidth + VERGE_DEPTH
    }),
    [roadLevel, farRoadZ, roadHalfWidth]
  );

  const { trees, bushes } = useMemo(() => {
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

    // Never hand <Instances> more than its fixed buffer can hold.
    if (treeList.length > MAX_TREES || bushList.length > MAX_BUSHES) {
      console.warn(
        `[Scenery] Instance tavanı aşıldı (ağaç ${treeList.length}/${MAX_TREES}, ` +
          `çalı ${bushList.length}/${MAX_BUSHES}); fazlası çizilmeyecek.`
      );
    }

    return {
      trees: treeList.slice(0, MAX_TREES),
      bushes: bushList.slice(0, MAX_BUSHES)
    };
  }, [plots.ownedParcels, corridor]);

  /**
   * Lighting columns down the middle of the roadworks: open countryside while
   * the highway is single, the central reservation once it is widened. That
   * strip is never buyable and no driveway crosses it, so a column can never
   * end up standing on a forecourt or in a ramp mouth — and none of them move
   * when the road is upgraded.
   *
   * Each one faces the carriageway it lights: they all lean over the near lane
   * at first, then alternate so the far lane gets its share.
   */
  const lamps = useMemo(() => {
    const z = roadZ - roadHalfWidth - (LAYOUT.medianWidth * S) / 2;
    return Array.from({ length: LAMP_COUNT }, (_, i) => ({
      x: LAMP_FIRST_X + i * LAMP_SPACING,
      z,
      // Rotating by -90° swings the arm from +x round to +z, the near lane.
      yaw: roadLevel >= 2 && i % 2 === 1 ? Math.PI / 2 : -Math.PI / 2
    })).slice(0, MAX_LAMPS);
  }, [roadLevel, roadHalfWidth]);

  /** World position of a part sitting `dx` along the arm's own axis. */
  const lampPart = (
    lamp: { x: number; z: number; yaw: number },
    dx: number,
    y: number
  ): [number, number, number] => [
    lamp.x + dx * Math.cos(lamp.yaw),
    y,
    lamp.z - dx * Math.sin(lamp.yaw)
  ];

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

      {/* Lamp base plinths */}
      <Instances limit={MAX_LAMPS} range={lamps.length}>
        <cylinderGeometry args={[0.34, 0.42, 0.36, 10]} />
        <meshStandardMaterial color="#475569" roughness={0.8} />
        {lamps.map((l, i) => (
          <Instance key={i} position={lampPart(l, 0, 0.18)} />
        ))}
      </Instances>

      {/* Tapered columns */}
      <Instances limit={MAX_LAMPS} range={lamps.length}>
        <cylinderGeometry args={[0.12, 0.2, 6.8, 10]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.55} roughness={0.45} />
        {lamps.map((l, i) => (
          <Instance key={i} position={lampPart(l, 0, 3.6)} />
        ))}
      </Instances>

      {/* Arms reaching out over the carriageway */}
      <Instances limit={MAX_LAMPS} range={lamps.length}>
        <cylinderGeometry args={[0.1, 0.13, LAMP_ARM_LENGTH, 10]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.55} roughness={0.45} />
        {lamps.map((l, i) => (
          <Instance
            key={i}
            position={lampPart(l, LAMP_ARM / 2, 7.1)}
            rotation={[0, l.yaw, LAMP_ARM_TILT]}
          />
        ))}
      </Instances>

      {/* Lamp housings */}
      <Instances limit={MAX_LAMPS} range={lamps.length}>
        <boxGeometry args={[1.15, 0.26, 0.55]} />
        <meshStandardMaterial color="#64748b" metalness={0.5} roughness={0.5} />
        {lamps.map((l, i) => (
          <Instance key={i} position={lampPart(l, LAMP_ARM, 7.28)} rotation={[0, l.yaw, 0]} />
        ))}
      </Instances>

      {/* Lenses, lit from dusk by the same photocell as the forecourt lamps. */}
      <Instances limit={MAX_LAMPS} range={lamps.length}>
        <boxGeometry args={[0.95, 0.1, 0.42]} />
        <meshStandardMaterial
          color="#fff6d8"
          emissive="#ffe9a8"
          emissiveIntensity={isDark ? 3 : 0.08}
          toneMapped={false}
        />
        {lamps.map((l, i) => (
          <Instance key={i} position={lampPart(l, LAMP_ARM, 7.12)} rotation={[0, l.yaw, 0]} />
        ))}
      </Instances>

      {/* What the columns are for. Thirteen real lights would cost more than
          the rest of the scene put together, so the carriageway is lit with
          the same pools and flares the forecourt lamps throw — from this
          camera that is what the eye reads as a lit road anyway. */}
      {lamps.map((l, i) => (
        <LampGlow
          key={`glow${i}`}
          position={lampPart(l, LAMP_ARM, 7.08)}
          reach={7.5}
          shaft={false}
          lit={isDark}
        />
      ))}
    </group>
  );
};
