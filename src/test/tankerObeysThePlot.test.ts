import { describe, it, expect, vi } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick, blockLayout } from '../domain/services/simulationEngine';
import { wallRects } from '../domain/services/pathfinding';
import { GameState } from '../domain/types/gameState';

/**
 * A delivery lorry is a vehicle on the forecourt like any other.
 *
 * Its route used to be four hand-written waypoints, the second of which drove
 * straight up from the entrance mouth to the back lane — through the office on
 * the starting plot. The planner could only answer "no route", and the code
 * then took a raw straight line anyway: the lorry crossed the grass, drove
 * through whatever stood in its way, and berthed inside a building to unload.
 * The fallback meant the planner's answer never mattered, so the lorry obeyed
 * nothing on any layout, not just awkward ones.
 */
function stationWithDelivery(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.cash = 900000;
  state.player.level = 12;
  state.tanks.gasoline.stock = 200;
  state.fuelOrders.push({
    id: 'order_test',
    fuelType: 'gasoline',
    liters: 1000,
    pricePerLiter: 36,
    totalCost: 36000,
    state: 'TRAVELLING',
    remainingSeconds: 0.1,
    truck: null
  } as never);
  return state;
}

describe('the delivery lorry obeys the plot', () => {
  it('never drives through a building or off the concrete', () => {
    let value = 5 >>> 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    });

    try {
      const state = stationWithDelivery();
      const block = blockLayout(state, 'near')!;
      const effects = createEffects();

      let insideAWall = 0;
      let offThePlot = 0;
      let berthed = 0;
      let onPlotTicks = 0;

      for (let i = 0; i < 12000; i++) {
        runSimulationTick(state, 0.05, effects);

        for (const order of state.fuelOrders) {
          const truck = order.truck;
          if (!truck) continue;
          const [x, , z] = truck.worldPosition;
          // Still out on the highway: not the plot's business yet.
          if (z < block.minZ) continue;
          onPlotTicks++;

          if (order.state === 'UNLOADING') berthed++;

          // The tank farm is what it has come for, so it is allowed inside
          // that one's margin; every other building is a wall.
          const tank = Object.values(state.buildings).find((b) => b.type === 'tank_farm');
          const walls = wallRects(state, 'near', 0, tank?.id);
          if (walls.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ)) {
            insideAWall++;
          }
          if (x < block.minX || x > block.maxX || z > block.maxZ) offThePlot++;
        }
      }

      // The delivery has to have actually run, or the counts pass by default.
      expect(onPlotTicks).toBeGreaterThan(200);
      expect(berthed).toBeGreaterThan(0);

      expect(insideAWall).toBe(0);
      expect(offThePlot).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
