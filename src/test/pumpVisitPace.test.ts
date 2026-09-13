import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-12: "istasyon büyüdükçe müşteri düşüyor". A driver who leaves
 * the car at a pump to go into the shop holds that pump the whole time. At the
 * full stay and a stroll each way that was two or three fills' worth: with a
 * café beside two pumps the station served a third fewer drivers a day. A
 * pump visit is now a quick one — booked and paid for just the same.
 */

function withCafe(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.dayState.eventsToday = 99;
  state.station.open = false;
  state.player.level = 8;
  state.buildings.cafe = {
    id: 'cafe', type: 'cafe', level: 1, position: [11.5, 12.5], rotation: 0,
    size: GAME_CONFIG.buildings.cafe.size, health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0,
    till: 0, todayRevenue: 0, todayVisits: 0, tariff: 0
  } as GameState['buildings'][string];
  return state;
}

/** Fuelled at the first pump; the driver is out of the car and walking to the café. */
function visitingFromPump(state: GameState): VehicleEntity {
  const car: VehicleEntity = {
    id: 'visitor',
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
    state: 'VISITING',
    targetPumpId: 'pump_1',
    assignedActor: null,
    worldPosition: [8.5, 0, 5.6],
    targetWaypoint: null,
    route: [],
    heading: Math.PI / 2,
    speed: 0,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: true,
    visitBuildingId: 'cafe',
    visitMode: 'PUMP',
    visitor: {
      phase: 'TO_BUILDING',
      worldPosition: [8.5, 0, 6.4],
      heading: 0,
      route: [],
      targetWaypoint: [11.5, 0, 12.5],
      insideSecondsLeft: 0,
      carDoor: [8.5, 0, 6.4],
      look: 0
    }
  };
  state.vehicles[car.id] = car;
  state.pumps.pump_1.currentVehicleId = car.id;
  state.pumps.pump_1.state = 'RESERVED';
  return car;
}

describe('a driver who leaves the car at the pump for the café', () => {
  it('is back and away quickly, and the café still takes the money', () => {
    const state = withCafe();
    const car = visitingFromPump(state);
    const effects = createEffects();

    let seconds = 0;
    while (car.state === 'VISITING' && seconds < 30) {
      runSimulationTick(state, 0.05, effects);
      seconds += 0.05;
    }

    // The walk out and back and a full nine-second stay took some twenty-two
    // seconds, all of it with the pump held.
    expect(car.state).not.toBe('VISITING');
    expect(seconds).toBeLessThan(14);
    expect(state.buildings.cafe.todayVisits).toBe(1);
    expect(state.pumps.pump_1.currentVehicleId).not.toBe(car.id);
  });
});
