import React, { useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import {
  LAYOUT,
  getLayout,
  wideRamps,
  priceSignPosition,
  drivewayMouths,
  DRIVEWAY_WIDTH as DRIVEWAY_WIDTH_GRID
} from '../domain/services/simulationEngine';
import {
  PARCEL,
  parseParcelKey,
  parcelBounds,
  isOwned,
  pavedFrontage
} from '../domain/services/land';

/** Grid units to world units; every mesh below shares this scale. */
const S = 2;

const roadZ = LAYOUT.roadZ * S;
const roadHalfWidth = LAYOUT.roadHalfWidth * S;

/** Kerbs are a trim detail, not a wall — keep them low and narrow. */
const KERB = { width: 0.34, height: 0.16 };

/** Gap between the road kerb and the forecourt, bridged by the driveways. */
const VERGE_DEPTH = LAYOUT.vergeDepth * S;

/**
 * How much room the price totem takes up *along the road* at each level. The
 * board stands square across the carriageway, so what the beds either side of
 * it have to clear is its depth and its plinth, not the width of its face.
 */
const PRICE_TOTEM_WIDTH = [1.4, 1.5, 1.6];

/** Default width of a driveway mouth; a wide ramp opens a broader one. */
const DRIVEWAY_WIDTH = DRIVEWAY_WIDTH_GRID * S;

/**
 * One opening in the kerb line: where it is and how much of the kerb it eats.
 * Widths vary now that a mouth can be upgraded, so they travel together.
 */
interface Mouth {
  x: number;
  width: number;
}

/**
 * Splits a kerb or edge-line run into the pieces that survive after the
 * driveways cut through it. Vehicles must never have to cross a raised kerb.
 */
function kerbSegments(from: number, to: number, mouths: Mouth[]): Array<[number, number]> {
  const cuts = [...mouths].sort((a, b) => a.x - b.x);

  const out: Array<[number, number]> = [];
  let cursor = from;

  for (const mouth of cuts) {
    const gapStart = mouth.x - mouth.width / 2;
    const gapEnd = mouth.x + mouth.width / 2;
    if (gapEnd < from || gapStart > to) continue;
    if (gapStart > cursor) out.push([cursor, Math.min(gapStart, to)]);
    cursor = Math.max(cursor, gapEnd);
  }

  if (cursor < to) out.push([cursor, to]);
  return out.filter(([a, b]) => b - a > 0.4);
}

/**
 * Driveway joining a carriageway to a forecourt.
 *
 * The ramp stops at the kerb line instead of running onto the carriageway,
 * and it is only as wide as two cars so it does not eat into the buildable
 * forecourt.
 */
const Driveway: React.FC<{
  x: number;
  apronFront: number;
  entering: boolean;
  halfWidth: number;
  /** Centre of the carriageway this mouth joins. */
  roadCentreZ: number;
  /** Far-side driveways leave from the opposite kerb. */
  far?: boolean;
}> = ({ x, apronFront, entering, halfWidth, roadCentreZ, far = false }) => {
  // Near side sits at +z, far side at -z, so "entering" points opposite ways.
  const travelsTowardPositiveZ = far ? !entering : entering;

  const from = far ? apronFront : roadCentreZ + halfWidth;
  const depth = far
    ? Math.max(0.4, roadCentreZ - halfWidth - apronFront)
    : Math.max(0.4, apronFront - from);
  const midZ = far ? apronFront + depth / 2 : from + depth / 2;

  return (
    <group position={[x, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, midZ]} receiveShadow>
        <planeGeometry args={[DRIVEWAY_WIDTH, depth]} />
        <meshStandardMaterial color="#2b3340" roughness={0.8} />
      </mesh>

      {/* Painted arrow, sized from the mouth so it never runs off the tarmac.
          The group's local +y points to world -z once it is laid flat, so a
          ramp whose traffic runs toward +z needs the extra half turn. */}
      <group
        position={[0, 0.034, midZ]}
        rotation={[-Math.PI / 2, 0, travelsTowardPositiveZ ? Math.PI : 0]}
      >
        {(() => {
          // Fit the arrow inside the shorter of the two dimensions.
          const total = Math.min(depth * 0.78, DRIVEWAY_WIDTH * 0.5);
          // An equilateral triangle of circumradius r spans 1.5r along its
          // axis, from -r/2 (base) to +r (apex).
          const r = Math.min((total * 0.45) / 1.5, (DRIVEWAY_WIDTH * 0.42) / 1.73);
          const shaftLength = Math.max(0.1, total - 1.5 * r);

          return (
            <>
              <mesh position={[0, -0.75 * r, 0]}>
                <planeGeometry args={[r * 0.62, shaftLength]} />
                <meshBasicMaterial color="#f1f5f9" />
              </mesh>
              <mesh position={[0, total / 2 - r, 0]} rotation={[0, 0, Math.PI / 2]}>
                <circleGeometry args={[r, 3]} />
                <meshBasicMaterial color="#f1f5f9" />
              </mesh>
            </>
          );
        })()}
      </group>
    </group>
  );
};

/**
 * One one-way carriageway: asphalt, a solid white line along each edge and a
 * dashed yellow line down the middle of the lane. Upgrading the road mirrors
 * this same piece across a landscaped median rather than widening it.
 */
const Carriageway: React.FC<{
  centreX: number;
  centreZ: number;
  /** Each driveway mouth that meets this carriageway, in world units. */
  mouths: Mouth[];
  /**
   * Which edge those driveways are on: +1 for the +z side, -1 for -z. That
   * edge is broken into dashes where a mouth crosses it, the way a real road
   * marks a place traffic may leave the carriageway.
   */
  drivewaySide: 1 | -1;
}> = ({ centreX, centreZ, mouths, drivewaySide }) => {
  const laneDashes = useMemo(
    () => Array.from({ length: 90 }, (_, i) => -260 + i * 6),
    []
  );

  const from = centreX - 300;
  const to = centreX + 300;

  /** Short dashes filling one driveway mouth. */
  const crossingDashes = (mouth: Mouth) => {
    const half = mouth.width / 2;
    const step = 1.6;
    const out: number[] = [];
    for (let x = mouth.x - half + step / 2; x < mouth.x + half; x += step) out.push(x);
    return out;
  };

  return (
    <group position={[centreX, 0, centreZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[600, roadHalfWidth * 2]} />
        <meshStandardMaterial color="#2b3340" roughness={0.8} />
      </mesh>

      {/* Edge lines. Solid all the way along, except across a mouth. */}
      {([1, -1] as const).map((side) => {
        const z = side * (roadHalfWidth - 0.5);
        const isCrossed = side === drivewaySide;

        if (!isCrossed) {
          return (
            <mesh
              key={`edge${side}`}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.02, z]}
            >
              <planeGeometry args={[600, 0.22]} />
              <meshBasicMaterial color="#e8edf3" />
            </mesh>
          );
        }

        return (
          <group key={`edge${side}`}>
            {kerbSegments(from, to, mouths).map(([a, b]) => (
              <mesh
                key={`solid${a}`}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[(a + b) / 2 - centreX, 0.02, z]}
              >
                <planeGeometry args={[b - a, 0.22]} />
                <meshBasicMaterial color="#e8edf3" />
              </mesh>
            ))}

            {mouths.flatMap((mouth) =>
              crossingDashes(mouth).map((x) => (
                <mesh
                  key={`cross${mouth.x}_${x}`}
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={[x - centreX, 0.02, z]}
                >
                  <planeGeometry args={[0.85, 0.22]} />
                  <meshBasicMaterial color="#e8edf3" />
                </mesh>
              ))
            )}
          </group>
        );
      })}

      {/* Dashed yellow line down the middle of the lane */}
      {laneDashes.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, 0]}>
          <planeGeometry args={[3.2, 0.24]} />
          <meshBasicMaterial color="#e0b114" />
        </mesh>
      ))}
    </group>
  );
};

