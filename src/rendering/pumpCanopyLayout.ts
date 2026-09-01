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
export function getPumpCanopyLayout(
  pump: PumpEntity,
  pumps: readonly PumpEntity[]
): PumpCanopyLayout {
  const baseHalfWidth = PUMP_CANOPY_BASE_WIDTH / 2;
  const baseHalfDepth = PUMP_CANOPY_BASE_DEPTH / 2;
  let nearestLeft: number | undefined;
  let nearestRight: number | undefined;
  let nearestNegativeZ: number | undefined;
  let nearestPositiveZ: number | undefined;

  const angle = (pump.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  for (const other of pumps) {
    if (other.id === pump.id || !other.hasCanopy || !sameAxis(pump, other)) continue;

    const dx = other.position[0] - pump.position[0];
    const dz = other.position[1] - pump.position[1];

    // Transform the neighbour into this pump group's local x/z axes.
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    if (Math.abs(localZ) <= 0.01) {
      const distance = Math.abs(localX);
      const clearGap = distance - PUMP_FOOTPRINT_WIDTH;
      if (distance >= 0.01 && clearGap <= PUMP_CANOPY_MAX_CLEAR_GAP + 0.01) {
        if (localX < 0 && (nearestLeft === undefined || distance < nearestLeft)) {
          nearestLeft = distance;
        }
        if (localX > 0 && (nearestRight === undefined || distance < nearestRight)) {
          nearestRight = distance;
        }
      }
    }

    if (Math.abs(localX) <= 0.01) {
      const distance = Math.abs(localZ);
      const clearGap = distance - PUMP_FOOTPRINT_DEPTH;
      if (distance >= 0.01 && clearGap <= PUMP_CANOPY_MAX_CLEAR_GAP + 0.01) {
        if (
          localZ < 0 &&
          (nearestNegativeZ === undefined || distance < nearestNegativeZ)
        ) {
          nearestNegativeZ = distance;
        }
        if (
          localZ > 0 &&
          (nearestPositiveZ === undefined || distance < nearestPositiveZ)
        ) {
          nearestPositiveZ = distance;
        }
      }
    }
  }

  const leftExtent =
    nearestLeft === undefined
      ? baseHalfWidth
      : (nearestLeft * WORLD_UNITS_PER_GRID_UNIT) / 2;
  const rightExtent =
    nearestRight === undefined
      ? baseHalfWidth
      : (nearestRight * WORLD_UNITS_PER_GRID_UNIT) / 2;
  const negativeZExtent =
    nearestNegativeZ === undefined
      ? baseHalfDepth
      : (nearestNegativeZ * WORLD_UNITS_PER_GRID_UNIT) / 2;
  const positiveZExtent =
    nearestPositiveZ === undefined
      ? baseHalfDepth
      : (nearestPositiveZ * WORLD_UNITS_PER_GRID_UNIT) / 2;

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
