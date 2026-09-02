import { describe, it, expect, vi } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  createEffects,
  runSimulationTick,
  blockLayout,
  drivewayLaneX
} from '../domain/services/simulationEngine';
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

  /**
   * The berth behind the farm on the starting plot clamps back INSIDE the
   * farm's own footprint (z = 12.5+1.5+1.3 → apron-clamped to 11.5, which is
   * within the silos), and the berth check used to excuse the farm itself —
   * so the lorry drove into the silos and unloaded from inside them. The
   * farm is a wall like any other now; the road-side berth is the legal one.
   */
  it('never unloads from inside the tank farm', () => {
    let value = 5 >>> 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    });

    try {
      const state = stationWithDelivery();
      // Diesel's berth sits dead-centre on the farm (no sideways offset), so
      // it is the fuel that lands exactly inside the silos when the clamp
      // pulls the berth back over them.
      state.fuelOrders[0].fuelType = 'diesel';
      const farm = state.buildings.tank_1;
      const effects = createEffects();

      let unloadingTicks = 0;
      let insideTheFarm = 0;

      for (let i = 0; i < 12000; i++) {
        runSimulationTick(state, 0.05, effects);
        for (const order of state.fuelOrders) {
          if (order.state !== 'UNLOADING' || !order.truck) continue;
          unloadingTicks++;
          const [x, , z] = order.truck.worldPosition;
          if (
            Math.abs(x - farm.position[0]) < farm.size[0] / 2 &&
            Math.abs(z - farm.position[1]) < farm.size[1] / 2
          ) {
            insideTheFarm++;
          }
        }
      }

      expect(unloadingTicks).toBeGreaterThan(100);
      expect(insideTheFarm).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * When the hose comes off, the lorry drives out through the exit mouth and
   * down the road — it does not evaporate at the berth. It used to: its own
   * parked body (and any neighbour still unloading) was handed to the route
   * planner as a wall, so the way out was "blocked" by the lorry itself.
   */
  it('drives out through the exit mouth instead of vanishing at the berth', () => {
    let value = 5 >>> 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    });

    try {
      const state = stationWithDelivery();
      const block = blockLayout(state, 'near')!;
      const exitLaneX = drivewayLaneX(block.exit, 0);
      const effects = createEffects();

      let leavingTicks = 0;
      let outThroughTheMouth = false;

      for (let i = 0; i < 12000; i++) {
        runSimulationTick(state, 0.05, effects);
        for (const order of state.fuelOrders) {
          if (order.truck?.phase !== 'LEAVING') continue;
          leavingTicks++;
          const [x, , z] = order.truck.worldPosition;
          if (Math.abs(x - exitLaneX) < 2 && Math.abs(z) < 1) outThroughTheMouth = true;
        }
      }

      expect(leavingTicks).toBeGreaterThan(20);
      expect(outThroughTheMouth).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * Deliveries do not queue for each other any more: every order sends its
   * own lorry at once and every hose runs at once. Two lorries sharing a
   * berth is accepted — a row of paid-for fuel idling at the gate read as
   * the game being stuck, not busy.
   */
  it('sends every tanker in at once and unloads them side by side', () => {
    let value = 5 >>> 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    });

    try {
      const state = stationWithDelivery();
      state.fuelOrders.push(
        {
          id: 'order_b',
          fuelType: 'diesel',
          liters: 1000,
          state: 'TRAVELLING',
          remainingSeconds: 0.1,
          truck: null
        } as never,
        {
          id: 'order_c',
          fuelType: 'lpg',
          liters: 1000,
          state: 'TRAVELLING',
          remainingSeconds: 0.1,
          truck: null
        } as never
      );
      const effects = createEffects();

      let mostTrucksAtOnce = 0;
      let mostHosesAtOnce = 0;

      for (let i = 0; i < 12000; i++) {
        runSimulationTick(state, 0.05, effects);
        const trucks = state.fuelOrders.filter((o) => o.truck).length;
        const hoses = state.fuelOrders.filter((o) => o.state === 'UNLOADING').length;
        mostTrucksAtOnce = Math.max(mostTrucksAtOnce, trucks);
        mostHosesAtOnce = Math.max(mostHosesAtOnce, hoses);
      }

      expect(mostTrucksAtOnce).toBe(3);
      expect(mostHosesAtOnce).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * The travel countdown is the journey. The lorry is dispatched onto the
   * road early enough that when the counter reaches zero — the widget's
   * "yolda · 1 sn" — it is standing at the entry mouth, not still a rumour
   * somewhere off the map.
   */
  it('is at the entry mouth when the countdown runs out', () => {
    let value = 5 >>> 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    });

    try {
      const state = stationWithDelivery();
      state.fuelOrders[0].remainingSeconds = 40;
      const block = blockLayout(state, 'near')!;
      const laneX = drivewayLaneX(block.entry, 0);
      const effects = createEffects();

      let drivenWhileCounting = false;
      let atGate: [number, number, number] | null = null;

      for (let i = 0; i < 12000 && !atGate; i++) {
        runSimulationTick(state, 0.05, effects);
        const order = state.fuelOrders[0];
        if (!order) break;
        if (order.state === 'TRAVELLING' && order.truck) drivenWhileCounting = true;
        if (order.state !== 'TRAVELLING') atGate = order.truck?.worldPosition ?? null;
      }

      // Dispatched while the widget still counted, and standing at the mouth
      // — within a couple of car lengths of it — on zero.
      expect(drivenWhileCounting).toBe(true);
      expect(atGate).not.toBeNull();
      const distance = Math.hypot(atGate![0] - laneX, atGate![2] - block.roadLaneZ);
      expect(distance).toBeLessThan(6);
    } finally {
      spy.mockRestore();
    }
  });
});