/**
 * The central reservation, planted.
 *
 * A bare strip of grass between two carriageways reads as unfinished ground
 * rather than as part of the road, so it gets what a real one gets: a low
 * hedge running its length, broken up by trees and beds at intervals.
 */
const MedianPlanting: React.FC<{ centreX: number; centreZ: number }> = ({
  centreX,
  centreZ
}) => {
  const beds = useMemo(
    () => Array.from({ length: 40 }, (_, i) => -240 + i * 12),
    []
  );

  return (
    <group position={[centreX, 0, centreZ]}>
      {/* Continuous clipped hedge down the middle. */}
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[600, 0.84, 1.5]} />
        <meshStandardMaterial color="#2f6b28" roughness={1} flatShading />
      </mesh>
      {/* A paler crown on top, so it does not read as a solid green wall. */}
      <mesh position={[0, 0.9, 0]} receiveShadow>
        <boxGeometry args={[600, 0.16, 1.2]} />
        <meshStandardMaterial color="#498f34" roughness={1} flatShading />
      </mesh>

      {beds.map((x, i) => {
        // Every third bed carries a tree; the rest are low colour.
        const isTree = i % 3 === 0;
        const side = i % 2 === 0 ? -1 : 1;

        return (
          <group key={x} position={[x, 0, 0]}>
            {isTree ? (
              <>
                <mesh position={[0, 1.5, 0]} castShadow>
                  <cylinderGeometry args={[0.16, 0.22, 3, 6]} />
                  <meshStandardMaterial color="#5b4534" roughness={1} />
                </mesh>
                <mesh position={[0, 3.4, 0]} castShadow>
                  <icosahedronGeometry args={[1.35, 0]} />
                  <meshStandardMaterial color="#3f8a2f" roughness={0.95} flatShading />
                </mesh>
                <mesh position={[0, 4.3, 0.2]} castShadow>
                  <icosahedronGeometry args={[0.9, 0]} />
                  <meshStandardMaterial color="#4fa03a" roughness={0.95} flatShading />
                </mesh>
              </>
            ) : (
              <>
                {/* A kerbed bed of flowering shrubs. */}
                <mesh position={[0, 0.12, side * 0.9]} receiveShadow>
                  <boxGeometry args={[3.4, 0.24, 1.6]} />
                  <meshStandardMaterial color="#b9c0cb" roughness={0.9} />
                </mesh>
                {[-1, 0, 1].map((slot) => (
                  <mesh
                    key={slot}
                    position={[slot * 1.05, 0.5, side * 0.9]}
                    castShadow
                  >
                    <icosahedronGeometry args={[0.46, 0]} />
                    <meshStandardMaterial
                      color={slot === 0 ? '#c2506a' : '#4d8f3c'}
                      roughness={1}
                      flatShading
                    />
                  </mesh>
                ))}
              </>
            )}
          </group>
        );
      })}
    </group>
  );
};

