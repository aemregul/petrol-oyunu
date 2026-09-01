/**
 * Driving a way round what the player has built.
 *
 * The forecourt has lanes, and for an empty plot they are the right answer: a
 * line in past the mouth, a line back out along the rear. But a lane is a
 * fixed line, and a fixed line through a plot the player is free to build on
 * is a line that eventually runs through a wall. Moving the lane only goes so
 * far — one shop in the wrong place and there is no single line left that
 * clears everything.
 *
 * So the lanes stay as the route a driver would take if the way were open, and
 * every leg of that route is then checked against what is actually standing
 * there. A leg that is clear is left exactly as it was, which is why the empty
 * forecourt still drives the way it always did. A leg that is blocked is
 * replaced with a way round, found on a grid laid over the plot.
 *
 * All coordinates here are grid units, the same as the rest of the simulation.
 *
 * Known limit: on a forecourt built out to its edges, a bay can end up walled
 * in behind another building. The car still has to reach it, so it clips the
 * corner on the way past. Nothing here can fix that — the spot it is being
 * sent to is inside the building — and the answer is either to keep a bay's
 * approach clear when the building goes up, or to take the bay out of service.
 */

import { GameState, VehicleEntity } from '../types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
import { unpavedHoles } from './land';

/**
 * Built but not solid: nothing here is a wall to steer round. A marked-out
 * park is paint on the ground, and a widened ramp is the driveway itself —
 * treating that one as an obstacle had cars refusing to use their own
 * entrance. Canopies are absent because they are no longer buildings; each
 * one belongs to the pump it roofs.
 */
const FLAT_TYPES = ['car_park', 'truck_park', 'wide_entry', 'wide_exit'];

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * How much room a car needs around its centre, in grid units.
 *
 * Measured to the corner of the body rather than to its side: a car is 1.8
 * long and 0.85 wide, so half its diagonal is almost exactly 1. Keeping only
 * half the width clear was enough while the car pointed along the wall and
 * useless the moment it turned — which is when a driver sweeps the far end of
 * the car through the corner of the building it is passing.
 */
const CLEARANCE = 1.1;

/**
 * What a car needs to run straight past something, in grid units: half its
 * width and a little. Driving along a wall takes far less room than turning
 * beside one, and holding corridors to the turning figure closes gaps a car
 * would sail through — which is a forecourt nobody can get into.
 */
const PASSING_CLEARANCE = 0.7;

/** How finely the plot is divided when a way round has to be found. */
const CELL = 0.5;

/** Steps taken along a leg when testing whether it is clear. */
const SAMPLE = 0.25;

/** Cells searched before giving up: a plot is small, a runaway search is a bug. */
const MAX_VISITED = 25000;

/**
 * The walls on this block: what a car can neither drive through nor stand in,
 * as rectangles already grown by the room a car needs.
 */
export function wallRects(
  state: GameState,
  side: 'near' | 'far',
  clearance = CLEARANCE,
  ignoreBuildingId?: string
): Rect[] {
  const out: Rect[] = [];

  for (const building of Object.values(state.buildings)) {
    // A charging post is a thing a car parks against, so the one it is
    // heading for cannot be an obstacle to it — the same courtesy the bay's
    // own pump island gets.
    if (building.id === ignoreBuildingId) continue;
    // A canopy is a roof and a marked-out park is paint on the ground: cars
    // drive under and over these, not round them.
    if (FLAT_TYPES.includes(building.type)) continue;
    if (!onSide(side, building.position[1])) continue;

    const turned = building.rotation === 90 || building.rotation === 270;
    const w = (turned ? building.size[1] : building.size[0]) / 2;
    const d = (turned ? building.size[0] : building.size[1]) / 2;
    out.push(grow(building.position, w, d, clearance));
  }

  // Bare ground inside the plot's bounding box is as solid as a wall to a car:
  // there is no concrete under it. Grown like everything else, so a car keeps
  // its body off the grass rather than putting two wheels on it.
  for (const hole of unpavedHoles(state.station.plots, side)) {
    out.push(
      grow(
        [(hole.minX + hole.maxX) / 2, (hole.minZ + hole.maxZ) / 2],
        (hole.maxX - hole.minX) / 2,
        (hole.maxZ - hole.minZ) / 2,
        clearance
      )
    );
  }

  return out;
}

function onSide(side: 'near' | 'far', z: number): boolean {
  return side === 'far' ? z < 0 : z >= 0;
}

/**
 * Everything a moving car has to steer around: the walls, and the pump islands
 * it is not itself heading for.
 */
export function obstacles(
  state: GameState,
  side: 'near' | 'far',
  ignorePumpId?: string
): Rect[] {
  return [...wallRects(state, side), ...pumpRects(state, side, ignorePumpId)];
}

