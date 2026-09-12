import { describe, it, expect } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, beginFueling } from '../domain/services/simulationEngine';
import type { GameState, VehicleEntity } from '../domain/types/gameState';

/**
 * Emre, 2026-09-12: a driver ran out of patience and drove off while the fuel
 * window was open for them — the window stayed up, and its buttons still
 * worked on a car that had gone. The window now closes itself once its car
 * is no longer the player's to serve, and no pour can be started on a car
 * that has left the bay.
 */

const store = () => useGameStore.getState();

function quiet(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.station.open = false;
  state.tanks.gasoline.stock = 1500;
  state.tanks.gasoline.reservedStock = 0;
  return state;
}

function atPump(state: GameState, patience: number): VehicleEntity {
  const car: VehicleEntity = {
    id: 'window_car',
    archetype: 'courier',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 50,
    currentFuel: 20,
    request: {
      mode: 'MONEY', targetValue: 250, calculatedLiters: 250 / 45, calculatedPrice: 250,
      dispensedLiters: 0, isFinished: false
    },
    patience,
    maxPatience: 22,
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

/** The window opened on the car, as a click on it does. */
function openOn(state: GameState, car: VehicleEntity): void {
  useGameStore.setState({
    gameState: state,
    activeModal: 'NONE',
    selectedVehicleId: null,
    lesson: { id: null, step: 0, subject: '', resumeSpeed: 1, endedAt: 0 }
  });
  store().openFuelingPanelForVehicle(car.id);
  expect(store().activeModal).toBe('CUSTOMER_FUEL');
  expect(store().selectedVehicleId).toBe(car.id);
}

describe('the fuel window', () => {
  it('closes when the driver runs out of patience and drives off', () => {
    const state = quiet();
    const car = atPump(state, 0.5);
    openOn(state, car);

    for (let i = 0; i < 40; i++) store().simulationTick(0.05);
    expect(['EXIT', 'DESPAWN', undefined]).toContain(store().gameState.vehicles[car.id]?.state);
    expect(store().activeModal).toBe('NONE');
    expect(store().selectedVehicleId).toBeNull();
  });

  it('closes when the car is sent off some other way, with the clock stopped', () => {
    const state = quiet();
    state.station.open = true;
    state.dayState.timeSpeed = 0;
    const car = atPump(state, 100);
    openOn(state, car);

    store().toggleStationOpen();
    expect(store().gameState.station.open).toBe(false);
    expect(store().activeModal).toBe('NONE');
  });

  it('closes when an attendant takes the car over', () => {
    const state = quiet();
    const car = atPump(state, 100);
    openOn(state, car);

    const taken = JSON.parse(JSON.stringify(store().gameState)) as GameState;
    taken.vehicles[car.id].assignedActor = 'EMPLOYEE';
    useGameStore.setState({ gameState: taken });
    expect(store().activeModal).toBe('NONE');
  });

  it("stays open over the player's own pour and hand-over", () => {
    const state = quiet();
    const car = atPump(state, 100);
    openOn(state, car);

    expect(store().startVehicleFueling(car.id, 'MONEY', 250)).toBe(true);
    store().openFuelingPanelForVehicle(car.id);
    for (let i = 0; i < 20; i++) store().simulationTick(0.05);
    expect(store().gameState.vehicles[car.id].state).toBe('PAYMENT');
    expect(store().activeModal).toBe('CUSTOMER_FUEL');
  });

  it('will not start a pour on a car that has left the bay', () => {
    const state = quiet();
    const car = atPump(state, 100);
    car.state = 'EXIT';

    expect(beginFueling(state, car, 'MONEY', 250, 'PLAYER', createEffects())).toBe(false);
    expect(state.tanks.gasoline.reservedStock).toBe(0);
    expect(car.assignedActor).toBeNull();
  });
});
