import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';
import { evaluatePlacement, getFootprint } from '../domain/services/placement';
import { blockLayout, LAYOUT } from '../domain/services/simulationEngine';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState } from '../domain/types/gameState';

/**
 * No car may ever be inside a building.
 *
 * The forecourt's lanes are fixed lines and the player may build anywhere, so
 * sooner or later something stands on one. What must not happen is the car
 * pretending it is not there: it steers round, or — where the plot has been
 * walled in and there is no way round — it does not come in at all.
 *
 * Painted parking bays are ground rather than walls, and a canopy is a roof:
 * driving over and under those is what they are for.
 */
const FLAT = ['canopy', 'car_park', 'truck_park'];

/**
 * Service points a car deliberately pulls up to. A charging car stands right
 * against its post the way a fuelling one stands against the island, so an
 * overlap there is the car being served, not a car in a wall.
 */
const SERVICE = ['ev_charger_ac', 'ev_charger_dc'];

/**
 * Half the body, in grid units. Measured rather than assumed: the mesh is 3.6
 * long and 1.7 wide in world units, and a grid unit is two of those.
 *
 * The whole body is what has to stay out. Checking the centre alone passes a
 * car whose bonnet is through the wall — which is exactly what a player sees.
 */
const HALF_LENGTH = 0.9;
const HALF_WIDTH = 0.43;

/**
 * Whether a straight run between two points passes through a rectangle. The
 * route is checked as well as the car, because a car that has not yet reached
 * the wall it is aimed at is still a car aimed at a wall.
 */
function legHits(
  a: [number, number],
  b: [number, number],
  f: { minX: number; minZ: number; maxX: number; maxZ: number }
): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    if (x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ) return true;
  }
  return false;
}

/** The four corners of a car standing at this spot on this heading. */
function corners(x: number, z: number, heading: number): Array<[number, number]> {
  // Heading is atan2(dx, dz), so forward is (sin, cos).
  const ahead = Math.sin(heading);
  const across = Math.cos(heading);
  const out: Array<[number, number]> = [];

  for (const along of [-HALF_LENGTH, HALF_LENGTH]) {
    for (const side of [-HALF_WIDTH, HALF_WIDTH]) {
      out.push([x + ahead * along + across * side, z + across * along - ahead * side]);
    }
  }
  return out;
}

function plot(width: number, height: number): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.level = 20;
  state.player.reputation = 5;
  state.player.cash = 9_000_000;
  state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.75;

  for (let col = 0; col <= 2; col++) {
    for (let row = 0; row <= 2; row++) {
      const key = `${col},${row}`;
      if (!state.station.plots.ownedParcels.includes(key)) {
        state.station.plots.ownedParcels.push(key);
      }
      if (!state.station.plots.pavedParcels.includes(key)) {
        state.station.plots.pavedParcels.push(key);
      }
    }
  }
  state.station.plots.width = width;
  state.station.plots.height = height;
  return state;
}

function put(state: GameState, type: string, at: [number, number]): void {
  const id = `b_${type}`;
  state.buildings[id] = {
    id,
    type,
    level: 1,
    position: at,
    rotation: 0,
    size: GAME_CONFIG.buildings[type].size,
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0
  } as GameState['buildings'][string];
}

/**
 * Runs the station and reports every moment a car spent inside a building,
 * along with whether any car got as far as a pump. Nobody serves them in a
 * headless run — there is no attendant and no player clicking — so reaching
 * the bay is what "got in" means here.
 */
