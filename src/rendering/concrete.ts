import * as THREE from 'three';

/**
 * The forecourt surface, drawn rather than loaded.
 *
 * A flat fill reads as painted tarmac at any distance: nothing in it changes
 * as the camera moves, so the eye has nothing to measure the ground by. Real
 * poured concrete has three things going on — aggregate speckle, patchy
 * staining where it has weathered, and the sawn joints between slabs — and all
 * three are cheap to draw into a canvas at start-up. Generating it keeps the
 * repo free of a binary asset and lets the slab size follow the world grid.
 */

/**
 * How much ground one tile of the texture covers, and how big a slab is inside
 * it. The tile is far bigger than a slab because the two want opposite things:
 * seen from overhead it is the staining that gives a repeat away, so that wants
 * the longest period it can afford, while the joints want to be small enough to
 * land on every line that matters.
 */
const TILE_WORLD = 8;

/**
 * One slab is one build square.
 *
 * Wider slabs cannot come out whole. The concrete starts one square back from
 * the plot boundary and a parcel is seven squares deep, so with any spacing
 * over one square some parcel edge always falls mid-slab — and covering that
 * up by pouring a little past the boundary is what put concrete under ground
 * the build rules refuse. At one square nothing has to be faked: every parcel
 * edge, every frontage line and every snap line is already a joint.
 */
const JOINT_SPACING = 2;

/** Joints per tile edge, as fractions of the tile. */
const JOINTS_PER_TILE = TILE_WORLD / JOINT_SPACING;

/** Texture resolution for that tile — 128px per world unit, ample at zoom 7. */
const TILE_PX = 1024;

let cached: THREE.CanvasTexture | null = null;

/** Deterministic noise, so the forecourt looks the same every session. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function draw(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d')!;
  const random = makeRandom(0x5eed);

  // Base pour: a neutral mid grey. Warmer or lighter than this and the scene's
  // midday light turns it into limestone paving. Left bright enough that the
  // material tint can take it down for rain rather than having to lift it up.
  ctx.fillStyle = '#9b9c98';
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);

  /**
   * Weathering. Each blotch is drawn nine times, once per neighbouring tile
   * position, so anything crossing an edge comes back in on the other side and
   * the tiling seam never shows.
   */
  for (let i = 0; i < 44; i++) {
    const cx = random() * TILE_PX;
    const cy = random() * TILE_PX;
    const r = TILE_PX * (0.04 + random() * 0.11);
    // Mostly darker patches, with the occasional lighter wash.
    const dark = random() < 0.72;
    const alpha = 0.06 + random() * 0.08;

    for (const ox of [-TILE_PX, 0, TILE_PX]) {
      for (const oy of [-TILE_PX, 0, TILE_PX]) {
        const gradient = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
        const tone = dark ? '92, 94, 92' : '198, 199, 195';
        gradient.addColorStop(0, `rgba(${tone}, ${alpha})`);
        gradient.addColorStop(1, `rgba(${tone}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
      }
    }
  }

  // Sawn joints between slabs, evenly across the tile so that repeating it
  // lays a continuous grid one build square on a side. A hairline highlight on
  // the far side of each groove is what makes it read as cut into the surface
  // rather than painted onto it.
  const joint = Math.max(2, Math.round(TILE_PX * 0.0022));
  const step = TILE_PX / JOINTS_PER_TILE;
  for (let i = 0; i < JOINTS_PER_TILE; i++) {
    const at = Math.round(i * step);
    ctx.fillStyle = 'rgba(74, 76, 75, 0.55)';
    ctx.fillRect(0, at, TILE_PX, joint);
    ctx.fillRect(at, 0, joint, TILE_PX);
    ctx.fillStyle = 'rgba(206, 208, 203, 0.26)';
    ctx.fillRect(0, at + joint, TILE_PX, 1);
    ctx.fillRect(at + joint, 0, 1, TILE_PX);
  }

  // Aggregate. Per-pixel and last, so it grains the joints and the staining
  // alike instead of sitting under them.
  const image = ctx.getImageData(0, 0, TILE_PX, TILE_PX);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (random() - 0.5) * 34;
    data[i] = Math.max(0, Math.min(255, data[i] + grain));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + grain));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + grain));
  }
  ctx.putImageData(image, 0, 0);

  return canvas;
}

/**
 * The shared source texture. Callers get their own clone with their own
 * repeat and offset; clones share this one's GPU upload.
 */
function source(): THREE.CanvasTexture {
  if (cached) return cached;

  cached = new THREE.CanvasTexture(draw());
  cached.wrapS = THREE.RepeatWrapping;
  cached.wrapT = THREE.RepeatWrapping;
  cached.colorSpace = THREE.SRGBColorSpace;
  // The forecourt is looked at from a low angle at the widest zoom, which is
  // exactly where an unfiltered repeat turns to shimmer.
  cached.anisotropy = 8;
  return cached;
}

const clones = new Map<string, THREE.Texture>();

/**
 * A concrete texture for one patch of ground.
 *
 * The offset is world-space rather than per-patch, so the slab grid runs
 * unbroken across parcel boundaries: buy the plot next door and the joints
 * line up with the ones already poured, instead of restarting at the seam.
 *
 * The two axes are not symmetrical. Laying a plane flat turns its local +y
 * into world -z, so v counts from the patch's *southern* edge northwards —
 * which means offsetting by the northern edge, as x does, phases every patch
 * differently and lays the joints down at uneven spacings. Negating and
 * measuring from the south edge is what puts them back on a world grid.
 *
 * `anchorZ` sets that grid's phase along z: a joint falls exactly on the
 * anchor. Each block anchors on its own front edge, so the row of slabs a
 * driver crosses first is whole — and since a slab is one build square, every
 * parcel edge behind it lands on a joint too, with nothing left over.
 */
export function concreteTexture(
  width: number,
  depth: number,
  westX: number,
  northZ: number,
  anchorZ = 0
): THREE.Texture {
  const key = `${width}|${depth}|${westX}|${northZ}|${anchorZ}`;
  const hit = clones.get(key);
  if (hit) return hit;

  const texture = source().clone();
  texture.repeat.set(width / TILE_WORLD, depth / TILE_WORLD);
  texture.offset.set(westX / TILE_WORLD, -(northZ + depth - anchorZ) / TILE_WORLD);
  texture.needsUpdate = true;

  clones.set(key, texture);
  return texture;
}
