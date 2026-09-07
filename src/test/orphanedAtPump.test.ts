import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity } from '../domain/types/gameState';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-07: a lorry stood at a bay, not fuelling, not leaving, while
 * a car was served at the same bay through it. Its pump had been handed to
 * somebody else while it stayed in a pump state — and nothing in that state
 * ever asks whether the pump is still yours. Now something does.
 */

function vehicle(id: string, state: VehicleEntity['state'], pumpId: string | null): VehicleEntity {
  return {
    id,
    archetype: 'truck',
    modelVariant: 'truck',
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
    targetPumpId: pumpId,
    assignedActor: null,
    worldPosition: [8.5, 0, 5.6],
    targetWaypoint: null,
    route: [],
    heading: Math.PI / 2,
    speed: 1,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
}

function station(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.station.open = false;
  return state;
}

describe('a vehicle whose pump went to somebody else', () => {
  it('is sent on its way at once, and the pump stays with its real customer', () => {
    const state = station();
    const lorry = vehicle('lorry', 'AT_PUMP', 'pump_1');
    const car = vehicle('car', 'FUELING', 'pump_1');
    car.archetype = 'commuter';
    car.modelVariant = 'sedan';
    state.vehicles.lorry = lorry;
    state.vehicles.car = car;
    state.pumps.pump_1.currentVehicleId = 'car';
    state.pumps.pump_1.state = 'FUELING';

    runSimulationTick(state, 0.05, createEffects());

    expect(['EXIT', 'DESPAWN']).toContain(lorry.state);
    expect(lorry.targetPumpId).toBeNull();
    // The car keeps the pump, untouched.
    expect(state.pumps.pump_1.currentVehicleId).toBe('car');
    expect(state.pumps.pump_1.state).toBe('FUELING');
    expect(car.state).toBe('FUELING');
  });

  it('leaves a customer whose pump is genuinely theirs alone', () => {
    const state = station();
    const lorry = vehicle('lorry', 'AT_PUMP', 'pump_1');
    state.vehicles.lorry = lorry;
    state.pumps.pump_1.currentVehicleId = 'lorry';
    state.pumps.pump_1.state = 'REQUEST_READY';

    runSimulationTick(state, 0.05, createEffects());
    expect(lorry.state).toBe('AT_PUMP');
    expect(state.pumps.pump_1.currentVehicleId).toBe('lorry');
  });

  it('leaves the walk-up to a dead bay to its own rule', () => {
    // A driver who pulled up to see a bay that cannot serve them holds no
    // pump at all; that is the dead-forecourt path, with its own reason
    // and its own reputation cost, and not an orphan.
    const state = station();
    state.tanks.gasoline.stock = 0;
    const lorry = vehicle('lorry', 'AT_PUMP', null);
    state.vehicles.lorry = lorry;
    const effects = createEffects();
    runSimulationTick(state, 0.05, effects);
    expect(lorry.state).toBe('AT_PUMP');
    runSimulationTick(state, 0.5, effects);
    expect(['EXIT', 'DESPAWN']).toContain(lorry.state);
    expect(effects.notifications.some((n) => n.message.includes('deposu boş'))).toBe(true);
  });
});
