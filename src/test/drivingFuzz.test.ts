import { describe, it, expect, vi } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';
import { evaluatePlacement, getFootprint, snapPlacement } from '../domain/services/placement';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState } from '../domain/types/gameState';

/**
 * Forecourts the author did not think of.
 *
 * Hand-written layouts kept passing while players kept seeing cars inside
 * buildings, because the layouts that broke were not the ones anyone thought
 * to write down. This builds them at random instead — a plot of some size, a
 * pump or two somewhere on it, a handful of buildings wherever the rules will
 * take them — and holds every one to the same rule: no car inside a building,
 * and no car aimed at one.
 */
const FLAT = ['canopy', 'car_park', 'truck_park', 'wide_entry', 'wide_exit'];
/** Posts a car parks against, the way it parks against a pump island. */
const SERVICE = ['ev_charger_ac', 'ev_charger_dc'];

const HALF_LENGTH = 0.9;
const HALF_WIDTH = 0.43;

const TYPES = [
  'hotel', 'mini_market', 'cafe', 'restaurant', 'toilet', 'car_wash', 'oil_change',
  'tyre_service', 'ev_storage', 'ev_substation', 'ev_charger_ac', 'rest_complex', 'decoration'
];

function corners(x: number, z: number, heading: number): Array<[number, number]> {
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

function legHits(
  a: [number, number],
  b: [number, number],
  f: { minX: number; minZ: number; maxX: number; maxZ: number }
): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    if (x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ) return true;
  }
  return false;
}

/** One random forecourt, and what went wrong on it. */
function round(rnd: () => number, seconds: number): string[] {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.level = 20;
  state.player.reputation = 5;
  state.player.cash = 9_000_000;
  state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.75;

  const cols = 2 + Math.floor(rnd() * 2);
  const rows = 2 + Math.floor(rnd() * 2);
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r <= rows; r++) {
      const key = `${c},${r}`;
      if (!state.station.plots.ownedParcels.includes(key)) state.station.plots.ownedParcels.push(key);
      if (!state.station.plots.pavedParcels.includes(key)) state.station.plots.pavedParcels.push(key);
    }
  }
  state.station.plots.width = (cols + 1) * 8;
  state.station.plots.height = (rows + 1) * 7;

  const proto = Object.values(state.pumps)[0];
  state.pumps = {};
  const bays = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < bays; i++) {
    // Through the same snap AND the same placement rules the build flow
    // applies, so every layout dealt here is one the game can actually
    // produce — dealing a pump inside the office proved nothing except that
    // impossible forecourts behave impossibly. Turned pumps are in the deck
    // too, the way the starting station now deals its own.
    for (let tries = 0; tries < 40; tries++) {
      const rotation = rnd() < 0.5 ? 0 : 90;
      const at = snapPlacement(
        state,
        'pump_standard',
        [
          4 + Math.floor(rnd() * (state.station.plots.width - 8)),
          6 + Math.floor(rnd() * (state.station.plots.height - 9))
        ],
        rotation
      );
      if (!evaluatePlacement(state, 'pump_standard', at, rotation).valid) continue;
      state.pumps[`p${i}`] = {
        ...proto,
        id: `p${i}`,
        position: at,
        rotation,
        currentVehicleId: null,
        employeeId: null
      };
      break;
    }
  }

  const wanted = 2 + Math.floor(rnd() * 4);
  for (let i = 0; i < wanted; i++) {
    const type = TYPES[Math.floor(rnd() * TYPES.length)];
    if (state.buildings[`r_${type}`]) continue;

    for (let tries = 0; tries < 40; tries++) {
      const at = snapPlacement(state, type, [
        2 + Math.floor(rnd() * (state.station.plots.width - 4)),
        2 + Math.floor(rnd() * (state.station.plots.height - 4))
      ]);
      if (!evaluatePlacement(state, type, at, 0).valid) continue;
      state.buildings[`r_${type}`] = {
        id: `r_${type}`,
        type,
        level: 1,
        position: at,
        rotation: 0,
        size: GAME_CONFIG.buildings[type].size,
        health: 100,
        constructionState: 'ACTIVE',
        builtAtTimestamp: 0
      } as GameState['buildings'][string];
      break;
    }
  }

  const effects = createEffects();
  const hits = new Set<string>();

  for (let i = 0; i < seconds * 20 && hits.size === 0; i++) {
    runSimulationTick(state, 0.05, effects);

    for (const vehicle of Object.values(state.vehicles)) {
      const [x, , z] = vehicle.worldPosition;
      const body = corners(x, z, vehicle.heading);

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

        hits.add(
          `${building.type}@${building.position.join(',')} <- ${vehicle.state}` +
            `${inside ? '' : ' (rota)'} | pompa ${Object.values(state.pumps)
              .map((p) => p.position.join(','))
              .join(' ')}`
        );
      }
    }
  }

  return [...hits];
}

describe('vehicles and buildings, on forecourts nobody designed', () => {
  for (const seed of [1, 7]) {
    it(
      `keeps cars out of the buildings across a dozen random layouts (seed ${seed})`,
      () => {
        // The traffic is a dice roll too, so the same stream drives both. A
        // fuzz test that cannot be re-run on the layout that broke is not much
        // use when it does break.
        let value = seed;
        const rnd = () => {
          value = (value * 1664525 + 1013904223) % 4294967296;
          return value / 4294967296;
        };
        const spy = vi.spyOn(Math, 'random').mockImplementation(rnd);

        try {
          const broken: string[] = [];
          for (let i = 0; i < 12; i++) {
            const hits = round(rnd, 120);
            if (hits.length > 0) broken.push(`düzen ${i}: ${hits.join(' ; ')}`);
          }
          expect(broken).toEqual([]);
        } finally {
          spy.mockRestore();
        }
      },
      180_000
    );
  }
});
