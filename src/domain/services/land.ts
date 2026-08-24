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
  // Front-row paving costs a little more: it carries the driveway traffic.
  return row === 0 ? 9500 : 8000;
}

/** Land cannot be bought beyond these limits, so the map stays bounded. */
export const LAND_BOUNDS = { minCol: -2, maxCol: 5, minRow: 0, maxRow: 4 };

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
  return {
    minX: col * PARCEL.width,
    minZ: row * PARCEL.depth,
    maxX: (col + 1) * PARCEL.width,
    maxZ: (row + 1) * PARCEL.depth
  };
}

/** Which parcel a grid point falls in. */
export function parcelAt(x: number, z: number): ParcelCoord {
  return {
    col: Math.floor(x / PARCEL.width),
    row: Math.floor(z / PARCEL.depth)
  };
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

/** A parcel can be bought when it touches something already owned. */
export function isBuyable(owned: string[], col: number, row: number): boolean {
  if (isOwned(owned, col, row)) return false;
  if (col < LAND_BOUNDS.minCol || col > LAND_BOUNDS.maxCol) return false;
  if (row < LAND_BOUNDS.minRow || row > LAND_BOUNDS.maxRow) return false;

  return (
    isOwned(owned, col - 1, row) ||
    isOwned(owned, col + 1, row) ||
    isOwned(owned, col, row - 1) ||
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
  const frontage = row === 0 ? 1.45 : row === 1 ? 1.1 : 1;
  return Math.round((base * frontage) / 500) * 500;
}

export function buyableParcels(owned: string[]): ParcelCoord[] {
  const out: ParcelCoord[] = [];
  for (let col = LAND_BOUNDS.minCol; col <= LAND_BOUNDS.maxCol; col++) {
    for (let row = LAND_BOUNDS.minRow; row <= LAND_BOUNDS.maxRow; row++) {
      if (isBuyable(owned, col, row)) out.push({ col, row });
    }
  }
  return out;
}