/** The islands, as rectangles already grown by the room a car needs. */
export function pumpRects(
  state: GameState,
  side: 'near' | 'far',
  ignorePumpId?: string,
  clearance = CLEARANCE
): Rect[] {
  const out: Rect[] = [];

  for (const pump of Object.values(state.pumps)) {
    // The bay a car is heading for sits alongside its own island, so that one
    // island cannot be an obstacle to it or it could never arrive.
    if (pump.id === ignorePumpId) continue;
    if (!onSide(side, pump.position[1])) continue;

    const size = GAME_CONFIG.buildings.pump_standard.size;
    const turned = pump.rotation === 90 || pump.rotation === 270;
    out.push(
      grow(
        pump.position,
        (turned ? size[1] : size[0]) / 2,
        (turned ? size[0] : size[1]) / 2,
        clearance
      )
    );
  }

  return out;
}

/**
 * Where a leg meets the apron, as the two points the search should work
 * between: the same points when both ends are already on it, and otherwise
 * where the line itself crosses the boundary.
 *
 * Pulling each end onto the apron axis by axis instead would put a car coming
 * up the road at the corner of the plot rather than at the mouth its route
 * runs through — and the corner is fenced, so nothing could be found from it.
 */
function clipToApron(
  from: [number, number],
  to: [number, number],
  bounds: Rect
): [[number, number], [number, number]] {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];

  let enter = 0;
  let leave = 1;

  const slab = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > leave) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < leave) leave = t;
    }
    return true;
  };

  const fits =
    slab(-dx, from[0] - bounds.minX) &&
    slab(dx, bounds.maxX - from[0]) &&
    slab(-dz, from[1] - bounds.minZ) &&
    slab(dz, bounds.maxZ - from[1]);

  // A leg that never touches the apron is one for the road, not for the
  // forecourt; it is left alone.
  if (!fits) return [from, to];

  return [
    [from[0] + dx * enter, from[1] + dz * enter],
    [from[0] + dx * leave, from[1] + dz * leave]
  ];
}

function grow(centre: [number, number], halfW: number, halfD: number, clearance: number): Rect {
  return {
    minX: centre[0] - halfW - clearance,
    minZ: centre[1] - halfD - clearance,
    maxX: centre[0] + halfW + clearance,
    maxZ: centre[1] + halfD + clearance
  };
}

/** Whether a point falls inside any of these, clearance included. */
export function inRects(rects: Rect[], x: number, z: number): boolean {
  return rects.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
}

/** Whether a car can drive straight from one point to the other. */
export function legIsClear(
  rects: Rect[],
  from: [number, number],
  to: [number, number]
): boolean {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(length / SAMPLE));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (inRects(rects, from[0] + dx * t, from[1] + dz * t)) return false;
  }
  return true;
}

/**
 * The frontier, cheapest first. A plain array scanned for the smallest is fine
 * on a handful of cells and quadratic on a large plot, which is exactly where
 * the search is needed most.
 */
class Heap {
  private cs: number[] = [];
  private rs: number[] = [];
  private fs: number[] = [];

  get size(): number {
    return this.fs.length;
  }

