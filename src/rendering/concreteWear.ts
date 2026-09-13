import * as THREE from 'three';

/**
 * Concrete that has been lived on (Emre, 2026-09-13: make the concrete look
 * more real). Two layers laid over the pour drawn in ./concrete:
 *
 * - Mottling: broad, soft variation in the pour on a tile far larger than the
 *   base texture's and out of step with it, so the base's repeat no longer
 *   reads as the same blotches marching across the forecourt.
 * - Wear: oil drips where cars stand at the pumps, tyre marks down the mouths
 *   and the driving lane, and curving ones where cars turn in off the road,
 *   out of it, and into and out of each pump bay. It is drawn from where cars
 *   actually go, and the caller fades it with the station's cleanliness, so a
 *   neglected forecourt looks it.
 *
 * Both are drawn once into canvases and redrawn only when the layout changes;
 * everything here is in world units.
 */

/** World units one mottling tile covers; deliberately not a multiple of the base tile's 8. */
const MOTTLE_WORLD = 58;
const MOTTLE_PX = 512;

/** Pixels per world unit in the wear canvases. Soft stains need little. */
const WEAR_PX = 24;

/** Half the distance between a car's left and right wheels. */
const TRACK_HALF = 0.78;

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Noise tied to a spot on the ground, so a mark keeps its shape when the
 * layout is redrawn and one crossing into the next parcel is drawn the same on
 * both sides of the seam.
 */
