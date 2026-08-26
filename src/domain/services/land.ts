/**
 * Parcel-based land ownership.
 *
 * The station no longer owns a rectangle that stretches when you buy more.
 * The map is divided into fixed parcels and each purchase adds exactly one,
 * so growth is local: widening the front does not drag the back with it, and
 * the shape of the plot reflects what was actually bought.
 *
 * All coordinates here are grid cells; the renderer scales by the 2m cell.
 */

/** One parcel of land. Row 0 is the strip that fronts the highway. */
export const PARCEL = { width: 8, depth: 7 } as const;

/** The parcels the station starts with: a 2x2 block against the road. */
export const STARTING_PARCELS = ['0,0', '1,0', '0,1', '1,1'];

/**
 * Paving is a separate purchase from the land itself. Bare land is fenced off
 * and unusable; concrete has to be laid before anything can be built on it.
 */
export function paveCost(row: number): number {
  // Road-facing paving costs a little more: it carries the driveway traffic.
  return row === 0 || row === -1 ? 9500 : 8000;
}

/**
 * Row 0 fronts the highway on the near side and rows count away from it.
 * Negative rows sit across the road and only open once it is widened; row -1
 * is the strip nearest the far kerb.
 */
export const FAR_SIDE_FRONT = -14;

/** Land cannot be bought beyond these limits, so the map stays bounded. */
export const LAND_BOUNDS = { minCol: -2, maxCol: 5, minRow: -3, maxRow: 4 };

/** True for parcels on the far side of the highway. */
export function isFarSide(row: number): boolean {
  return row < 0;
}

export interface ParcelCoord {
  col: number;
  row: number;
}

export interface ParcelBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function parcelKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function parseParcelKey(key: string): ParcelCoord {
  const [col, row] = key.split(',').map(Number);
  return { col, row };
}

export function parcelBounds(col: number, row: number): ParcelBounds {
  const minX = col * PARCEL.width;
  const maxX = (col + 1) * PARCEL.width;

  if (!isFarSide(row)) {
    return { minX, minZ: row * PARCEL.depth, maxX, maxZ: (row + 1) * PARCEL.depth };
  }

  // Far side stacks away from the road, so row -1 is closest to it.
  const maxZ = FAR_SIDE_FRONT - (-row - 1) * PARCEL.depth;
  return { minX, minZ: maxZ - PARCEL.depth, maxX, maxZ };
}

/** Which parcel a grid point falls in. */
export function parcelAt(x: number, z: number): ParcelCoord {
  const col = Math.floor(x / PARCEL.width);

  if (z >= 0) return { col, row: Math.floor(z / PARCEL.depth) };

  // Anything past the far kerb belongs to a negative row.
  if (z > FAR_SIDE_FRONT) return { col, row: 0 };
  return { col, row: -1 - Math.floor((FAR_SIDE_FRONT - z) / PARCEL.depth) };
}

export function isOwned(owned: string[], col: number, row: number): boolean {
  return owned.includes(parcelKey(col, row));
}

/**
 * The bounding box of everything owned. Kept as `plots.width/height` so the
 * camera, lane layout and grid overlay have a simple rectangle to work with,
 * even when the owned shape is ragged.
 */
export function ownedBounds(owned: string[]): {
  minX: number;
  minZ: number;
  width: number;
  height: number;
} {
  if (owned.length === 0) {
    return { minX: 0, minZ: 0, width: PARCEL.width, height: PARCEL.depth };
  }

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (const key of owned) {
    const { col, row } = parseParcelKey(key);
    const b = parcelBounds(col, row);
    minX = Math.min(minX, b.minX);
    minZ = Math.min(minZ, b.minZ);
    maxX = Math.max(maxX, b.maxX);
    maxZ = Math.max(maxZ, b.maxZ);
  }

  return { minX, minZ, width: maxX, height: maxZ };
}

/**
 * Bounds of the station block itself — only the land on this side of the
 * highway. Lane positions and the apron clamp describe where the station's
 * own traffic drives, so a parcel bought across the road must not stretch
 * them: that would drag the exit driveway off the forecourt and into the
 * verge. Use `ownedBounds` for anything that spans both sides.
 */
export function stationBounds(owned: string[]): ReturnType<typeof ownedBounds> {
  return ownedBounds(owned.filter((key) => !isFarSide(parseParcelKey(key).row)));
}