  push(c: number, r: number, f: number): void {
    this.cs.push(c);
    this.rs.push(r);
    this.fs.push(f);

    let i = this.fs.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.fs[parent] <= this.fs[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { c: number; r: number } | null {
    if (this.fs.length === 0) return null;
    const top = { c: this.cs[0], r: this.rs[0] };

    const last = this.fs.length - 1;
    this.swap(0, last);
    this.cs.pop();
    this.rs.pop();
    this.fs.pop();

    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let best = i;
      if (left < this.fs.length && this.fs[left] < this.fs[best]) best = left;
      if (right < this.fs.length && this.fs[right] < this.fs[best]) best = right;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }

    return top;
  }

  private swap(a: number, b: number): void {
    [this.cs[a], this.cs[b]] = [this.cs[b], this.cs[a]];
    [this.rs[a], this.rs[b]] = [this.rs[b], this.rs[a]];
    [this.fs[a], this.fs[b]] = [this.fs[b], this.fs[a]];
  }
}

/**
 * A way round, as a list of points from `from` to `to`, or null when there is
 * none. The grid is laid over the two points with room to swing wide, so a car
 * can go around the outside of whatever is between them.
 */
export function detour(
  rects: Rect[],
  from: [number, number],
  to: [number, number],
  bounds: Rect
): Array<[number, number]> | null {
  // The apron and nothing else. A grid that reached past the kerb let cars
  // find their way in around the side of the plot and out over the verge,
  // which is not a way round — it is a car ignoring the driveway.
  const minX = bounds.minX;
  const maxX = bounds.maxX;
  const minZ = bounds.minZ;
  const maxZ = bounds.maxZ;

  const cols = Math.max(1, Math.round((maxX - minX) / CELL));
  const rows = Math.max(1, Math.round((maxZ - minZ) / CELL));
  const at = (c: number, r: number): [number, number] => [minX + c * CELL, minZ + r * CELL];
  const key = (c: number, r: number) => r * (cols + 1) + c;

  const start: [number, number] = [
    Math.round((from[0] - minX) / CELL),
    Math.round((from[1] - minZ) / CELL)
  ];
  const goal: [number, number] = [
    Math.round((to[0] - minX) / CELL),
    Math.round((to[1] - minZ) / CELL)
  ];

  // A car standing in a bay is inside its own island's clearance, and the spot
  // it is heading for may be too. Neither end can be judged by the rule that
  // applies to the ground in between, or it could never set off or arrive.
  const blocked = (c: number, r: number): boolean => {
    if ((c === start[0] && r === start[1]) || (c === goal[0] && r === goal[1])) return false;
    const [x, z] = at(c, r);
    return inRects(rects, x, z);
  };

  const open = new Heap();
  open.push(start[0], start[1], 0);
  const cost = new Map<number, number>([[key(start[0], start[1]), 0]]);
  const cameFrom = new Map<number, number>();
  const heuristic = (c: number, r: number) => Math.hypot(c - goal[0], r - goal[1]);

  let visited = 0;
  while (open.size > 0 && visited++ < MAX_VISITED) {
    const current = open.pop()!;

    if (current.c === goal[0] && current.r === goal[1]) {
      return unwind(cameFrom, key, at, cols, start, goal);
    }

    const here = cost.get(key(current.c, current.r)) ?? Infinity;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const c = current.c + dc;
        const r = current.r + dr;
        if (c < 0 || r < 0 || c > cols || r > rows) continue;
        if (blocked(c, r)) continue;
        // No cutting a corner between two blocked cells.
        if (dc !== 0 && dr !== 0 && (blocked(current.c + dc, current.r) || blocked(current.c, current.r + dr))) {
          continue;
        }

        const step = here + Math.hypot(dc, dr);
        const id = key(c, r);
        if (step >= (cost.get(id) ?? Infinity)) continue;

        cost.set(id, step);
        cameFrom.set(id, key(current.c, current.r));
        open.push(c, r, step + heuristic(c, r));
      }
    }
  }

  return null;
}

function unwind(
  cameFrom: Map<number, number>,
  key: (c: number, r: number) => number,
  at: (c: number, r: number) => [number, number],
  cols: number,
  start: [number, number],
  goal: [number, number]
): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  let id: number | undefined = key(goal[0], goal[1]);
  const startId = key(start[0], start[1]);

  while (id !== undefined && id !== startId) {
    path.push(at(id % (cols + 1), Math.floor(id / (cols + 1))));
    id = cameFrom.get(id);
  }

  return path.reverse();
}

/**
 * Drops the points a car does not need: if it can see past one, it drives past
 * one. What comes back is the shape of the way round rather than a trail of
 * grid cells, which is what keeps the driving looking deliberate.
 */
export function straighten(
  rects: Rect[],
  from: [number, number],
  path: Array<[number, number]>
): Array<[number, number]> {
  const kept: Array<[number, number]> = [];
  let anchor = from;
  let i = 0;

  while (i < path.length) {
    let furthest = i;
    for (let j = path.length - 1; j > i; j--) {
      if (legIsClear(rects, anchor, path[j])) {
        furthest = j;
        break;
      }
    }
    kept.push(path[furthest]);
    anchor = path[furthest];
    i = furthest + 1;
  }

  return kept;
}

/**
 * The route a driver would take with the way open, redrawn around whatever is
 * actually in it. Legs that are clear come back untouched.
 */
/** The route with the ways round drawn in, or null when some leg has no way. */
export function routeAroundOrNull(
  state: GameState,
  vehicle: VehicleEntity,
  side: 'near' | 'far',
  waypoints: Array<[number, number, number]>,
  bounds: Rect,
  keepOut: Rect[],
  ignorePumpId?: string,
  ignoreBuildingId?: string,
  extraRects?: Rect[]
): Array<[number, number, number]> | null {
  return plot(
    state,
    vehicle,
    side,
    waypoints,
    bounds,
    keepOut,
    ignorePumpId,
    ignoreBuildingId,
    extraRects
  );
}

export function routeAround(
  state: GameState,
  vehicle: VehicleEntity,
  side: 'near' | 'far',
  waypoints: Array<[number, number, number]>,
  bounds: Rect,
  keepOut: Rect[],
  ignorePumpId?: string,
  ignoreBuildingId?: string
): Array<[number, number, number]> {
  return (
    plot(state, vehicle, side, waypoints, bounds, keepOut, ignorePumpId, ignoreBuildingId) ??
    waypoints
  );
}

