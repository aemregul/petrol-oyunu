import { describe, it, expect, vi } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick, blockLayout } from '../domain/services/simulationEngine';
import { evaluatePlacement, snapPlacement } from '../domain/services/placement';
import { GameState } from '../domain/types/gameState';

/**
 * Emre, 2026-09-09: "pompaları yan yana koyduğumuzda araçlar tıkanıyor ve
 * sapıtıyor; çıkış yaparken tarladan çıkıyor ama yoldaymış gibi diğer araçlar
 * onu bekliyor, yola bağlanamıyor, 20 sn sonra siliniyor." Every player will
 * build differently and a pump may stand anywhere the rules allow, so two
 * pumps as close abreast as the rules allow is a layout the engine must
 * simply drive.
 *
 * Three things went wrong there, each now pinned:
 *  - the exit roll-out ignored the NEIGHBOURING island, so a car leaving one
 *    bay rolled to the foot of the next island and jammed turning to the lane;
 *  - a car re-routed while leaving was handed the raw "end of the road" as a
 *    goal, and the planner ran that leg out through the side of the plot —
 *    over the field, onto the highway far down, where the traffic waited on it;
 *  - the approach to a bay behind a neighbouring island was drawn through it.
 */

function seeded(seed: number) {
  let value = seed;
  return vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  });
}

function twoPumpsAbreast(rotation: 0 | 90, staffed: boolean): GameState {
  const s = createInitialGameState();
  s.dayState.timeSpeed = 1;
  s.player.level = 12;
  s.player.cash = 500000;
  s.player.reputation = 5;
  s.dayState.eventsToday = 99;
  s.pricing.gasoline.playerPrice = s.pricing.gasoline.regionalAverage * 0.75;
  s.station.roadLevel = 2;

  const proto = Object.values(s.pumps)[0];
  s.pumps = {};
  const a = snapPlacement(s, 'pump_standard', [7, 8], rotation);
  s.pumps.pa = { ...proto, id: 'pa', position: a, rotation, supportedFuels: ['gasoline', 'diesel'], currentVehicleId: null, employeeId: null };
  // The second pump as close beside the first as the rules allow.
  let placed: [number, number] | null = null;
  for (let dx = 1; dx <= 8 && !placed; dx += 0.5) {
    const at = snapPlacement(s, 'pump_standard', [a[0] + dx, a[1]], rotation);
    if (evaluatePlacement(s, 'pump_standard', at, rotation).valid) placed = at;
  }
  expect(placed).not.toBeNull();
  s.pumps.pb = { ...proto, id: 'pb', position: placed!, rotation, supportedFuels: ['gasoline', 'diesel'], currentVehicleId: null, employeeId: null };

  if (staffed) {
    for (const id of ['pa', 'pb']) {
      s.employees[`e_${id}`] = {
        id: `e_${id}`, name: id, role: 'PUMP_ATTENDANT', level: 3, wage: 1000, assignedPumpId: id,
        state: 'IDLE', serviceCount: 0, currentVehicleId: null, actionTimerSeconds: 0, worldPosition: [0, 0, 0]
      } as never;
    }
  }
  return s;
}

/** Drives the station and collects what the player saw: jams and cars in the field. */
function drive(s: GameState, seconds: number): { faults: string[]; served: number } {
  const block = blockLayout(s, 'near')!;
  const effects = createEffects();
  const faults: string[] = [];
  const reported = new Set<string>();
  const still = new Map<string, number>();
  const prev = new Map<string, [number, number]>();
  const PARKED = ['AT_PUMP', 'REQUEST', 'FUELING', 'PAYMENT', 'OPTIONAL_SHOP', 'VISITING'];

  for (let i = 0; i < seconds * 20; i++) {
    runSimulationTick(s, 0.05, effects);
    for (const v of Object.values(s.vehicles)) {
      const [x, , z] = v.worldPosition;
      const was = prev.get(v.id);
      const moved = was ? Math.hypot(x - was[0], z - was[1]) : 1;
      prev.set(v.id, [x, z]);

      // Off the apron through its side or back: the only way off is the mouth.
      const sideways = (x > block.maxX + 0.3 || x < block.minX - 0.3) && z > 0.5;
      const behind = z > block.maxZ + 0.3;
      if ((sideways || behind) && !reported.has(v.id)) {
        reported.add(v.id);
        faults.push(`${v.state} off the apron at ${x.toFixed(1)},${z.toFixed(1)} (t=${(i / 20).toFixed(0)}s)`);
      }

      // Pinned against a solid for seconds while meant to be moving.
      const onPlot = z >= -0.5 && z <= block.maxZ + 0.5;
      if (moved < 0.002 && onPlot && !PARKED.includes(v.state)) {
        const n = (still.get(v.id) ?? 0) + 1;
        still.set(v.id, n);
        if (n === 60 && (v.solidStuckSeconds ?? 0) > 2.5 && !reported.has(v.id + ':solid')) {
          reported.add(v.id + ':solid');
          const route = [v.targetWaypoint, ...v.route]
            .filter((w): w is [number, number, number] => !!w)
            .map((w) => `${w[0].toFixed(1)},${w[2].toFixed(1)}`)
            .join('>');
          faults.push(
            `${v.state} pinned at ${x.toFixed(2)},${z.toFixed(2)} heading ${v.heading.toFixed(2)} for ` +
              `${(v.solidStuckSeconds ?? 0).toFixed(1)}s (t=${(i / 20).toFixed(0)}s) route ${route}`
          );
        }
      } else if (moved >= 0.002) {
        still.set(v.id, 0);
      }
    }
  }
  return { faults, served: s.dayState.todayStats.customersServed };
}

describe('two pumps as close abreast as the rules allow', () => {
  for (const rotation of [0, 90] as const) {
    for (const seed of [11, 29]) {
      it(`serves customers and jams nobody (rotation ${rotation}, seed ${seed})`, () => {
        const spy = seeded(seed);
        try {
          const { faults, served } = drive(twoPumpsAbreast(rotation, true), 400);
          expect(faults).toEqual([]);
          expect(served).toBeGreaterThan(5);
        } finally {
          spy.mockRestore();
        }
      }, 60_000);
    }
  }

  it('sends impatient leavers out through the mouth, never over the field (unstaffed, rotation 90)', () => {
    // No attendant: every customer waits, gives up and is sent away from the
    // bay or the queue — the traffic that produced the car in the field.
    const spy = seeded(11);
    try {
      const { faults } = drive(twoPumpsAbreast(90, false), 400);
      expect(faults).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});