/**
 * Grid x span of the paved parcels fronting the highway on one side of it —
 * row 0 on the station's side, row -1 across the road. Anything that has to
 * meet the carriageway, a driveway mouth above all, has to sit inside this or
 * it opens onto bare ground.
 */
export function pavedFrontage(
  paved: string[],
  row: 0 | -1 = 0
): { minX: number; maxX: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;

  for (const key of paved) {
    const parcel = parseParcelKey(key);
    if (parcel.row !== row) continue;
    const b = parcelBounds(parcel.col, parcel.row);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
  }

  return minX < maxX ? { minX, maxX } : null;
}

/**
 * The block across the highway, as an explicit box in grid units, or null if
 * the player holds nothing over there. `ownedBounds` measures width and height
 * from the origin, which says nothing useful about land sitting at negative z.
 */
export function farSideBounds(parcels: string[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const key of parcels) {
    const { col, row } = parseParcelKey(key);
    if (!isFarSide(row)) continue;
    const b = parcelBounds(col, row);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }

  return minX < maxX ? { minX, maxX, minZ, maxZ } : null;
}

/** True when every corner of a footprint sits on land the player owns. */
export function isFootprintOnOwnedLand(
  owned: string[],
  footprint: { minX: number; minZ: number; maxX: number; maxZ: number }
): boolean {
  // Step across the footprint so a span wider than one parcel is fully checked.
  const stepX = PARCEL.width / 2;
  const stepZ = PARCEL.depth / 2;

  for (let x = footprint.minX; x <= footprint.maxX; x = Math.min(x + stepX, footprint.maxX)) {
    for (let z = footprint.minZ; z <= footprint.maxZ; z = Math.min(z + stepZ, footprint.maxZ)) {
      // Sample just inside the edge so a boundary-touching footprint counts.
      const sampleX = Math.min(Math.max(x, footprint.minX + 0.01), footprint.maxX - 0.01);
      const sampleZ = Math.min(Math.max(z, footprint.minZ + 0.01), footprint.maxZ - 0.01);
      const { col, row } = parcelAt(sampleX, sampleZ);
      if (!isOwned(owned, col, row)) return false;

      if (z >= footprint.maxZ) break;
    }
    if (x >= footprint.maxX) break;
  }

  return true;
}

/**
 * A parcel can be bought when it touches something already owned. The two
 * sides of the highway are separate blocks, so crossing to the far side needs
 * the widened road and only works straight across from land you already hold.
 */
export function isBuyable(
  owned: string[],
  col: number,
  row: number,
  roadLevel: 1 | 2 = 1
): boolean {
  if (isOwned(owned, col, row)) return false;
  if (col < LAND_BOUNDS.minCol || col > LAND_BOUNDS.maxCol) return false;
  if (row < LAND_BOUNDS.minRow || row > LAND_BOUNDS.maxRow) return false;

  if (isFarSide(row)) {
    if (roadLevel < 2) return false;

    // Either extend an existing far-side holding, or cross the road from a
    // near-side parcel in the same column.
    const neighbours =
      isOwned(owned, col - 1, row) ||
      isOwned(owned, col + 1, row) ||
      isOwned(owned, col, row - 1) ||
      (row < -1 && isOwned(owned, col, row + 1));

    return neighbours || (row === -1 && isOwned(owned, col, 0));
  }

  return (
    isOwned(owned, col - 1, row) ||
    isOwned(owned, col + 1, row) ||
    (row > 0 && isOwned(owned, col, row - 1)) ||
    isOwned(owned, col, row + 1)
  );
}

/**
 * Land gets dearer the more you hold, and frontage on the highway costs a
 * premium — that is the parcel customers actually drive past.
 */
export function parcelPrice(owned: string[], row: number): number {
  const beyondStart = Math.max(0, owned.length - STARTING_PARCELS.length);
  const base = 24000 * Math.pow(1.35, beyondStart);
  const facesRoad = row === 0 || row === -1;
  const frontage = facesRoad ? 1.45 : Math.abs(row) === 1 ? 1.1 : 1;
  return Math.round((base * frontage) / 500) * 500;
}

export function buyableParcels(owned: string[], roadLevel: 1 | 2 = 1): ParcelCoord[] {
  const out: ParcelCoord[] = [];
  for (let col = LAND_BOUNDS.minCol; col <= LAND_BOUNDS.maxCol; col++) {
    for (let row = LAND_BOUNDS.minRow; row <= LAND_BOUNDS.maxRow; row++) {
      if (isBuyable(owned, col, row, roadLevel)) out.push({ col, row });
    }
  }
  return out;
}
