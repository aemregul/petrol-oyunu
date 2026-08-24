import React, { useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import { useGameStore } from '../store/gameStore';
import { LAYOUT, getLayout } from '../domain/services/simulationEngine';
import { parseParcelKey, parcelBounds } from '../domain/services/land';

const S = 2;
const roadZ = LAYOUT.roadZ * S;

/** Nothing decorative may stand this close to owned land or tarmac. */
const CLEARANCE = 1.5;

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

  const plotWidth = plots.width * S;
  const plotDepth = plots.height * S;

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

    // Treeline behind the station and along the far side of the highway.
    for (let i = 0; i < 26; i++) {
      push(-55 + rand() * (plotWidth + 120), plotDepth + 9 + rand() * 34, 0.8 + rand() * 0.85);
    }
    for (let i = 0; i < 24; i++) {
      push(-55 + rand() * (plotWidth + 120), roadZ - 40 + rand() * 28, 0.8 + rand() * 0.85);
    }

    // Shrubs hugging the left and right edges of the plot.
    for (let i = 0; i < 14; i++) {
      const onLeft = i % 2 === 0;
      push(
        onLeft ? -9 - rand() * 18 : plotWidth + 9 + rand() * 18,
        2 + rand() * (plotDepth - 4),
        0.6 + rand() * 0.6
      );
    }

    // Lamps sit on the verge beyond whatever the road currently occupies.
    const lampZ = corridor.minZ - 4;
    const lampList: Placement[] = Array.from({ length: 9 }, (_, i) => ({
      position: [-30 + i * 22, 0, lampZ] as [number, number, number],
      scale: 1,
      rotation: 0
    }));

    return { trees: treeList, bushes: bushList, lamps: lampList };
  }, [plotWidth, plotDepth, plots.ownedParcels, corridor]);

  return (
    <group>
      {/* Trunks */}
      <Instances limit={trees.length} range={trees.length}>
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
      <Instances limit={trees.length} range={trees.length}>
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
      <Instances limit={Math.max(1, bushes.length)} range={bushes.length}>
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
      <Instances limit={lamps.length} range={lamps.length}>
        <cylinderGeometry args={[0.16, 0.22, 6.8, 5]} />
        <meshStandardMaterial color="#64748b" roughness={0.6} metalness={0.4} />
        {lamps.map((l, i) => (
          <Instance key={i} position={[l.position[0], 3.4, l.position[2]]} />
        ))}
      </Instances>

      {/* Street light heads */}
      <Instances limit={lamps.length} range={lamps.length}>
        <boxGeometry args={[0.4, 0.25, 2.2]} />
        <meshStandardMaterial color="#475569" roughness={0.6} metalness={0.4} />
        {lamps.map((l, i) => (
          <Instance key={i} position={[l.position[0], 6.8, l.position[2] + 1.1]} />
        ))}
      </Instances>
    </group>
  );
};
