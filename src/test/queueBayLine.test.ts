import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity, BuildingEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import {
  createEffects,
  runSimulationTick,
  blockLayout,
  queueSlotPosition
} from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-07: with a toilet built at the far left of the forecourt,
 * cars stopped entering the pump. They stood beside the bay, two on the same
 * spot, and left when their patience ran out; a bus would drive up nose-first
 * into the car being served.
 *
 * The toilet stood nowhere near the pump. It was in the way of the queue's
 * LINE, though — the strip along the front — so the layout gave up the bay
 * line and put the queue four tenths behind it. From there the head car
 * turned in at a slight angle, caught its front corner on the island, and
 * never arrived. Every slot behind the head was inside the toilet's margin,
 * so the whole queue collapsed onto the one spot.
 */

function seedRandom(seed = 4242): () => void {
  let value = seed;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  });
  return () => spy.mockRestore();
}

let restore: (() => void) | null = null;
beforeEach(() => {
  restore = seedRandom();
});
afterEach(() => {
  restore?.();
  restore = null;
});

function building(id: string, type: string, position: [number, number]): BuildingEntity {
  return {
    id,
    type,
    level: 1,
    position,
    rotation: 0,
    size: GAME_CONFIG.buildings[type].size,
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0
  };
}

/** The starting plot with a toilet in the front-left corner, off the pump's line. */
function withCornerToilet(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.level = 12;
  state.player.reputation = 5;
  state.buildings.wc = building('wc', 'toilet', [1, 7]);
  return state;
}

function advance(state: GameState, seconds: number): void {
  const effects = createEffects();
  for (let i = 0; i < Math.round(seconds / 0.05); i++) runSimulationTick(state, 0.05, effects);
}

describe('the queue and the bay line', () => {
  it('keeps the queue on the bay line when a building stands only at its tail', () => {
    const bare = blockLayout(createInitialGameState(), 'near')!;
    const built = blockLayout(withCornerToilet(), 'near')!;

    // The pump faces the road from z = 7 with its bay at 5.6; the queue waits
    // on that line, toilet or no toilet.
    expect(bare.queueZ).toBe(5.6);
    expect(built.queueZ).toBe(5.6);
    expect(queueSlotPosition(withCornerToilet(), 0, 'near')).toEqual([5.1, 0, 5.6]);
  });

  it('still leaves the bay line when a building stands on the head of the queue', () => {
    const state = createInitialGameState();
    // Two cells square, right where the head car would wait behind the bay.
    state.buildings.kiosk = building('kiosk', 'toilet', [5, 5]);
    expect(blockLayout(state, 'near')!.queueZ).not.toBe(5.6);
  });

  it('brings a head car that is slightly off the line into the bay rather than into the island', () => {
    const state = withCornerToilet();
    const car: VehicleEntity = {
      id: 'car',
      archetype: 'commuter',
      modelVariant: 'sedan',
      fuelType: 'gasoline',
      tankCapacity: 50,
      currentFuel: 20,
      request: {
        mode: 'LITERS', targetValue: 20, calculatedLiters: 20, calculatedPrice: 0,
        dispensedLiters: 0, isFinished: false
      },
      patience: 40,
      maxPatience: 40,
      satisfaction: 100,
      state: 'ROAD_APPROACH',
      targetPumpId: null,
      assignedActor: null,
      // Four tenths behind the bay line, facing along it — the old lay-by.
      worldPosition: [5.1, 0, 6.0],
      targetWaypoint: null,
      route: [],
      heading: Math.PI / 2,
      speed: 1,
      routeProgress: 0,
      waitingTimeSeconds: 0,
      shoppingIntent: false
    };
    state.vehicles.car = car;

    advance(state, 0.05);
    expect(car.state).toBe('PUMP_RESERVED');
    expect(car.targetPumpId).toBe('pump_1');

    advance(state, 12);
    expect(car.state).toBe('AT_PUMP');
    expect(car.solidStuckSeconds ?? 0).toBe(0);
  });

  it('serves a steady stream without losing anyone to the island', () => {
    const state = withCornerToilet();
    state.tanks.gasoline.stock = 1500;
    state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.85;
    state.employees.emp = {
      id: 'emp', name: 'A', role: 'PUMP_ATTENDANT', level: 3, wage: 1000,
      assignedPumpId: 'pump_1', state: 'IDLE', serviceCount: 0, currentVehicleId: null,
      actionTimerSeconds: 0, worldPosition: [8, 0, 7]
    };
    state.pumps.pump_1.employeeId = 'emp';

    const effects = createEffects();
    let stuckReservations = 0;
    for (let t = 0; t < 230; t += 0.05) {
      runSimulationTick(state, 0.05, effects);
      for (const v of Object.values(state.vehicles)) {
        if (v.state === 'PUMP_RESERVED' && (v.solidStuckSeconds ?? 0) > 3) stuckReservations++;
      }
    }

    const unreachable = effects.notifications.filter((n) => n.message.includes('ulaşamayan'));
    expect(unreachable).toHaveLength(0);
    expect(stuckReservations).toBe(0);
    expect(state.dayState.todayStats.customersServed).toBeGreaterThan(8);
    expect(state.dayState.todayStats.customersLost).toBe(0);
  });
});