/**
 * Whether a driver could actually get there. A forecourt walled off by what
 * the player has built has no way in, and a driver can see that from the road.
 */
export function canReach(
  state: GameState,
  vehicle: VehicleEntity,
  side: 'near' | 'far',
  waypoints: Array<[number, number, number]>,
  bounds: Rect,
  keepOut: Rect[],
  ignorePumpId?: string,
  ignoreBuildingId?: string
): boolean {
  return (
    plot(state, vehicle, side, waypoints, bounds, keepOut, ignorePumpId, ignoreBuildingId) !== null
  );
}

/** The route, or null when some leg of it has no way through. */
function plot(
  state: GameState,
  vehicle: VehicleEntity,
  side: 'near' | 'far',
  waypoints: Array<[number, number, number]>,
  bounds: Rect,
  keepOut: Rect[],
  ignorePumpId?: string,
  ignoreBuildingId?: string,
  // Obstacles beyond the buildings — parked cars, other lorries — already
  // grown to the margin the caller wants kept. Never excused for start or
  // goal: a route is asked for exactly because these are in the way.
  extraRects?: Rect[]
): Array<[number, number, number]> | null {
  const start: [number, number] = [vehicle.worldPosition[0], vehicle.worldPosition[2]];

  const last = waypoints[waypoints.length - 1];
  const goal: [number, number] = last ? [last[0], last[2]] : start;

  // Two things have to stay possible: driving out of a spot the player has
  // since built over, and pulling up to a bay — which by its nature stands
  // right beside the island it serves, inside that island's margin.
  //
  // Islands and walls are excused differently, and the difference is the whole
  // point. A destination in an island's margin is a bay and has to be reached.
  // A destination in a wall's margin is merely close to the wall: excusing the
  // wall for it would let the car drive at it in a straight line and put its
  // bonnet through the bricks. So the wall stays, and the search brings the
  // car in from a side that clears it.
  const inCore = (r: Rect, p: [number, number]) =>
    p[0] > r.minX + CLEARANCE &&
    p[0] < r.maxX - CLEARANCE &&
    p[1] > r.minZ + CLEARANCE &&
    p[1] < r.maxZ - CLEARANCE;

  // Two sets, because the two questions are different. Whether a car can run
  // straight past something asks only for its width; where it may turn asks
  // for its length as well, since that is when the far end of the car swings
  // through the corner. Turns land on search nodes, so the wider figure is the
  // one the search is held to.
  const keep = (walls: Rect[], pumps: Rect[]): Rect[] => [
    // The frontage is never excused. A car standing on it has to be steered
    // onto the apron, not given the run of the strip: excusing it is how a
    // car ends up driving the length of the flower beds to reach the far
    // driveway instead of turning in.
    ...keepOut,
    ...walls.filter((r) => !inCore(r, start)),
    ...pumps.filter(
      (r) => !inRects([r], start[0], start[1]) && !inRects([r], goal[0], goal[1])
    )
  ];

  const rects = [
    ...keep(
      wallRects(state, side, PASSING_CLEARANCE, ignoreBuildingId),
      pumpRects(state, side, ignorePumpId, PASSING_CLEARANCE)
    ),
    ...(extraRects ?? [])
  ];

  // Turns land on search nodes, and a turn is where the far end of the car
  // swings out. The search is held to the wider figure; the straight runs
  // between its nodes only need the narrower one.
  const turning = [
    ...keep(
      wallRects(state, side, CLEARANCE, ignoreBuildingId),
      pumpRects(state, side, ignorePumpId)
    ),
    ...(extraRects ?? [])
  ];

  if (rects.length === 0 || waypoints.length === 0) return waypoints;

  const out: Array<[number, number, number]> = [];
  let from = start;

  for (const point of waypoints) {
    const to: [number, number] = [point[0], point[2]];

    if (!legIsClear(rects, from, to)) {
      // A leg that starts or ends off the apron — coming in off the road, or
      // heading out down the driveway — is only routed for the part of it that
      // is on the plot. The rest runs through the mouth, which is the one way
      // in and out and not something to find an alternative to.
      const [a, b] = clipToApron(from, to, bounds);
      const path = detour(turning, a, b, bounds);
      if (!path) return null;

      for (const [x, z] of straighten(rects, from, path)) {
        // The last step of a way round lands on the target's own cell; the
        // exact target follows it, and two waypoints a hair apart make a car
        // stop twice on the same spot.
        if (Math.hypot(x - to[0], z - to[1]) < 0.6) continue;
        out.push([x, 0, z]);
      }
    }

    out.push(point);
    from = to;
  }

  return out;
}
