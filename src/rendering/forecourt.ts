import { LAYOUT, FORECOURT_FRONT } from '../domain/services/simulationEngine';
import { parcelBounds } from '../domain/services/land';

/**
 * Where the concrete actually goes, in world units.
 *
 * A parcel and its forecourt are not the same rectangle: the strip between the
 * road and the concrete line is verge, so a road-facing parcel is poured a
 * square short of its own boundary. Anything that draws the forecourt — the
 * apron itself, its kerbs, the snap grid, the land-buying overlay — has to
 * agree on that, and they only agree if there is one place that decides it.
 *
 * They did not, and it showed: the buy overlay drew the full parcel while the
 * concrete drew the trimmed one, so a plot on offer sat a square proud of the
 * forecourt beside it and then "moved" once it was bought and poured.
 */

/** Grid units to world units. Every mesh on the ground shares this scale. */
export const S = 2;

/** The near forecourt's front edge: the verge line, on a build-cell boundary. */
export const APRON_FRONT = FORECOURT_FRONT * S;

const FAR_ROAD_Z = (LAYOUT.roadZ - 2 * LAYOUT.roadHalfWidth - LAYOUT.medianWidth) * S;

/**
 * The far forecourt's road-facing edge, mirrored: rounded away from its own
 * carriageway onto a cell boundary, and never past the land itself.
 */
export const FAR_APRON_FRONT = Math.min(
  Math.floor((FAR_ROAD_Z - LAYOUT.roadHalfWidth * S - LAYOUT.vergeDepth * S) / S) * S,
  parcelBounds(0, -1).maxZ * S
);

/**
 * The z span a parcel's concrete occupies, in world units — the parcel itself,
 * trimmed back from whichever carriageway it fronts.
 */
export function pavedSpan(b: { minZ: number; maxZ: number }): [number, number] {
  return b.minZ >= 0
    ? [Math.max(b.minZ * S, APRON_FRONT), b.maxZ * S]
    : [b.minZ * S, Math.min(b.maxZ * S, FAR_APRON_FRONT)];
}
