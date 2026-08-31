import { describe, it, expect, vi } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick, blockLayout } from '../domain/services/simulationEngine';
import { unpavedHoles } from '../domain/services/land';
import { GameState } from '../domain/types/gameState';

/** An L-shaped plot: three parcels of a two-by-two block, the fourth skipped. */
function lShapedStation(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.cash = 500000;
  state.player.level = 12;
  state.tanks.gasoline.capacity = 9000;
  state.tanks.gasoline.stock = 9000;
  state.tanks.diesel.stock = 4000;
  state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.65;

  // '1,1' is deliberately left off: bought land, no concrete, no forecourt.
  state.station.plots.ownedParcels = ['0,0', '1,0', '0,1'];
  state.station.plots.pavedParcels = ['0,0', '1,0', '0,1'];
  state.station.plots.width = 16;
  state.station.plots.height = 14;

  state.employees.emp_a = {
    id: 'emp_a',
    name: 'emp_a',
    role: 'PUMP_ATTENDANT',
    level: 3,
    wage: 1050,
    assignedPumpId: 'pump_1',
    state: 'IDLE',
    serviceCount: 0,
    currentVehicleId: null,
    actionTimerSeconds: 0,
    worldPosition: [8, 0, 8]
  };

  return state;
}

describe('the shape of the plot', () => {
  it('reports the bare ground inside an L-shaped plot', () => {
    const plots = lShapedStation().station.plots;
    const holes = unpavedHoles(plots, 'near');

    // Parcel '1,1' spans grid x 8..16, z 7..14.
    expect(holes).toHaveLength(1);
    expect(holes[0]).toEqual({ minX: 8, minZ: 7, maxX: 16, maxZ: 14 });

    // A plain rectangle, fully paved, has nothing to report — this is the
    // common case and it must stay allocation-free and empty.
    const square = createInitialGameState().station.plots;
    expect(unpavedHoles(square, 'near')).toHaveLength(0);
  });

  it('keeps every vehicle off the grass, lorries included', () => {
    let value = 13 >>> 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    });

    try {
      const state = lShapedStation();
      const block = blockLayout(state, 'near')!;
      const holes = unpavedHoles(state.station.plots, 'near');
      expect(holes).toHaveLength(1);

      const inside = (x: number, z: number) =>
        holes.some((h) => x > h.minX && x < h.maxX && z > h.minZ && z < h.maxZ);

      const effects = createEffects();
      let onGrass = 0;
      let lorryOnGrass = 0;
      let seen = 0;

      for (let i = 0; i < 24000; i++) {
        runSimulationTick(state, 0.05, effects);

        for (const v of Object.values(state.vehicles)) {
          // Cars on the highway are not on the plot at all.
          if (v.worldPosition[2] < block.minZ) continue;
          seen++;
          if (inside(v.worldPosition[0], v.worldPosition[2])) onGrass++;
        }

        for (const order of state.fuelOrders) {
          const truck = order.truck;
          if (!truck || truck.worldPosition[2] < block.minZ) continue;
          if (inside(truck.worldPosition[0], truck.worldPosition[2])) lorryOnGrass++;
        }
      }

      // The day has to actually happen, or nothing below means anything.
      expect(seen).toBeGreaterThan(1000);
      expect(onGrass).toBe(0);
      expect(lorryOnGrass).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
