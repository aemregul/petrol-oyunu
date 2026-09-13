import React, { useEffect, useMemo } from 'react';
import { decal } from './decal';
import { mottleTexture, wearMarks, wearTexture, WearBand, WearBay } from './concreteWear';
import { S, pavedSpan } from './forecourt';
import { PARCEL, parseParcelKey, parcelBounds, isOwned } from '../domain/services/land';
import {
  drivewayReserveRects,
  hourOfDay,
  pumpBayOffset,
  pumpFacesAcrossZ
} from '../domain/services/simulationEngine';
import { BuildingEntity, GameState, PumpEntity } from '../domain/types/gameState';

/** Unlit layers: one colour at every hour, clear of fog and tone mapping, like the concrete under them. */
const UNLIT = { transparent: true, depthWrite: false, toneMapped: false, fog: false } as const;

/**
 * What lies over the forecourt concrete (Emre, 2026-09-13): broad mottling
 * that hides the base texture's repeat, the wear cars leave where they stand,
 * drive and turn, and the shadows. The concrete is unlit so it keeps one light
 * colour round the clock, and an unlit surface takes no shadow — so the
 * shadows are laid on here as a layer of their own. How the wear is drawn is
 * in ./concreteWear.
 */
export const ForecourtWear: React.FC<{
  plots: GameState['station']['plots'];
  roadLevel: number;
  buildings: Record<string, BuildingEntity>;
  pumps: Record<string, PumpEntity>;
  cleanliness: number;
  /** The in-game clock, for how strongly the sun's shadows fall. */
  gameTime: number;
}> = ({ plots, roadLevel, buildings, pumps, cleanliness, gameTime }) => {
  const patches = plots.pavedParcels.flatMap((key) => {
    const { col, row } = parseParcelKey(key);
    if (!isOwned(plots.ownedParcels, col, row)) return [];
    const b = parcelBounds(col, row);
    const [front, back] = pavedSpan(b);
    return [{ key, westX: b.minX * S, northZ: front, width: PARCEL.width * S, depth: back - front }];
  });

  // Traffic runs through a block's mouths and down its lane only once there is
  // something over there to drive to; the near block always has the station.
  const farInUse =
    Object.values(buildings).some((b) => b.position[1] < 0) ||
    Object.values(pumps).some((p) => p.position[1] < 0);
  const world = { station: { plots, roadLevel }, buildings, pumps };
  const bands: WearBand[] = (farInUse ? (['near', 'far'] as const) : (['near'] as const)).flatMap((side) =>
    drivewayReserveRects(world, side).map((r) => ({
      minX: r.minX * S,
      maxX: r.maxX * S,
      minZ: r.minZ * S,
      maxZ: r.maxZ * S,
      kind: r.kind
    }))
  );
  const bays: WearBay[] = Object.values(pumps).map((pump) => {
    const [ox, oz] = pumpBayOffset(pump);
    return {
      x: (pump.position[0] + ox) * S,
      z: (pump.position[1] + oz) * S,
      along: pumpFacesAcrossZ(pump) ? 'x' : 'z'
    };
  });

  // The game state is cloned on every tick, so everything above is a new
  // object each render. Reduced to plain numbers and keyed on as a string, the
  // canvases are redrawn only when the layout actually moves.
  const layoutKey = JSON.stringify({ patches, bands, bays });
  const wear = useMemo(() => {
    const marks = wearMarks(bands, bays);
    return new Map(patches.map((p) => [p.key, wearTexture(p, marks)] as const));
  }, [layoutKey]);
  useEffect(() => () => wear.forEach((texture) => texture?.dispose()), [wear]);

  // A kept forecourt still shows where cars go; a neglected one shows it plainly.
  const dirt = Math.min(1, Math.max(0, 1 - cleanliness / 100));
  const wearOpacity = 0.4 + 0.6 * dirt;

  // Shadows fall clearly by day and only faintly overnight, when the light
  // casting them is a sun set low across the plot.
  const hour = hourOfDay(gameTime);
  const daylight = Math.min(1, Math.max(0, Math.min(hour - 5.5, 20.5 - hour) / 1.5));
  const shadowOpacity = 0.06 + 0.2 * daylight;

  return (
    <group>
      {patches.map((p) => {
        const texture = wear.get(p.key) ?? null;
        const x = p.westX + p.width / 2;
        const z = p.northZ + p.depth / 2;

        return (
          <group key={p.key}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.021, z]}>
              <planeGeometry args={[p.width, p.depth]} />
              <meshBasicMaterial map={mottleTexture(p.width, p.depth, p.westX, p.northZ)} {...UNLIT} {...decal(0.3)} />
            </mesh>
            {texture && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.022, z]}>
                <planeGeometry args={[p.width, p.depth]} />
                <meshBasicMaterial map={texture} opacity={wearOpacity} {...UNLIT} {...decal(0.4)} />
              </mesh>
            )}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.023, z]} receiveShadow>
              <planeGeometry args={[p.width, p.depth]} />
              <shadowMaterial opacity={shadowOpacity} transparent depthWrite={false} fog={false} {...decal(0.5)} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
};
