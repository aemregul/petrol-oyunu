import { describe, expect, it } from 'vitest';
import { SaveManager } from '../domain/services/SaveManager';
import {
  beginFueling,
  createEffects,
  runSimulationTick
} from '../domain/services/simulationEngine';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity } from '../domain/types/gameState';

function waitingCustomer(state: GameState): VehicleEntity {
  const vehicle: VehicleEntity = {
    id: 'low_stock_customer',
    archetype: 'family',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 50,
    currentFuel: 30,
    request: {
      mode: 'LITERS',
      targetValue: 20,
      calculatedLiters: 20,
      calculatedPrice: 0,
      dispensedLiters: 0,
      isFinished: false
    },
    patience: 100,
    maxPatience: 100,
    satisfaction: 100,
    state: 'AT_PUMP',
    targetPumpId: 'pump_1',
    assignedActor: null,
    worldPosition: [8.5, 0, 5.6],
    targetWaypoint: null,
    route: [],
    heading: 0,
    speed: 0,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
  state.vehicles[vehicle.id] = vehicle;
  state.pumps.pump_1.currentVehicleId = vehicle.id;
  state.pumps.pump_1.state = 'REQUEST_READY';
  return vehicle;
}

describe('fuel reservation recovery', () => {
  it('heals a stocked tank whose old reservation has no customer', () => {
    const state = createInitialGameState();
    state.tanks.gasoline.stock = 138;
    state.tanks.gasoline.reservedStock = 138;
    const vehicle = waitingCustomer(state);
    const effects = createEffects();

    runSimulationTick(state, 0.6, effects);

    expect(state.tanks.gasoline.reservedStock).toBe(0);
    expect(vehicle.state).toBe('AT_PUMP');
    expect(effects.notifications.some((note) => note.message.includes('deposu boş'))).toBe(false);
    expect(beginFueling(state, vehicle, 'LITERS', 20, 'PLAYER', effects)).toBe(true);
    expect(vehicle.request.calculatedLiters).toBe(20);
  });

  it('repairs the same orphaned number as soon as an older save loads', () => {
    const state = createInitialGameState();
    state.tanks.diesel.stock = 66;
    state.tanks.diesel.reservedStock = 66;
    state.vehicles = {};

    const loaded = SaveManager.fromRaw(JSON.parse(JSON.stringify(state)));

    expect(loaded.tanks.diesel.stock).toBe(66);
    expect(loaded.tanks.diesel.reservedStock).toBe(0);
  });

  it('preserves the live reservation of a manual session whose modal was covered', () => {
    const state = createInitialGameState();
    const vehicle = waitingCustomer(state);
    const effects = createEffects();
    expect(beginFueling(state, vehicle, 'LITERS', 20, 'PLAYER', effects)).toBe(true);

    const loaded = SaveManager.fromRaw(JSON.parse(JSON.stringify(state)));
    expect(loaded.tanks.gasoline.reservedStock).toBe(20);

    runSimulationTick(loaded, 0.05, createEffects());
    expect(loaded.tanks.gasoline.reservedStock).toBe(20);
    expect(loaded.vehicles.low_stock_customer.state).toBe('FUELING');
  });
});
