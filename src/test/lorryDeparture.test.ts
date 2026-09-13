import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { FuelOrderEntity, GameState, VehicleEntity } from '../domain/types/gameState';
import { blockLayout, createEffects, runSimulationTick } from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-12: "istasyon büyüdükçe müşteri düşüyor". A delivery lorry
 * leaves down the same stretch of forecourt to the exit mouth as the cars
 * leaving the pumps, and it only brakes for what is ahead of its nose. The cars
 * came into that stretch from the side, one after another: with a car park and
 * a café on the plot the lorry stood two minutes and more at the mouth with its
 * trailer across the lanes, the pumps behind it could not be reached, and the
 * day's custom fell by a third. While a lorry is leaving, a car not yet in that
 * stretch waits at its edge.
 */

function leavingCar(state: GameState): VehicleEntity {
  const block = blockLayout(state, 'near')!;
  const car: VehicleEntity = {
    id: 'leaving',
    archetype: 'commuter',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 80,
    currentFuel: 60,
    request: {
      mode: 'LITERS', targetValue: 20, calculatedLiters: 20, calculatedPrice: 0,
      dispensedLiters: 20, isFinished: true
    },
    patience: 100,
    maxPatience: 100,
    satisfaction: 90,
    state: 'EXIT',
    targetPumpId: null,
    assignedActor: null,
    // Pulling forward out of the first pump's bay, towards the exit mouth.
    worldPosition: [9, 0, 5.6],
    targetWaypoint: [block.exit.x, 0, 5.6],
    route: [
      [block.exit.x, 0, block.laneZ],
      [block.exit.x, 0, block.roadLaneZ]
    ],
    heading: Math.PI / 2,
    speed: 1,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
  state.vehicles[car.id] = car;
  return car;
}

function lorryLeaving(state: GameState): void {
  const block = blockLayout(state, 'near')!;
  const order: FuelOrderEntity = {
    id: 'order', fuelType: 'gasoline', liters: 800, unitCost: 70, deliveryFee: 450, totalCost: 56450,
    totalDurationSeconds: 40, remainingSeconds: 0, state: 'COMPLETED', transactionId: 'tx', supplierId: 'standart',
    truck: {
      // Out of its berth and coming down the back of the plot to the exit.
      worldPosition: [block.exit.x, 0, block.exitLaneZ],
      heading: Math.PI,
      route: [[block.exit.x, 0, block.roadLaneZ], [block.roadEndX, 0, block.roadLaneZ]],
      targetWaypoint: [block.exit.x, 0, block.laneZ],
      routeProgress: 0,
      speed: 0.7,
      phase: 'LEAVING',
      tankBuildingId: 'tank_1'
    }
  };
  state.fuelOrders.push(order);
}

function station(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.dayState.eventsToday = 99;
  // Nobody new turns in; the road keeps its own traffic.
  state.station.open = false;
  return state;
}

function runFor(state: GameState, seconds: number): void {
  const effects = createEffects();
  for (let i = 0; i < Math.round(seconds / 0.05); i++) runSimulationTick(state, 0.05, effects);
}

describe('a delivery lorry leaving the plot', () => {
  it('has the way to the exit to itself: a car from the pumps waits at the edge of it', () => {
    const state = station();
    lorryLeaving(state);
    const car = leavingCar(state);
    const [x0, , z0] = car.worldPosition;

    runFor(state, 1);

    expect(Math.hypot(car.worldPosition[0] - x0, car.worldPosition[2] - z0)).toBeLessThan(0.05);
    expect(car.state).toBe('EXIT');
  });

  it('and the same car drives straight out when no lorry is leaving', () => {
    const state = station();
    const car = leavingCar(state);
    const [x0] = car.worldPosition;

    runFor(state, 1);

    expect(car.worldPosition[0] - x0).toBeGreaterThan(0.5);
  });
});
