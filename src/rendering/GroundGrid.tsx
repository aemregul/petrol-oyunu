import React, { useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { LAYOUT, getLayout } from '../domain/services/simulationEngine';
import { PARCEL, parseParcelKey, parcelBounds, isOwned } from '../domain/services/land';

/** Grid units to world units; every mesh below shares this scale. */
const S = 2;

const roadZ = LAYOUT.roadZ * S;

/** The carriageway widens when the player pays to upgrade it. */
function roadHalfWidthFor(roadLevel: number): number {
  return (roadLevel >= 2 ? LAYOUT.roadHalfWidthWide : LAYOUT.roadHalfWidth) * S;
}

/** Kerbs are a trim detail, not a wall — keep them low and narrow. */
const KERB = { width: 0.34, height: 0.16 };

/** Gap between the road kerb and the forecourt, bridged by the driveways. */
const VERGE_DEPTH = 3.2;

/** Width of a driveway mouth, and the gap it needs in both kerb lines. */
const DRIVEWAY_WIDTH = 6;

/**
 * Splits a kerb run into the pieces that survive after the driveways cut
 * through it. Vehicles must never have to cross a raised kerb.
 */
function kerbSegments(from: number, to: number, gapCentres: number[]): Array<[number, number]> {
  const half = DRIVEWAY_WIDTH / 2;
  const cuts = [...gapCentres].sort((a, b) => a - b);

  const out: Array<[number, number]> = [];
  let cursor = from;

  for (const centre of cuts) {
    const gapStart = centre - half;
    const gapEnd = centre + half;
    if (gapEnd < from || gapStart > to) continue;
    if (gapStart > cursor) out.push([cursor, Math.min(gapStart, to)]);
    cursor = Math.max(cursor, gapEnd);
  }

  if (cursor < to) out.push([cursor, to]);
  return out.filter(([a, b]) => b - a > 0.4);
}

/** White dashed lane marking running the length of the carriageway. */
const LaneDashes: React.FC<{ centreX: number; offset: number }> = ({ centreX, offset }) => {
  const dashes = useMemo(() => Array.from({ length: 80 }, (_, i) => -240 + i * 6), []);

  return (
    <group position={[centreX, 0.02, roadZ + offset]}>
      {dashes.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0, 0]}>
          <planeGeometry args={[3.4, 0.24]} />
          <meshBasicMaterial color="#e2e8f0" />
        </mesh>
      ))}
    </group>
  );
};

/**
 * Driveway joining the highway to the forecourt.
 *
 * The ramp stops at the verge instead of running onto the carriageway, and it
 * is only as wide as two cars so it does not eat into the buildable forecourt.
 */
