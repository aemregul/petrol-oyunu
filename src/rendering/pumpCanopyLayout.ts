import { PumpEntity } from '../domain/types/gameState';

/** Three.js world units occupied by one placement-grid unit. */
const WORLD_UNITS_PER_GRID_UNIT = 2;

/** The stock roof is 6.4 world units wide in PumpMesh. */
export const PUMP_CANOPY_BASE_WIDTH = 6.4;
/** The stock roof is 5.8 world units deep in PumpMesh. */
export const PUMP_CANOPY_BASE_DEPTH = 5.8;

/**
 * The largest empty space allowed between the two pump footprints.
 *
 * This deliberately measures clear grid cells, not centre-to-centre distance:
 * two pumps with five units of empty forecourt between their island edges
 * still receive one continuous roof.
 */
export const PUMP_CANOPY_MAX_CLEAR_GAP = 5;

/** pump_standard's unrotated placement footprint, in grid units. */
const PUMP_FOOTPRINT_WIDTH = 2;
const PUMP_FOOTPRINT_DEPTH = 3;

export interface PumpCanopyLayout {
  width: number;
  offsetX: number;
  leftExtent: number;
  rightExtent: number;
  depth: number;
  offsetZ: number;
  negativeZExtent: number;
  positiveZExtent: number;
  joinsLeft: boolean;
  joinsRight: boolean;
  joinsNegativeZ: boolean;
  joinsPositiveZ: boolean;
}

const sameAxis = (a: PumpEntity, b: PumpEntity): boolean =>
  a.rotation % 180 === b.rotation % 180;

/**
 * Sizes one island's piece of a shared canopy.
 *
 * Neighbours must have roofs and face along the same axis. A neighbour on the
 * same row joins the local x edges; one on the same column joins the local z
 * edges. Each piece ends at the midpoint between the pumps. This stretches
 * across gaps on both axes and trims overlapping inner edges, leaving one
 * continuous deck without coplanar slabs fighting over the same pixels.
 */
/** A frame of local axes: the way one pump group is turned. */
interface Frame {
  cos: number;
  sin: number;
}

/** The joinable neighbours of `pump` along each local axis, as grid distances. */
interface Neighbours {
  left?: number;
  right?: number;
  negativeZ?: number;
  positiveZ?: number;
  /** The islands joined along local x and along local z, for the edge rule below. */
  rowMates: PumpEntity[];
  columnMates: PumpEntity[];
}

function nearestNeighbours(
  pump: PumpEntity,
  pumps: readonly PumpEntity[],
  frame: Frame
): Neighbours {
  const found: Neighbours = { rowMates: [], columnMates: [] };

  for (const other of pumps) {
    if (other.id === pump.id || !other.hasCanopy || !sameAxis(pump, other)) continue;

    const dx = other.position[0] - pump.position[0];
    const dz = other.position[1] - pump.position[1];

    // Transform the neighbour into the frame's local x/z axes.
    const localX = dx * frame.cos - dz * frame.sin;
    const localZ = dx * frame.sin + dz * frame.cos;

    if (Math.abs(localZ) <= 0.01) {
      const distance = Math.abs(localX);
      const clearGap = distance - PUMP_FOOTPRINT_WIDTH;
      if (distance >= 0.01 && clearGap <= PUMP_CANOPY_MAX_CLEAR_GAP + 0.01) {
        if (localX < 0 && (found.left === undefined || distance < found.left)) {
          found.left = distance;
        }
        if (localX > 0 && (found.right === undefined || distance < found.right)) {
          found.right = distance;
        }
        found.rowMates.push(other);
      }
    }

    if (Math.abs(localX) <= 0.01) {
      const distance = Math.abs(localZ);
      const clearGap = distance - PUMP_FOOTPRINT_DEPTH;
      if (distance >= 0.01 && clearGap <= PUMP_CANOPY_MAX_CLEAR_GAP + 0.01) {
        if (localZ < 0 && (found.negativeZ === undefined || distance < found.negativeZ)) {
          found.negativeZ = distance;
        }
        if (localZ > 0 && (found.positiveZ === undefined || distance < found.positiveZ)) {
          found.positiveZ = distance;
        }
        found.columnMates.push(other);
      }
    }
  }

  return found;
}