/**
 * The planted strip of verge between the two mouths.
 *
 * On a real forecourt this is never left as bare grass: it is the frontage
 * everybody sees from the road, so it gets a kerbed bed, a clipped hedge and a
 * few shrubs either side of the price board. It appears with the board and
 * follows it, because it is the same piece of ground.
 */
const FrontageLanding: React.FC<{
  /** The stretch the beds may occupy, in world units. */
  from: number;
  to: number;
  /** Where the board actually stands, which is what they are laid out around. */
  signX: number;
  signZ: number;
  signWidth: number;
}> = ({ from, to, signX, signZ, signWidth }) => {
  const beds = useMemo(() => {
    const out: Array<{ x: number; width: number }> = [];

    // Two beds, one either side of the board, each stopping clear of it and of
    // the ramp mouths. The clearances are measured off the board rather than
    // guessed, because on a starting plot the frontage between the two mouths
    // is only a few metres wide and a guess leaves no room for either bed.
    const clear = signWidth / 2 + 0.7;
    const kerb = 0.6;
    const spans: Array<[number, number]> = [
      [from + kerb, signX - clear],
      [signX + clear, to - kerb]
    ];

    for (const [a, b] of spans) {
      if (b - a >= 1.6) out.push({ x: (a + b) / 2, width: Math.min(b - a, 6.5) });
    }
    return out;
  }, [from, to, signX, signWidth]);

  return (
    <group>
      {beds.map((bed) => (
        <group key={bed.x} position={[bed.x, 0, signZ]}>
          {/* Kerbed bed, set into the verge. */}
          <mesh position={[0, 0.1, 0]} receiveShadow>
            <boxGeometry args={[bed.width, 0.2, 2.4]} />
            <meshStandardMaterial color="#b9c0cb" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.22, 0]} receiveShadow>
            <boxGeometry args={[bed.width - 0.5, 0.06, 1.9]} />
            <meshStandardMaterial color="#4a3527" roughness={1} />
          </mesh>

          {/* A low hedge along the back, shrubs in front of it. */}
          <mesh position={[0, 0.55, -0.6]} castShadow receiveShadow>
            <boxGeometry args={[bed.width - 0.8, 0.7, 0.7]} />
            <meshStandardMaterial color="#2f6b28" roughness={1} flatShading />
          </mesh>

          {(() => {
            const count = Math.max(1, Math.floor(bed.width / 2.6));
            const span = bed.width - 1.6;
            const step = count > 1 ? span / (count - 1) : 0;
            return Array.from({ length: count }, (_, i) => {
              const x = count > 1 ? -span / 2 + i * step : 0;
              return (
                <mesh key={i} position={[x, 0.55, 0.5]} castShadow>
                  <icosahedronGeometry args={[0.44, 0]} />
                  <meshStandardMaterial
                    color={i % 2 === 0 ? '#c2506a' : '#4d8f3c'}
                    roughness={1}
                    flatShading
                  />
                </mesh>
              );
            });
          })()}
        </group>
      ))}
    </group>
  );
};