const Driveway: React.FC<{
  x: number;
  apronFront: number;
  entering: boolean;
  halfWidth: number;
  /** Far-side driveways leave from the opposite kerb. */
  far?: boolean;
}> = ({ x, apronFront, entering, halfWidth, far = false }) => {
  // Runs from the road kerb to the forecourt edge, exactly filling the gap
  // left in both kerb lines.
  const from = far ? apronFront : roadZ + halfWidth;
  const depth = far
    ? Math.max(0.4, roadZ - halfWidth - apronFront)
    : Math.max(0.4, apronFront - from);
  const midZ = far ? apronFront + depth / 2 : from + depth / 2;

  return (
    <group position={[x, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, midZ]} receiveShadow>
        <planeGeometry args={[DRIVEWAY_WIDTH, depth]} />
        <meshStandardMaterial color="#2b3340" roughness={0.8} />
      </mesh>

      {/* Painted arrow, sized from the mouth so it never runs off the tarmac */}
      <group position={[0, 0.034, midZ]} rotation={[-Math.PI / 2, 0, entering ? 0 : Math.PI]}>
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

  const roadHalfWidth = roadHalfWidthFor(roadLevel);
  const isDualCarriageway = roadLevel >= 2;

  // Derived from the plot rather than selected: returning a fresh object from
  // a zustand selector would re-render on every store write.
  const layout = useMemo(() => getLayout({ station: { plots } }), [plots]);

  const plotWidth = plots.width * S;
  const plotDepth = plots.height * S;

  // The forecourt starts a verge's width back from the carriageway.
  const apronFront = roadZ + roadHalfWidth + VERGE_DEPTH;

  const apronColor = weather === 'RAIN' ? '#232c39' : '#39424f';
  const apronRoughness = weather === 'RAIN' ? 0.35 : 0.7 + (1 - cleanliness / 100) * 0.25;

  const unpaved = plots.ownedParcels.filter((key) => !plots.pavedParcels.includes(key));

  // Mirror of apronFront for land across the highway.
  const farApronFront = roadZ - roadHalfWidth - VERGE_DEPTH;
  const hasFarSideLand = plots.ownedParcels.some((key) => parseParcelKey(key).row < 0);

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

      {/* Carriageway */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[plotWidth / 2, 0, roadZ]} receiveShadow>
        <planeGeometry args={[600, roadHalfWidth * 2]} />
        <meshStandardMaterial color="#2b3340" roughness={0.8} />
      </mesh>

      {/* A single lane needs no centre line; a dual carriageway gets one. */}
      {isDualCarriageway &&
        [-0.32, 0.32].map((offset) => (
          <mesh
            key={`centre${offset}`}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[plotWidth / 2, 0.02, roadZ + offset]}
          >
            <planeGeometry args={[600, 0.24]} />
            <meshBasicMaterial color="#e0b114" />
          </mesh>
        ))}

      {/* Dashed white lane lines */}
      {(isDualCarriageway
        ? [-roadHalfWidth * 0.58, roadHalfWidth * 0.58]
        : [-roadHalfWidth + 0.9, roadHalfWidth - 0.9]
      ).map((offset) => (
        <LaneDashes key={`dash${offset}`} centreX={plotWidth / 2} offset={offset} />
      ))}

      {/* Pale shoulder kerb, fully open where each driveway crosses it */}
      {[-roadHalfWidth, roadHalfWidth].map((offset) =>
        kerbSegments(plotWidth / 2 - 300, plotWidth / 2 + 300, [
          layout.entryX * S,
          layout.exitX * S
        ]).map(([a, b]) => (
          <mesh
            key={`sh${offset}_${a}`}
            position={[(a + b) / 2, 0.08, roadZ + offset]}
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

        // Edge that looks onto the highway, cut open at the driveways.
        const roadEdgeZ = row < 0 ? back : front;
        const neighbourTowardRoad = row < 0 ? `${col},${row + 1}` : `${col},${row - 1}`;
        const roadEdgePieces = plots.pavedParcels.includes(neighbourTowardRoad)
          ? []
          : kerbSegments(left, right, [layout.entryX * S, layout.exitX * S]);

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

      {/* Driveway ramps */}
      <Driveway
        x={layout.entryX * S}
        apronFront={apronFront}
        halfWidth={roadHalfWidth}
        entering
      />
      <Driveway
        x={layout.exitX * S}
        apronFront={apronFront}
        halfWidth={roadHalfWidth}
        entering={false}
      />

      {/* Once the far side is developed it needs its own mouths */}
      {hasFarSideLand && (
        <>
          <Driveway
            x={layout.entryX * S}
            apronFront={farApronFront}
            halfWidth={roadHalfWidth}
            entering={false}
            far
          />
          <Driveway
            x={layout.exitX * S}
            apronFront={farApronFront}
            halfWidth={roadHalfWidth}
            entering
            far
          />
        </>
      )}

      {/* Build grid overlay */}
      {buildMode && (
        <gridHelper
          args={[
            Math.max(plotWidth, plotDepth),
            Math.max(plots.width, plots.height),
            '#38bdf8',
            '#0ea5e9'
          ]}
          position={[plotWidth / 2, 0.09, plotDepth / 2]}
        />
      )}
    </group>
  );
};