/**
 * Every island joined to `pump` along one axis, directly or through others,
 * `pump` itself included — the run of roof that shares an edge.
 */
function chainAlong(
  pump: PumpEntity,
  pumps: readonly PumpEntity[],
  frame: Frame,
  along: 'rowMates' | 'columnMates'
): PumpEntity[] {
  const seen = new Map<string, PumpEntity>([[pump.id, pump]]);
  const queue = [pump];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const mate of nearestNeighbours(current, pumps, frame)[along]) {
      if (seen.has(mate.id)) continue;
      seen.set(mate.id, mate);
      queue.push(mate);
    }
  }
  return [...seen.values()];
}

/** World half-extent on one side: to the midpoint of a neighbour, else stock. */
function sideExtent(neighbour: number | undefined, base: number): number {
  return neighbour === undefined ? base : (neighbour * WORLD_UNITS_PER_GRID_UNIT) / 2;
}

export function getPumpCanopyLayout(
  pump: PumpEntity,
  pumps: readonly PumpEntity[]
): PumpCanopyLayout {
  const baseHalfWidth = PUMP_CANOPY_BASE_WIDTH / 2;
  const baseHalfDepth = PUMP_CANOPY_BASE_DEPTH / 2;

  const angle = (pump.rotation * Math.PI) / 180;
  const frame = { cos: Math.cos(angle), sin: Math.sin(angle) };
  const near = nearestNeighbours(pump, pumps, frame);
  const { left: nearestLeft, right: nearestRight } = near;
  const { negativeZ: nearestNegativeZ, positiveZ: nearestPositiveZ } = near;

  // A side that meets a neighbour ends at the midpoint between them. A side
  // that meets nobody is stock width — unless the piece is part of a chain
  // along the other axis in which SOME member meets a neighbour on that side:
  // then every piece in the chain ends where that member does, and the edge
  // runs straight the length of the chain. Stock width there left a step at
  // every join between a row and a column of islands (Emre, 2026-09-07:
  // "o pay hiç olmasın"). The shortest such reach wins, so no piece ever
  // overlaps the neighbour a chain-mate is joined to. Measured in this
  // pump's frame, so a mate turned the other way about still lines up.
  const chainReach = (
    chain: PumpEntity[],
    side: 'left' | 'right' | 'negativeZ' | 'positiveZ',
    base: number
  ): number => {
    const reach = chain.reduce((shortest, mate) => {
      const joined = nearestNeighbours(mate, pumps, frame)[side];
      return joined === undefined ? shortest : Math.min(shortest, sideExtent(joined, base));
    }, Infinity);
    return Number.isFinite(reach) ? reach : base;
  };

  const column = chainAlong(pump, pumps, frame, 'columnMates');
  const row = chainAlong(pump, pumps, frame, 'rowMates');

  const leftExtent =
    nearestLeft === undefined
      ? chainReach(column, 'left', baseHalfWidth)
      : sideExtent(nearestLeft, baseHalfWidth);
  const rightExtent =
    nearestRight === undefined
      ? chainReach(column, 'right', baseHalfWidth)
      : sideExtent(nearestRight, baseHalfWidth);
  const negativeZExtent =
    nearestNegativeZ === undefined
      ? chainReach(row, 'negativeZ', baseHalfDepth)
      : sideExtent(nearestNegativeZ, baseHalfDepth);
  const positiveZExtent =
    nearestPositiveZ === undefined
      ? chainReach(row, 'positiveZ', baseHalfDepth)
      : sideExtent(nearestPositiveZ, baseHalfDepth);

  return {
    width: leftExtent + rightExtent,
    offsetX: (rightExtent - leftExtent) / 2,
    leftExtent,
    rightExtent,
    depth: negativeZExtent + positiveZExtent,
    offsetZ: (positiveZExtent - negativeZExtent) / 2,
    negativeZExtent,
    positiveZExtent,
    joinsLeft: nearestLeft !== undefined,
    joinsRight: nearestRight !== undefined,
    joinsNegativeZ: nearestNegativeZ !== undefined,
    joinsPositiveZ: nearestPositiveZ !== undefined
  };
}