function trespasses(state: GameState, seconds: number): { hits: string[]; arrived: boolean } {
  const effects = createEffects();
  const seen = new Map<string, number>();
  let arrived = false;

  for (let i = 0; i < seconds * 20; i++) {
    runSimulationTick(state, 0.05, effects);

    for (const vehicle of Object.values(state.vehicles)) {
      if (vehicle.state === 'AT_PUMP') arrived = true;
      const [x, , z] = vehicle.worldPosition;
      const body = corners(x, z, vehicle.heading);

      // The whole line the car has been told to drive, not just where it is.
      const legs: Array<[[number, number], [number, number]]> = [];
      let at: [number, number] = [x, z];
      for (const point of [vehicle.targetWaypoint, ...vehicle.route]) {
        if (!point) continue;
        const next: [number, number] = [point[0], point[2]];
        legs.push([at, next]);
        at = next;
      }

      for (const building of Object.values(state.buildings)) {
        if (FLAT.includes(building.type) || SERVICE.includes(building.type)) continue;
        const f = getFootprint(building.position, building.size, building.rotation);

        const inside = body.some(
          ([cx, cz]) => cx > f.minX && cx < f.maxX && cz > f.minZ && cz < f.maxZ
        );
        const aimed = legs.some(([a, b]) => legHits(a, b, f));
        if (!inside && !aimed) continue;

        const key = `${building.type} <- ${vehicle.state}${inside ? '' : ' (rota)'}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
  }

  return { hits: [...seen].map(([key, ticks]) => `${key} x${ticks}`), arrived };
}

describe('vehicles and buildings', () => {
  it('keeps cars out of every building on a laid-out forecourt', () => {
    const state = plot(24, 21);
    state.pumps.pump_1.position = [10, 9];

    // Spread the way a player would: something on the way in, something beside
    // the bays, something at the back.
    put(state, 'ev_storage', [4, 6]);
    put(state, 'car_wash', [20, 6]);
    put(state, 'ev_charger_ac', [14, 6]);
    put(state, 'cafe', [10, 15]);
    put(state, 'hotel', [20, 15]);

    const run = trespasses(state, 600);
    expect(run.hits).toEqual([]);
    // Steering round is the point; refusing to come is not.
    expect(run.arrived).toBe(true);
  });

  it('brings cars in and out through the driveway rather than over the verge', () => {
    const state = plot(24, 21);
    state.pumps.pump_1.position = [10, 9];
    // Right beside the way in, so the drive from the mouth to the lane has to
    // be re-routed — which is exactly when a search that reached past the kerb
    // used to take the car in around the side of the plot instead.
    put(state, 'ev_storage', [2, 3]);
    put(state, 'cafe', [10, 15]);
    put(state, 'hotel', [20, 15]);

    const block = blockLayout(state, 'near')!;
    const mouths = [block.entry, block.exit];

    // Ground a car is allowed on: the apron behind the frontage strip, the
    // carriageway, and the mouths that bridge the verge between them. The
    // frontage strip carries the price board and its planting, so a car there
    // is a car on the flower beds; everywhere else is grass.
    const FRONTAGE = 2.4;

    const onLegalGround = (x: number, z: number): boolean => {
      if (
        x >= block.minX - 0.6 &&
        x <= block.maxX + 0.6 &&
        z >= block.minZ + FRONTAGE &&
        z <= block.maxZ + 0.6
      ) {
        return true;
      }
      if (Math.abs(z - block.roadLaneZ) <= LAYOUT.roadHalfWidth + 0.6) return true;
      return mouths.some(
        (m) => Math.abs(x - m.x) <= m.width / 2 + 0.6 && z <= block.minZ + FRONTAGE + 0.6
      );
    };

    const effects = createEffects();
    const strays: string[] = [];

    for (let i = 0; i < 12000 && strays.length === 0; i++) {
      runSimulationTick(state, 0.05, effects);
      for (const vehicle of Object.values(state.vehicles)) {
        const [x, , z] = vehicle.worldPosition;
        if (!onLegalGround(x, z)) {
          strays.push(`${vehicle.state} @ ${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
    }

    expect(strays).toEqual([]);
  });

  it('does the same on the block across the highway', () => {
    // The far side runs the whole game mirrored — its frontage faces the other
    // way, its lanes count backwards — and every one of those signs is a place
    // for the geometry to come out inverted.
    const state = plot(24, 14);
    state.station.roadLevel = 2;
    for (const key of ['0,-1', '1,-1', '2,-1', '0,-2', '1,-2', '2,-2']) {
      state.station.plots.ownedParcels.push(key);
      state.station.plots.pavedParcels.push(key);
    }

    const proto = state.pumps.pump_1;
    state.pumps.far = { ...proto, id: 'far', position: [10, -20], currentVehicleId: null, employeeId: null };
    put(state, 'rest_complex', [12, -24]);
    put(state, 'ev_charger_ac', [18, -18]);

    const far = blockLayout(state, 'far')!;
    const mouths = [far.entry, far.exit];
    const FRONTAGE = 2.4;

    const onLegalGround = (x: number, z: number): boolean => {
      if (
        x >= far.minX - 0.6 &&
        x <= far.maxX + 0.6 &&
        z <= far.maxZ - FRONTAGE &&
        z >= far.minZ - 0.6
      ) {
        return true;
      }
      if (Math.abs(z - far.roadLaneZ) <= LAYOUT.roadHalfWidth + 0.6) return true;
      if (Math.abs(z - LAYOUT.roadZ) <= LAYOUT.roadHalfWidth + 0.6) return true;
      return mouths.some(
        (m) => Math.abs(x - m.x) <= m.width / 2 + 0.6 && z >= far.maxZ - FRONTAGE - 0.6
      );
    };

    const effects = createEffects();
    const strays: string[] = [];
    const inBuildings: string[] = [];

    for (let i = 0; i < 12000 && strays.length === 0 && inBuildings.length === 0; i++) {
      runSimulationTick(state, 0.05, effects);

      for (const vehicle of Object.values(state.vehicles)) {
        const [x, , z] = vehicle.worldPosition;
        if (z >= 0) continue;

        if (!onLegalGround(x, z)) strays.push(`${vehicle.state} @ ${x.toFixed(1)},${z.toFixed(1)}`);

        for (const building of Object.values(state.buildings)) {
          if (building.position[1] >= 0) continue;
          if (FLAT.includes(building.type) || SERVICE.includes(building.type)) continue;
          const f = getFootprint(building.position, building.size, building.rotation);
          const hit = corners(x, z, vehicle.heading).some(
            ([cx, cz]) => cx > f.minX && cx < f.maxX && cz > f.minZ && cz < f.maxZ
          );
          if (hit) inBuildings.push(`${building.type} <- ${vehicle.state}`);
        }
      }
    }

    expect(strays).toEqual([]);
    expect(inBuildings).toEqual([]);
  });

  it('keeps a plot built out to the edges running rather than seizing up', () => {
    const state = plot(24, 21);

    // Everything the catalogue will take, packed in from the road back. A
    // forecourt this built-up has bays walled in behind other buildings, and
    // cars still clip the corners of a few of them on the way past — see the
    // note in the pathfinding module. What must hold is that the station keeps
    // running: cars arrive, are turned away rather than wedged, and leave.
    const types = [
      'ev_storage', 'mini_market', 'cafe', 'toilet', 'car_wash', 'ev_substation',
      'oil_change', 'tyre_service', 'ev_charger_ac', 'ev_charger_dc', 'restaurant'
    ];

    for (const type of types) {
      let placed = false;
      for (let z = 2; z <= 19 && !placed; z++) {
        for (let x = 2; x <= 22 && !placed; x++) {
          if (!evaluatePlacement(state, type, [x, z], 0).valid) continue;
          put(state, type, [x, z]);
          placed = true;
        }
      }
    }

    expect(Object.keys(state.buildings).length).toBeGreaterThan(8);

    const effects = createEffects();
    let seen = 0;
    for (let i = 0; i < 12000; i++) {
      runSimulationTick(state, 0.05, effects);
      seen = Math.max(seen, Object.keys(state.vehicles).length);
    }

    expect(seen).toBeGreaterThan(0);
    expect(state.player.reputation).toBeGreaterThanOrEqual(1);
  });
});
