import { describe, it, expect } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import {
  createEffects,
  closeForecourt,
  misfuelVehicle,
  MISFUEL_REPAIR_FEE,
  MISFUEL_REPAIR_SECONDS,
  MISFUEL_REPUTATION
} from '../domain/services/simulationEngine';
import type { GameState, VehicleEntity } from '../domain/types/gameState';

/**
 * Emre, 2026-09-14: every nozzle in the fuel window is open, and the wrong one
 * breaks the car down. It stands at the pump and locks it, the station's name
 * takes a knock, and the player pays for the repair; once the repair is done
 * the car leaves and the pump is free again.
 */

const store = () => useGameStore.getState();

function quiet(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.station.open = false;
  state.tanks.gasoline.stock = 1500;
  state.tanks.gasoline.reservedStock = 0;
  state.tanks.diesel.stock = 1500;
  state.tanks.diesel.reservedStock = 0;
  state.player.cash = 15000;
  state.player.reputation = 3;
  return state;
}

function atPump(state: GameState): VehicleEntity {
  const car: VehicleEntity = {
    id: 'misfuel_car',
    archetype: 'family',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 50,
    currentFuel: 20,
    request: {
      mode: 'MONEY', targetValue: 500, calculatedLiters: 10, calculatedPrice: 500,
      dispensedLiters: 0, isFinished: false
    },
    patience: 30,
    maxPatience: 30,
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
  state.vehicles[car.id] = car;
  state.pumps.pump_1.currentVehicleId = car.id;
  state.pumps.pump_1.state = 'REQUEST_READY';
  return car;
}

/** The window open on the car, as a click on it does. */
function openOn(state: GameState, car: VehicleEntity): void {
  useGameStore.setState({
    gameState: state,
    activeModal: 'NONE',
    selectedVehicleId: null,
    lesson: { id: null, step: 0, subject: '', resumeSpeed: 1, endedAt: 0 }
  });
  store().openFuelingPanelForVehicle(car.id);
  expect(store().activeModal).toBe('CUSTOMER_FUEL');
}

const run = (seconds: number) => {
  for (let i = 0; i < seconds * 4; i++) store().simulationTick(0.25);
};

describe('the wrong nozzle', () => {
  it('breaks the car down at its pump, costs reputation and sells nothing', () => {
    const state = quiet();
    const car = atPump(state);
    const effects = createEffects();

    expect(misfuelVehicle(state, car, 'diesel', effects)).toBe(true);
    expect(car.state).toBe('BROKEN_DOWN');
    expect(car.breakdown).toEqual({ nozzle: 'diesel', repairPaid: false, repairSecondsLeft: MISFUEL_REPAIR_SECONDS });
    expect(state.pumps.pump_1.currentVehicleId).toBe(car.id);
    expect(state.player.reputation).toBeCloseTo(3 - MISFUEL_REPUTATION, 5);
    expect(state.dayState.todayStats.customersLost).toBe(1);
    expect(state.tanks.gasoline.reservedStock).toBe(0);
    expect(state.tanks.diesel.reservedStock).toBe(0);
    expect(effects.notifications[0]).toMatchObject({ type: 'CRITICAL', title: 'Yanlış Yakıt — Araç Arızalandı!' });
  });

  it('is not a misfuel when the nozzle is the one the driver wants', () => {
    const state = quiet();
    const car = atPump(state);
    expect(misfuelVehicle(state, car, 'gasoline', createEffects())).toBe(false);
    expect(car.state).toBe('AT_PUMP');
  });

  it('keeps the window up and the pump locked until the repair is paid, however long that takes', () => {
    const state = quiet();
    const car = atPump(state);
    openOn(state, car);

    expect(store().startVehicleFueling(car.id, 'MONEY', 500, 'diesel')).toBe(false);
    expect(store().gameState.vehicles[car.id].state).toBe('BROKEN_DOWN');
    expect(store().activeModal).toBe('CUSTOMER_FUEL');

    run(120);
    const after = store().gameState;
    expect(after.vehicles[car.id].state).toBe('BROKEN_DOWN');
    expect(after.pumps.pump_1.currentVehicleId).toBe(car.id);
    expect(store().activeModal).toBe('CUSTOMER_FUEL');
  });

  it('pours as before through the right nozzle', () => {
    const state = quiet();
    const car = atPump(state);
    openOn(state, car);
    expect(store().startVehicleFueling(car.id, 'MONEY', 500, 'gasoline')).toBe(true);
    expect(store().gameState.vehicles[car.id].state).toBe('FUELING');
  });

  it('charges the repair, then lets the car go and frees the pump once the work is done', () => {
    const state = quiet();
    const car = atPump(state);
    openOn(state, car);
    store().startVehicleFueling(car.id, 'MONEY', 500, 'diesel');

    expect(store().repairBrokenVehicle(car.id)).toBe(true);
    let now = store().gameState;
    expect(now.player.cash).toBe(15000 - MISFUEL_REPAIR_FEE);
    expect(now.dayState.todayStats.repairs).toBe(MISFUEL_REPAIR_FEE);
    expect(now.vehicles[car.id].breakdown?.repairPaid).toBe(true);
    expect(store().activeModal).toBe('NONE');
    // Paid once is paid.
    expect(store().repairBrokenVehicle(car.id)).toBe(false);

    run(MISFUEL_REPAIR_SECONDS - 2);
    now = store().gameState;
    expect(now.vehicles[car.id].state).toBe('BROKEN_DOWN');
    expect(now.pumps.pump_1.currentVehicleId).toBe(car.id);

    run(3);
    now = store().gameState;
    expect(now.vehicles[car.id]?.state).not.toBe('BROKEN_DOWN');
    expect(now.pumps.pump_1.currentVehicleId).toBeNull();
    expect(now.pumps.pump_1.state).toBe('IDLE');
    expect(now.dayState.todayStats.departures?.MISFUEL).toBe(1);
    expect(now.player.cash).toBe(15000 - MISFUEL_REPAIR_FEE);
  });

  it('refuses the repair when the till cannot cover it even on overdraft', () => {
    const state = quiet();
    state.player.cash = -4000;
    const car = atPump(state);
    openOn(state, car);
    store().startVehicleFueling(car.id, 'MONEY', 500, 'diesel');

    expect(store().repairBrokenVehicle(car.id)).toBe(false);
    expect(store().gameState.player.cash).toBe(-4000);
    expect(store().gameState.vehicles[car.id].state).toBe('BROKEN_DOWN');
  });

  it('is towed when the station shuts, and the repair is still owed', () => {
    const state = quiet();
    const car = atPump(state);
    misfuelVehicle(state, car, 'diesel', createEffects());
    const reputation = state.player.reputation;

    closeForecourt(state);
    expect(car.state === 'EXIT' || car.state === 'DESPAWN').toBe(true);
    expect(car.breakdown).toBeUndefined();
    expect(state.player.cash).toBe(15000 - MISFUEL_REPAIR_FEE);
    expect(state.pumps.pump_1.currentVehicleId).toBeNull();
    expect(state.dayState.todayStats.departures?.MISFUEL).toBe(1);
    expect(state.player.reputation).toBe(reputation);
  });
});
