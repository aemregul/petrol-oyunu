import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity } from '../domain/types/gameState';
import {
  createEffects,
  runSimulationTick,
  queueSlotPosition,
  queueSetback,
  vehicleBodyHalfExtents
} from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-07: a bus, a fire engine or an articulated lorry arriving
 * while a car was being served drove straight up to the pump instead of
 * waiting behind it. The queue slot was one car-length behind the bay for
 * every vehicle alike, so a body twice as long stood with its nose against
 * the car at the pump — and against the island's corner, which had it
 * hunting for another way in. Slots now step back by what the body is
 * longer than a car, so every nose stops on the same line.
 */

function seedRandom(seed = 99): () => void {
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

function vehicle(
  id: string,
  archetype: VehicleEntity['archetype'],
  modelVariant: VehicleEntity['modelVariant'],
  state: VehicleEntity['state'],
  worldPosition: [number, number, number]
): VehicleEntity {
  return {
    id,
    archetype,
    modelVariant,
    fuelType: 'gasoline',
    tankCapacity: 80,
    currentFuel: 20,
    request: {
      mode: 'LITERS', targetValue: 20, calculatedLiters: 20, calculatedPrice: 0,
      dispensedLiters: 0, isFinished: false
    },
    patience: 120,
    maxPatience: 120,
    satisfaction: 100,
    state,
    targetPumpId: null,
    assignedActor: null,
    worldPosition,
    targetWaypoint: null,
    route: [],
    heading: Math.PI / 2,
    speed: 1,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
}

/** The starting station with a car being served at its one pump. */
function busyPump(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.station.open = false; // nobody else turns in
  const car = vehicle('car', 'commuter', 'sedan', 'AT_PUMP', [8.5, 0, 5.6]);
  car.targetPumpId = 'pump_1';
  state.vehicles.car = car;
  state.pumps.pump_1.currentVehicleId = 'car';
  state.pumps.pump_1.state = 'REQUEST_READY';
  return state;
}

function advance(state: GameState, seconds: number): void {
  const effects = createEffects();
  for (let i = 0; i < Math.round(seconds / 0.05); i++) runSimulationTick(state, 0.05, effects);
}

describe('long bodies in the queue', () => {
  it('steps a slot back by what the body is longer than a car', () => {
    const state = createInitialGameState();
    const bus = vehicle('bus', 'bus', 'bus', 'QUEUE', [0, 0, 0]);
    const car = vehicle('car', 'commuter', 'sedan', 'QUEUE', [0, 0, 0]);
    const extra = vehicleBodyHalfExtents(bus).length - 0.9;
    expect(extra).toBeGreaterThan(1);

    // A car at the head stands where it always has; a bus stands its extra
    // length further back, so its nose is on the same line.
    expect(queueSetback([car], 0)).toBe(0);
    expect(queueSetback([bus], 0)).toBeCloseTo(extra, 6);
    expect(queueSlotPosition(state, 0, 'near', queueSetback([bus], 0))[0]).toBeCloseTo(5.1 - extra, 6);
    // Behind a bus, a car steps back twice the bus's extra: the bus's tail
    // is that much further back, and so is the gap it leaves.
    expect(queueSetback([bus, car], 1)).toBeCloseTo(2 * extra, 6);
  });

  it('holds a bus behind the car being served, nose on the car line', () => {
    const state = busyPump();
    // Arrived at the mouth, on the front lane, like any driver turning in.
    const bus = vehicle('bus', 'bus', 'bus', 'ROAD_APPROACH', [3, 0, 4]);
    state.vehicles.bus = bus;

    advance(state, 0.05);
    expect(bus.state).toBe('QUEUE');

    advance(state, 15);
    expect(bus.state).toBe('QUEUE');
    expect(bus.targetPumpId).toBeNull();
    // Standing still on the queue line, its nose no further forward than a
    // car's would be — clear of the car at the pump and of the island.
    const nose = bus.worldPosition[0] + vehicleBodyHalfExtents(bus).length;
    expect(nose).toBeLessThanOrEqual(5.1 + 0.9 + 0.1);
    expect(Math.abs(bus.worldPosition[2] - 5.6)).toBeLessThan(0.3);
    expect(bus.solidStuckSeconds ?? 0).toBe(0);
  });

  it('does the same for a fire engine and an articulated lorry', () => {
    for (const [archetype, variant] of [
      ['firetruck', 'firetruck'],
      ['truck', 'truck-with-trailer']
    ] as const) {
      const state = busyPump();
      const big = vehicle('big', archetype, variant, 'ROAD_APPROACH', [3, 0, 4]);
      state.vehicles.big = big;
      advance(state, 15);
      expect(big.state).toBe('QUEUE');
      const nose = big.worldPosition[0] + vehicleBodyHalfExtents(big).length;
      expect(nose).toBeLessThanOrEqual(5.1 + 0.9 + 0.1);
    }
  });
});