function spotRandom(x: number, z: number, salt: number): () => number {
  const hash =
    (Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(z * 10), 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
  return makeRandom(hash || 1);
}

/** A soft round blotch, drawn at every neighbouring tile position so the tile repeats without a seam. */
function wrappedBlotch(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  tone: string,
  alpha: number
): void {
  for (const ox of [-MOTTLE_PX, 0, MOTTLE_PX]) {
    for (const oy of [-MOTTLE_PX, 0, MOTTLE_PX]) {
      const gradient = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
      gradient.addColorStop(0, `rgba(${tone}, ${alpha})`);
      gradient.addColorStop(1, `rgba(${tone}, 0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
    }
  }
}

function drawMottle(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MOTTLE_PX;
  const ctx = canvas.getContext('2d')!;
  const random = makeRandom(0x6d0771);

  // Broad variation between one pour and the next: mostly a shade darker,
  // now and then a paler wash. Kept faint on the light unlit pour, where
  // anything stronger turned the forecourt cloudy instead of one colour.
  for (let i = 0; i < 34; i++) {
    const dark = random() < 0.65;
    wrappedBlotch(
      ctx,
      random() * MOTTLE_PX,
      random() * MOTTLE_PX,
      MOTTLE_PX * (0.06 + random() * 0.2),
      dark ? '70, 71, 68' : '236, 236, 231',
      dark ? 0.025 + random() * 0.045 : 0.03 + random() * 0.04
    );
  }

  // Smaller patches, about a trowel's width, to break the broad ones up.
  for (let i = 0; i < 120; i++) {
    wrappedBlotch(
      ctx,
      random() * MOTTLE_PX,
      random() * MOTTLE_PX,
      MOTTLE_PX * (0.01 + random() * 0.03),
      '78, 79, 76',
      0.015 + random() * 0.025
    );
  }

  return canvas;
}

let mottleSource: THREE.CanvasTexture | null = null;
const mottleClones = new Map<string, THREE.Texture>();

/**
 * The mottling for one patch of ground, phased on the world so it runs
 * unbroken from one parcel into the next — the same offset arithmetic as the
 * base texture, which explains the negated z.
 */
export function mottleTexture(width: number, depth: number, westX: number, northZ: number): THREE.Texture {
  const key = `${width}|${depth}|${westX}|${northZ}`;
  const hit = mottleClones.get(key);
  if (hit) return hit;

  if (!mottleSource) {
    mottleSource = new THREE.CanvasTexture(drawMottle());
    mottleSource.wrapS = mottleSource.wrapT = THREE.RepeatWrapping;
    mottleSource.colorSpace = THREE.SRGBColorSpace;
    mottleSource.anisotropy = 8;
  }

  const texture = mottleSource.clone();
  texture.repeat.set(width / MOTTLE_WORLD, depth / MOTTLE_WORLD);
  texture.offset.set(westX / MOTTLE_WORLD, -(northZ + depth) / MOTTLE_WORLD);
  texture.needsUpdate = true;
  mottleClones.set(key, texture);
  return texture;
}

/** Where a car stands to be served, and which way it faces. */
export interface WearBay {
  x: number;
  z: number;
  along: 'x' | 'z';
}

/** A stretch of ground cars drive along, lengthwise on its longer side. */
export interface WearBand {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** A mouth runs in from the road; the lane runs between the two mouths. */
  kind: 'mouth' | 'lane';
}

/** One paved patch, as the concrete under it is laid out. */
export interface WearPatch {
  westX: number;
  northZ: number;
  width: number;
  depth: number;
}

/** A turning car's path: a quadratic curve through a corner. */
export interface WearCurve {
  from: [number, number];
  via: [number, number];
  to: [number, number];
}

/** Everything the wear is drawn from, worked out once for the whole forecourt. */
export interface WearMarks {
  bands: WearBand[];
  curves: WearCurve[];
  bays: WearBay[];
}

/**
 * Where cars turn: in off the road at a mouth and away down the lane, out of
 * the lane at the other, and in and out of every pump bay. Each corner gets a
 * few slightly different lines, because no two drivers take it the same way.
 */
export function wearMarks(bands: WearBand[], bays: WearBay[]): WearMarks {
  const curves: WearCurve[] = [];
  const lanes = bands.filter((b) => b.kind === 'lane');

  for (const lane of lanes) {
    const laneZ = (lane.minZ + lane.maxZ) / 2;
    // The near forecourt lies at +z and its road beyond its -z edge; the far one mirrors it.
    const roadEdge = (mouth: WearBand) => (laneZ > 0 ? mouth.minZ : mouth.maxZ);
    const mouths = bands.filter(
      (b) => b.kind === 'mouth' && b.maxZ > lane.minZ && b.minZ < lane.maxZ
    );

    for (const mouth of mouths) {
      const mouthX = (mouth.minX + mouth.maxX) / 2;
      // Cars turn towards the rest of the lane, not off its end.
      const inward = mouthX - lane.minX < lane.maxX - mouthX ? 1 : -1;
      const random = spotRandom(mouthX, laneZ, 3);
      for (let pass = 0; pass < 3; pass++) {
        const swing = 4.5 + random() * 2.5;
        curves.push({
          from: [mouthX + (random() - 0.5) * 0.8, roadEdge(mouth)],
          via: [mouthX + (random() - 0.5) * 0.6, laneZ + (random() - 0.5) * 0.6],
          to: [mouthX + inward * swing, laneZ + (random() - 0.5) * 0.5]
        });
      }
    }
  }

  for (const bay of bays) {
    const random = spotRandom(bay.x, bay.z, 4);
    // A car parked alongside the lane swings in from the lane's side; one
    // parked across it, from whichever side it came.
    const lane = lanes.reduce<WearBand | null>((best, candidate) => {
      const distance = (b: WearBand) => Math.abs((b.minZ + b.maxZ) / 2 - bay.z);
      return !best || distance(candidate) < distance(best) ? candidate : best;
    }, null);
    const side =
      bay.along === 'x' && lane ? Math.sign((lane.minZ + lane.maxZ) / 2 - bay.z) || 1 : random() < 0.5 ? -1 : 1;
    const flip = random() < 0.5 ? -1 : 1;
    // u runs the length of the car, v sideways towards where it swung in from.
    const at = (u: number, v: number): [number, number] =>
      bay.along === 'x' ? [bay.x + u * flip, bay.z + v * side] : [bay.x + v * side, bay.z + u * flip];

    for (let pass = 0; pass < 2; pass++) {
      const jitter = () => (random() - 0.5) * 0.7;
      curves.push({ from: at(-6 + jitter(), 2.8 + jitter()), via: at(-2.6 + jitter(), jitter() * 0.4), to: at(0.8, 0) });
      curves.push({ from: at(0.8, 0), via: at(3.8 + jitter(), jitter() * 0.4), to: at(6.8 + jitter(), 2.8 + jitter()) });
    }
  }

  return { bands, curves, bays };
}

/** One soft spot of rubber, the unit every tyre mark is built from. */
function stamp(
  ctx: CanvasRenderingContext2D,
  patch: WearPatch,
  x: number,
  z: number,
  r: number,
  alpha: number
): void {
  if (alpha < 0.003) return;
  const px = (x - patch.westX) * WEAR_PX;
  const py = (z - patch.northZ) * WEAR_PX;
  const pr = r * WEAR_PX;
  const gradient = ctx.createRadialGradient(px, py, 0, px, py, pr);
  gradient.addColorStop(0, `rgba(32, 31, 29, ${alpha})`);
  gradient.addColorStop(1, 'rgba(32, 31, 29, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
}

/** Full strength a little way in from either end of a mark, nothing at the end itself. */
function taper(distanceFromEnd: number, fadeLength: number): number {
  return Math.max(0, Math.min(1, distanceFromEnd / fadeLength)) ** 1.5;
}

/**
 * Tyre wear down a band: two wheel tracks and a faint darkening between them.
 * Both are stamped as soft spots, wandering a little and thinning out towards
 * either end. Stroked, they came out as crisp stripes with rounded ends —
 * lines ruled on the ground, which is what the slab joints were taken off the
 * concrete for.
 */
function drawBand(ctx: CanvasRenderingContext2D, band: WearBand, patch: WearPatch): void {
  const alongX = band.maxX - band.minX >= band.maxZ - band.minZ;
  const start = alongX ? band.minX : band.minZ;
  const length = alongX ? band.maxX - band.minX : band.maxZ - band.minZ;
  const centre = alongX ? (band.minZ + band.maxZ) / 2 : (band.minX + band.maxX) / 2;
  const random = spotRandom(band.minX + band.maxX, band.minZ + band.maxZ, 1);
  const fade = Math.min(3, length / 2);

  const spot = (t: number, offset: number, r: number, alpha: number) => {
    const [x, z] = alongX ? [start + t, offset] : [offset, start + t];
    stamp(ctx, patch, x, z, r, alpha * taper(Math.min(t, length - t), fade));
  };

  // The faint darkening across the whole run of traffic.
  for (let t = 0; t <= length; t += 0.6) {
    spot(t, centre + (random() - 0.5) * 0.4, 1.3 + random() * 0.4, 0.02);
  }

  // The wheel tracks, drifting slowly from side to side as real ones do.
  for (const side of [-TRACK_HALF, TRACK_HALF]) {
    let drift = 0;
    for (let t = 0; t <= length; t += 0.3) {
      drift = Math.max(-0.25, Math.min(0.25, drift + (random() - 0.5) * 0.08));
      spot(t, centre + side + drift, 0.3 + random() * 0.18, 0.06 + random() * 0.04);
    }
  }
}

/** A pair of wheel tracks round a turn, stamped along the curve and faded at both ends. */
function drawCurve(ctx: CanvasRenderingContext2D, curve: WearCurve, patch: WearPatch): void {
  const [x0, z0] = curve.from;
  const [x1, z1] = curve.via;
  const [x2, z2] = curve.to;
  const random = spotRandom(x0 + x2, z0 + z2, 5);

  const point = (t: number): [number, number] => {
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return [a * x0 + b * x1 + c * x2, a * z0 + b * z1 + c * z2];
  };

  let length = 0;
  let previous = point(0);
  for (let i = 1; i <= 16; i++) {
    const next = point(i / 16);
    length += Math.hypot(next[0] - previous[0], next[1] - previous[1]);
    previous = next;
  }

  const steps = Math.max(8, Math.ceil(length / 0.25));
  const fade = Math.min(2.5, length / 2);
  for (const side of [-TRACK_HALF, TRACK_HALF]) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const [px, pz] = point(t);
      const tx = 2 * (1 - t) * (x1 - x0) + 2 * t * (x2 - x1);
      const tz = 2 * (1 - t) * (z1 - z0) + 2 * t * (z2 - z1);
      const norm = Math.hypot(tx, tz) || 1;
      const along = t * length;
      stamp(
        ctx,
        patch,
        px - (tz / norm) * side,
        pz + (tx / norm) * side,
        0.28 + random() * 0.16,
        (0.06 + random() * 0.04) * taper(Math.min(along, length - along), fade)
      );
    }
  }
}

/**
 * Where a car stands at a pump: the ground scuffed dark about the size of a
 * car, an old wide stain, and a scatter of fresher drips on top.
 */
function drawBay(ctx: CanvasRenderingContext2D, bay: WearBay, patch: WearPatch): void {
  const random = spotRandom(bay.x, bay.z, 2);

  ctx.save();
  ctx.translate((bay.x - patch.westX) * WEAR_PX, (bay.z - patch.northZ) * WEAR_PX);
  // Local x runs the length of the car.
  if (bay.along === 'z') ctx.rotate(Math.PI / 2);

  const blotch = (x: number, y: number, r: number, tone: string, alpha: number, squash = 1) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, squash);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    gradient.addColorStop(0, `rgba(${tone}, ${alpha})`);
    gradient.addColorStop(0.55, `rgba(${tone}, ${alpha * 0.6})`);
    gradient.addColorStop(1, `rgba(${tone}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  blotch(0, 0, 2.3 * WEAR_PX, '34, 33, 31', 0.1, 0.5);
  blotch((random() - 0.5) * 0.8 * WEAR_PX, (random() - 0.5) * 0.4 * WEAR_PX, (0.9 + random() * 0.5) * WEAR_PX, '28, 24, 20', 0.13, 0.75);

  const drips = 4 + Math.floor(random() * 4);
  for (let i = 0; i < drips; i++) {
    blotch(
      (random() - 0.35) * 2.2 * WEAR_PX,
      (random() - 0.5) * 0.9 * WEAR_PX,
      (0.12 + random() * 0.38) * WEAR_PX,
      '26, 22, 18',
      0.28 + random() * 0.3,
      0.7 + random() * 0.3
    );
  }

  ctx.restore();
}

/**
 * The wear on one paved patch, or null where no car stands, drives or turns.
 * Marks are drawn in world units onto every patch they touch, so one that
 * crosses a parcel edge carries on over the other side.
 */
export function wearTexture(patch: WearPatch, marks: WearMarks): THREE.CanvasTexture | null {
  const reach = 3;
  const touches = (minX: number, maxX: number, minZ: number, maxZ: number) =>
    maxX > patch.westX - reach &&
    minX < patch.westX + patch.width + reach &&
    maxZ > patch.northZ - reach &&
    minZ < patch.northZ + patch.depth + reach;

  const bands = marks.bands.filter((b) => touches(b.minX, b.maxX, b.minZ, b.maxZ));
  const curves = marks.curves.filter((c) => {
    const xs = [c.from[0], c.via[0], c.to[0]];
    const zs = [c.from[1], c.via[1], c.to[1]];
    return touches(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs));
  });
  const bays = marks.bays.filter((b) => touches(b.x, b.x, b.z, b.z));
  if (bands.length === 0 && curves.length === 0 && bays.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(patch.width * WEAR_PX));
  canvas.height = Math.max(1, Math.ceil(patch.depth * WEAR_PX));
  const ctx = canvas.getContext('2d')!;

  for (const band of bands) drawBand(ctx, band, patch);
  for (const curve of curves) drawCurve(ctx, curve, patch);
  for (const bay of bays) drawBay(ctx, bay, patch);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
