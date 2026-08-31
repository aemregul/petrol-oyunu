import { describe, it, expect, vi } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick, blockLayout, LAYOUT } from '../domain/services/simulationEngine';

/**
 * Leaving the forecourt without stopping the highway.
 *
 * A driver waiting for a gap used to hold one unit off the lane's centre line,
 * which is inside the carriageway rather than beside it: their nose sat in the
 * traffic they were waiting for, too far off the through path for the passing
 * driver to brake for. The two locked together, and on a busy day a fifth of
 * every car-second on the plot was spent stationary behind that knot.
 *
 * Seed 13 is the day that reproduced it: 21% of car-time blocked, one car stuck
 * for 30 seconds, and 613 ticks of an exiting car overlapping passing traffic.
 */
describe('leaving the forecourt', () => {
  it(
    'holds clear of the carriageway instead of waiting in it',
    () => {
      let value = 13 >>> 0;
      const rnd = () => {
        value = (value * 1664525 + 1013904223) % 4294967296;
        return value / 4294967296;
      };
      const spy = vi.spyOn(Math, 'random').mockImplementation(rnd);

      try {
        const state = createInitialGameState();
        state.dayState.timeSpeed = 1;
        state.player.cash = 500000;
        state.tanks.gasoline.capacity = 9000;
        state.tanks.gasoline.stock = 9000;
        state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.65;

        state.pumps.pump_2 = { ...state.pumps.pump_1, id: 'pump_2', position: [12, 7.5] };
        state.pumps.pump_3 = { ...state.pumps.pump_1, id: 'pump_3', position: [4, 7.5] };
        for (const [id, pumpId] of [
          ['emp_a', 'pump_1'],
          ['emp_b', 'pump_2'],
          ['emp_c', 'pump_3']
        ] as const) {
          state.employees[id] = {
            id,
            name: id,
            role: 'PUMP_ATTENDANT',
            level: 3,
            wage: 1050,
            assignedPumpId: pumpId,
            state: 'IDLE',
            serviceCount: 0,
            currentVehicleId: null,
            actionTimerSeconds: 0,
            worldPosition: [12, 0, 10]
          };
        }

        const block = blockLayout(state, 'near')!;
        const effects = createEffects();

        let struck = 0;
        let insideLane = 0;
        let worstBlocked = 0;
        let exitTicks = 0;
        let passTicks = 0;
        const seen = new Set<string>();

        for (let i = 0; i < 24000; i++) {
          runSimulationTick(state, 0.05, effects);
          const vs = Object.values(state.vehicles);

          for (const v of vs) {
            worstBlocked = Math.max(worstBlocked, v.blockedSeconds ?? 0);

            // A car still on its way out has no business standing in the road.
            seen.add(v.id);
            if (v.state === 'PASSING') passTicks++;
            if (v.state !== 'EXIT') continue;
            exitTicks++;
            const away = Math.abs(v.worldPosition[2] - block.roadLaneZ);
            const stopped = (v.blockedSeconds ?? 0) > 0.5;
            if (stopped && away < LAYOUT.roadHalfWidth) insideLane++;
          }

          for (const exiting of vs.filter((v) => v.state === 'EXIT')) {
            for (const passing of vs.filter((v) => v.state === 'PASSING')) {
              const d = Math.hypot(
                exiting.worldPosition[0] - passing.worldPosition[0],
                exiting.worldPosition[2] - passing.worldPosition[2]
              );
              if (d < 1.6) struck++;
            }
          }
        }

        // The day has to actually happen, or the counts below pass by default.
        expect(seen.size).toBeGreaterThan(30);
        expect(exitTicks).toBeGreaterThan(500);
        expect(passTicks).toBeGreaterThan(500);

        expect(struck).toBe(0);
        expect(insideLane).toBe(0);
        // The 30-second knot this test was written for; ordinary give-way
        // waits are a few seconds.
        expect(worstBlocked).toBeLessThan(12);
      } finally {
        spy.mockRestore();
      }
    },
    60_000
  );
});
