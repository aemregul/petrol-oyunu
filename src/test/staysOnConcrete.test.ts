import { describe, it, expect, vi } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick, blockLayout, placeFuelOrder } from '../domain/services/simulationEngine';
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

/**
 * Emre, 2026-09-09: "tankerler arsa dışında neden?" — two parcels bought
 * behind the tank farm and not yet paved. The forecourt box grew on purchase,
 * the lorry's berth behind the farm landed on the grass, and the planner saw
 * no wall there because the bare land lay outside the concrete's own bounding
 * box. Land you have not paved is fenced ground: nothing drives on it, and
 * the forecourt is measured over the concrete alone.
 */
describe('bought but unpaved land behind the forecourt', () => {
  function withBareBackRow(): GameState {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.cash = 500000;
    state.player.level = 12;
    state.tanks.gasoline.stock = 200;
    state.tanks.diesel.stock = 200;
    state.pumps.pump_1.supportedFuels = ['gasoline', 'diesel'];
    // Bought, not paved — and the box stays the concrete: 16 x 14.
    state.station.plots.ownedParcels.push('0,2', '1,2');
    return state;
  }

  it('walls the bare parcels off even though they lie beyond the concrete', () => {
    const plots = withBareBackRow().station.plots;
    expect(plots.width).toBe(16);
    expect(plots.height).toBe(14);
    // Grown to the owned bounds — the old way — the bare row would sit inside
    // the box and outside every wall.
    const grown = { ...plots, height: 21 };
    const holes = unpavedHoles(grown, 'near');
    expect(holes).toHaveLength(2);
    expect(holes).toContainEqual({ minX: 0, minZ: 14, maxX: 8, maxZ: 21 });
    expect(holes).toContainEqual({ minX: 8, minZ: 14, maxX: 16, maxZ: 21 });
  });

  it('keeps the lorries and the cars on the concrete', () => {
    let value = 21 >>> 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    });

    try {
      const state = withBareBackRow();
      const effects = createEffects();
      placeFuelOrder(state, 'gasoline', 1000, effects);
      placeFuelOrder(state, 'diesel', 1000, effects);
      for (const order of state.fuelOrders) order.remainingSeconds = 2;

      let lorryTicks = 0;
      let offConcrete: string[] = [];
      for (let i = 0; i < 6000; i++) {
        runSimulationTick(state, 0.05, effects);
        for (const order of state.fuelOrders) {
          const truck = order.truck;
          if (!truck || truck.phase === 'LEAVING') continue;
          lorryTicks++;
          const [x, , z] = truck.worldPosition;
          if (z > 14.01 || x > 16.01) offConcrete.push(`lorry ${x.toFixed(1)},${z.toFixed(1)}`);
        }
        for (const v of Object.values(state.vehicles)) {
          const [x, , z] = v.worldPosition;
          if (z > 14.01 && z < 30) offConcrete.push(`${v.state} ${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
      expect(lorryTicks).toBeGreaterThan(0);
      expect([...new Set(offConcrete)].slice(0, 5)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