/** Post-and-rail fence marking land that is owned but not yet paved. */
const ParcelFence: React.FC<{ col: number; row: number }> = ({ col, row }) => {
  const b = parcelBounds(col, row);
  const minX = b.minX * S;
  const maxX = b.maxX * S;
  const minZ = b.minZ * S;
  const maxZ = b.maxZ * S;

  const posts = useMemo(() => {
    const spacing = 4;
    const out: Array<[number, number]> = [];
    for (let x = minX; x <= maxX + 0.01; x += spacing) {
      out.push([x, minZ], [x, maxZ]);
    }
    for (let z = minZ + spacing; z < maxZ - 0.01; z += spacing) {
      out.push([minX, z], [maxX, z]);
    }
    return out;
  }, [minX, maxX, minZ, maxZ]);

  const rails: Array<{ pos: [number, number, number]; size: [number, number, number] }> = [
    { pos: [(minX + maxX) / 2, 0.75, minZ], size: [maxX - minX, 0.09, 0.09] },
    { pos: [(minX + maxX) / 2, 0.75, maxZ], size: [maxX - minX, 0.09, 0.09] },
    { pos: [minX, 0.75, (minZ + maxZ) / 2], size: [0.09, 0.09, maxZ - minZ] },
    { pos: [maxX, 0.75, (minZ + maxZ) / 2], size: [0.09, 0.09, maxZ - minZ] }
  ];

  return (
    <group>
      {/* Bare ground inside the fence, so it reads as unfinished */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(minX + maxX) / 2, 0.012, (minZ + maxZ) / 2]}
        receiveShadow
      >
        <planeGeometry args={[maxX - minX, maxZ - minZ]} />
        <meshStandardMaterial color="#6b6250" roughness={1} />
      </mesh>

      {posts.map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, 0.5, z]} castShadow>
          <boxGeometry args={[0.14, 1, 0.14]} />
          <meshStandardMaterial color="#a4813f" roughness={0.9} />
        </mesh>
      ))}
      {rails.map((rail, i) => (
        <mesh key={i} position={rail.pos} castShadow>
          <boxGeometry args={rail.size} />
          <meshStandardMaterial color="#c9a253" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
};

/**
 * The ground: landscape, the highway and the concrete forecourt.
 *
 * The apron is deliberately unmarked. Parking bays and lanes are things the
 * player builds, so painting them here would clash with their own layout.
 */
export const GroundGrid: React.FC = () => {
  const plots = useGameStore((s) => s.gameState.station.plots);
  const buildMode = useGameStore((s) => s.buildMode.active);
  const weather = useGameStore((s) => s.gameState.dayState.weather);
  const cleanliness = useGameStore((s) => s.gameState.station.cleanliness);
  const roadLevel = useGameStore((s) => s.gameState.station.roadLevel);
  const buildings = useGameStore((s) => s.gameState.buildings);
  const pumps = useGameStore((s) => s.gameState.pumps);

  const isDualCarriageway = roadLevel >= 2;

  // Derived from the plot rather than selected: returning a fresh object from
  // a zustand selector would re-render on every store write.
  const layout = useMemo(
    () => getLayout({ station: { plots }, buildings }),
    [plots, buildings]
  );

  const farRoadZ = layout.farRoadLaneZ * S;

  // A mouth only exists where a ramp is actually drawn, so the kerb and the
  // edge line are cut in exactly the same places and nowhere else. A wide ramp
  // takes its mouth over: it is drawn as the building the player bought, so
  // only the opening it needs is cut here.
  const nearMouths: Mouth[] = [
    { x: layout.entryX * S, width: layout.entryWidth * S },
    { x: layout.exitX * S, width: layout.exitWidth * S }
  ];

  /**
   * The board the frontage planting is laid out around, and where it actually
   * stands: on the mark the layout picks, unless the player has moved it. Read
   * the same way the mesh does, so the beds cannot end up somewhere the board
   * is not — the stored position lags by a tick while the game is paused.
   */
  const priceSign = useMemo(() => {
    const sign = Object.values(buildings).find((b) => b.type === 'price_sign');
    if (!sign) return null;

    const at = sign.movedByPlayer
      ? sign.position
      : priceSignPosition({ station: { plots, roadLevel }, buildings });

    return { level: sign.level, x: at[0] * S, z: at[1] * S };
  }, [buildings, plots, roadLevel]);

  /** Mouths the player has not upgraded still need their default ramp drawn. */
  const wide = useMemo(() => wideRamps(buildings), [buildings]);

  /** The far block's own pair, which the player can widen independently. */
  const farPair = useMemo(
    () => drivewayMouths({ station: { plots }, buildings }, 'far'),
    [plots, buildings]
  );

  const plotWidth = plots.width * S;
  const plotDepth = plots.height * S;

  // The forecourt starts a verge's width back from the carriageway.
  const apronFront = roadZ + roadHalfWidth + VERGE_DEPTH;

  const apronColor = weather === 'RAIN' ? '#232c39' : '#39424f';
  const apronRoughness = weather === 'RAIN' ? 0.35 : 0.7 + (1 - cleanliness / 100) * 0.25;

  const unpaved = plots.ownedParcels.filter((key) => !plots.pavedParcels.includes(key));

  // Mirror of apronFront for land across the highway. The far parcels already
  // begin past the verge line, so a plain mirror would leave the ramps ending
  // in the grass a little short of the concrete: take whichever edge is
  // further from the road so the two always meet.
  const farApronFront = Math.min(
    farRoadZ - roadHalfWidth - VERGE_DEPTH,
    parcelBounds(0, -1).maxZ * S
  );
  /**
   * Far-side mouths only appear once something is actually built over there.
   * Bare or freshly paved land needs no access road yet.
   */
  const hasFarSideBuilding = useMemo(() => {
    const onFarSide = (position: [number, number]) => position[1] < 0;
    return (
      Object.values(buildings).some((b) => onFarSide(b.position)) ||
      Object.values(pumps).some((p) => onFarSide(p.position))
    );
  }, [buildings, pumps]);

  /**
   * The strip of far-side concrete that meets the road, as a world-x span. A
   * mouth the player has not placed themselves is pulled inside it, so a ramp
   * never ends in the grass when the block across the road sits over different
   * columns to the station.
   */
  const farFrontage = useMemo(() => {
    const span = pavedFrontage(plots.pavedParcels, -1);
    return span ? { min: span.minX * S, max: span.maxX * S } : null;
  }, [plots.pavedParcels]);

  /** The far block's mouths in world units, kept keyed by the job each does. */
  const farByRole: Record<'entry' | 'exit', Mouth> | null =
    isDualCarriageway && hasFarSideBuilding && farFrontage
      ? {
          entry: farWorldMouth('entry'),
          exit: farWorldMouth('exit')
        }
      : null;

  function farWorldMouth(role: 'entry' | 'exit'): Mouth {
    const mouth = farPair[role];
    const width = mouth.width * S;
    // A ramp the player placed is already on their concrete; only the
    // mirrored default needs holding inside the far frontage.
    if (wide.far[role] || !farFrontage) return { x: mouth.x * S, width };

    const half = width / 2;
    const lo = farFrontage.min + half;
    const hi = farFrontage.max - half;
    const centre =
      hi < lo ? (farFrontage.min + farFrontage.max) / 2 : Math.min(Math.max(mouth.x * S, lo), hi);
    return { x: centre, width };
  }

  const farMouths: Mouth[] = farByRole ? [farByRole.entry, farByRole.exit] : [];

  /**
   * World-space z span of a parcel, held clear of the carriageway. Near-side
   * parcels are trimmed at their front edge, far-side ones at their back.
   */
  const parcelSpan = (b: { minZ: number; maxZ: number }): [number, number] =>
    b.minZ >= 0
      ? [Math.max(b.minZ * S, apronFront), b.maxZ * S]
      : [b.minZ * S, Math.min(b.maxZ * S, farApronFront)];

  return (
    <group>
      {/* Surrounding landscape */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[plotWidth / 2, -0.06, plotDepth / 2]}
        receiveShadow
      >
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#3f5a2c" roughness={0.95} />
      </mesh>

      {/* The carriageway that serves this station */}
      <Carriageway
        centreX={plotWidth / 2}
        centreZ={roadZ}
        mouths={nearMouths}
        drivewaySide={1}
      />

      {/* Its mirror image, added when the road is upgraded */}
      {isDualCarriageway && (
        <>
          <Carriageway
            centreX={plotWidth / 2}
            centreZ={farRoadZ}
            mouths={farMouths}
            drivewaySide={-1}
          />

          {/* Landscaped central reservation between the two */}
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[plotWidth / 2, 0.01, (roadZ + farRoadZ) / 2]}
            receiveShadow
          >
            <planeGeometry args={[600, LAYOUT.medianWidth * S]} />
            <meshStandardMaterial color="#3f5a2c" roughness={0.95} />
          </mesh>
          <MedianPlanting
            centreX={plotWidth / 2}
            centreZ={(roadZ + farRoadZ) / 2}
          />
        </>
      )}

      {/* Shoulder kerb. Only the edge a driveway actually meets is broken —
          the other side stays continuous, so no phantom mouths appear. */}
      {[
        { z: roadZ, offset: roadHalfWidth, gaps: nearMouths },
        { z: roadZ, offset: -roadHalfWidth, gaps: [] as Mouth[] },
        ...(isDualCarriageway
          ? [
              { z: farRoadZ, offset: -roadHalfWidth, gaps: farMouths },
              { z: farRoadZ, offset: roadHalfWidth, gaps: [] as Mouth[] }
            ]
          : [])
      ].map(({ z, offset, gaps }) =>
        kerbSegments(plotWidth / 2 - 300, plotWidth / 2 + 300, gaps).map(([a, b]) => (
          <mesh
            key={`sh${z}_${offset}_${a}`}
            position={[(a + b) / 2, 0.08, z + offset]}
            receiveShadow
          >
            <boxGeometry args={[b - a, 0.16, 0.6]} />
            <meshStandardMaterial color="#c3cad4" roughness={0.9} />
          </mesh>
        ))
      )}

      {/* Paved parcels */}
      {plots.pavedParcels.map((key) => {
        const { col, row } = parseParcelKey(key);
        if (!isOwned(plots.ownedParcels, col, row)) return null;

        const b = parcelBounds(col, row);
        const [front, back] = parcelSpan(b);

        return (
          <mesh
            key={key}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[((b.minX + b.maxX) / 2) * S, 0.02, (front + back) / 2]}
            receiveShadow
          >
            <planeGeometry args={[PARCEL.width * S, back - front]} />
            <meshStandardMaterial
              color={apronColor}
              roughness={apronRoughness}
              metalness={0.05}
            />
          </mesh>
        );
      })}

      {/* Land bought but not yet paved: fenced off and bare */}
      {unpaved.map((key) => {
        const { col, row } = parseParcelKey(key);
        return <ParcelFence key={key} col={col} row={row} />;
      })}

      {/* Thin kerb along every paved edge that faces open ground */}
      {plots.pavedParcels.map((key) => {
        const { col, row } = parseParcelKey(key);
        const b = parcelBounds(col, row);
        const [front, back] = parcelSpan(b);
        const left = b.minX * S;
        const right = b.maxX * S;

        const edges: Array<{
          show: boolean;
          pos: [number, number, number];
          size: [number, number, number];
        }> = [
          // The road-facing edge is emitted separately below so it can open.
          {
            show: row < 0 && !plots.pavedParcels.includes(`${col},${row - 1}`),
            pos: [(left + right) / 2, KERB.height / 2, front],
            size: [right - left, KERB.height, KERB.width]
          },
          {
            show: row >= 0 && !plots.pavedParcels.includes(`${col},${row + 1}`),
            pos: [(left + right) / 2, KERB.height / 2, back],
            size: [right - left, KERB.height, KERB.width]
          },
          {
            show: !plots.pavedParcels.includes(`${col - 1},${row}`),
            pos: [left, KERB.height / 2, (front + back) / 2],
            size: [KERB.width, KERB.height, back - front]
          },
          {
            show: !plots.pavedParcels.includes(`${col + 1},${row}`),
            pos: [right, KERB.height / 2, (front + back) / 2],
            size: [KERB.width, KERB.height, back - front]
          }
        ];

        // Edge that looks onto the highway. Only rows 0 and -1 actually front
        // it, and they face each other across the carriageways rather than
        // touching — so neither may swallow the other's kerb. Deeper rows just
        // butt onto the parcel in front of them and need no mouths cut.
        const roadEdgeZ = row < 0 ? back : front;
        const frontsHighway = row === 0 || row === -1;
        const parcelInFront = row < 0 ? `${col},${row + 1}` : `${col},${row - 1}`;
        const roadEdgePieces: Array<[number, number]> = frontsHighway
          ? kerbSegments(left, right, row < 0 ? farMouths : nearMouths)
          : plots.pavedParcels.includes(parcelInFront)
            ? []
            : [[left, right]];

        return (
          <group key={`kerb_${key}`}>
            {roadEdgePieces.map(([a, b]) => (
              <mesh
                key={`front_${a}`}
                position={[(a + b) / 2, KERB.height / 2, roadEdgeZ]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[b - a, KERB.height, KERB.width]} />
                <meshStandardMaterial color="#c3cad4" roughness={0.85} />
              </mesh>
            ))}
            {edges
              .filter((e) => e.show)
              .map((e, i) => (
                <mesh key={i} position={e.pos} castShadow receiveShadow>
                  <boxGeometry args={e.size} />
                  <meshStandardMaterial color="#c3cad4" roughness={0.85} />
                </mesh>
              ))}
          </group>
        );
      })}

      {/* Beds laid out around the price board, wherever it is standing. On the
          verge they are held between the two mouths so they never run into a
          ramp; moved onto the concrete they simply flank the board. */}
      {priceSign && (
        <FrontageLanding
          {...(() => {
            const onVerge = priceSign.z < apronFront;

            return onVerge
              ? {
                  from: Math.min(nearMouths[0].x, nearMouths[1].x) + nearMouths[0].width / 2,
                  to: Math.max(nearMouths[0].x, nearMouths[1].x) - nearMouths[1].width / 2
                }
              : {
                  // On the concrete the beds simply flank the board, but they
                  // are still part of the forecourt and stop at its edge.
                  from: Math.max(0, priceSign.x - 9),
                  to: Math.min(plotWidth, priceSign.x + 9)
                };
          })()}
          signX={priceSign.x}
          signZ={priceSign.z}
          signWidth={PRICE_TOTEM_WIDTH[Math.min(3, Math.max(1, priceSign.level)) - 1]}
        />
      )}

      {/* Default driveway ramps. A mouth the player has widened is drawn by
          the ramp they bought instead, so the old one is not left underneath
          it — that is the same mouth, not a second one. */}
      {!wide.near.entry && (
        <Driveway
          x={layout.entryX * S}
          apronFront={apronFront}
          halfWidth={roadHalfWidth}
          roadCentreZ={roadZ}
          entering
        />
      )}
      {!wide.near.exit && (
        <Driveway
          x={layout.exitX * S}
          apronFront={apronFront}
          halfWidth={roadHalfWidth}
          roadCentreZ={roadZ}
          entering={false}
        />
      )}

      {/* Once the far side is developed it needs its own mouths */}
      {farByRole && (
        <>
          {!wide.far.entry && (
            <Driveway
              x={farByRole.entry.x}
              apronFront={farApronFront}
              halfWidth={roadHalfWidth}
              roadCentreZ={farRoadZ}
              entering
              far
            />
          )}
          {!wide.far.exit && (
            <Driveway
              x={farByRole.exit.x}
              apronFront={farApronFront}
              halfWidth={roadHalfWidth}
              roadCentreZ={farRoadZ}
              entering={false}
              far
            />
          )}
        </>
      )}

      {/* Build grid, drawn per owned parcel so it follows the land the player
          actually holds — including the block across the road — instead of one
          square anchored at the origin. */}
      {buildMode &&
        plots.pavedParcels.map((key) => {
          const { col, row } = parseParcelKey(key);
          const b = parcelBounds(col, row);
          const [front, back] = parcelSpan(b);

          return (
            <gridHelper
              key={`grid_${key}`}
              args={[PARCEL.width * S, PARCEL.width, '#38bdf8', '#0ea5e9']}
              position={[
                ((b.minX + b.maxX) / 2) * S,
                0.09,
                (front + back) / 2
              ]}
              scale={[1, 1, (back - front) / (PARCEL.width * S)]}
            />
          );
        })}
    </group>
  );
};
