import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity } from '../domain/types/gameState';
import {
  createEffects,
  runSimulationTick,
  beginFueling,
  finalizeSale,
  closeForecourt
} from '../domain/services/simulationEngine';
import { availableFuelLiters } from '../domain/services/TransactionService';
import { useGameStore } from '../store/gameStore';

/**
 * Emre, 2026-09-12: "Yakıt miktarının dolum sırasında anlık azalmaması,
 * işlem sonunda birden değişmesi bu olmasın" — the tank sat still while the
 * meter ran, then jumped at the till. Fuel now leaves the tank as it goes
 * down the hose; the hold on it shrinks by the same litres, so what is left
 * to sell to anyone else never moves, and the till takes nothing twice.
 */

/** Closed to new custom, so only the car a test puts down is about. */
function quiet(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.station.open = false;
  state.tanks.gasoline.stock = 1000;
  state.tanks.gasoline.reservedStock = 0;
  return state;
}

function atPump(state: GameState): VehicleEntity {
  const vehicle: VehicleEntity = {
    id: 'pouring',
    archetype: 'family',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 60,
    currentFuel: 10,
    request: {
      mode: 'LITERS', targetValue: 20, calculatedLiters: 20, calculatedPrice: 0,
      dispensedLiters: 0, isFinished: false
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

function tick(state: GameState, seconds: number): void {
  const effects = createEffects();
  for (let i = 0; i < Math.round(seconds / 0.05); i++) runSimulationTick(state, 0.05, effects);
}

describe('the tank while a customer is filling up', () => {
  it('falls with the meter while the player pours, and the till takes nothing more', () => {
    const state = quiet();
    const car = atPump(state);
    const tank = state.tanks.gasoline;
    const effects = createEffects();

    expect(beginFueling(state, car, 'LITERS', 20, 'PLAYER', effects)).toBe(true);
    expect(tank.stock).toBe(1000);
    expect(availableFuelLiters(tank)).toBeCloseTo(980, 5);

    tick(state, 1);
    const poured = car.request.dispensedLiters;
    expect(poured).toBeGreaterThan(1);
    expect(poured).toBeLessThan(20);
    // Down by what went in: not by nothing, and not by all of it…
    expect(tank.stock).toBeCloseTo(1000 - poured, 5);
    // …while nobody else can buy a litre more or less than before.
    expect(availableFuelLiters(tank)).toBeCloseTo(980, 5);

    for (let i = 0; i < 400 && car.state === 'FUELING'; i++) tick(state, 0.05);
    expect(car.state).toBe('PAYMENT');
    expect(tank.stock).toBeCloseTo(980, 5);
    expect(tank.reservedStock).toBeCloseTo(0, 5);

    const cash = state.player.cash;
    finalizeSale(state, car, effects);
    expect(tank.stock).toBeCloseTo(980, 5);
    expect(tank.reservedStock).toBeCloseTo(0, 5);
    expect(state.player.cash).toBeGreaterThan(cash);
    expect(state.player.statistics.totalFuelSoldLiters).toBeCloseTo(20, 5);
  });

  it('falls as the attendant pours, too', () => {
    const start = quiet();
    start.player.level = 3;
    start.player.cash = 100_000;
    useGameStore.setState({ gameState: start, selectedPumpId: 'pump_1' });
    expect(useGameStore.getState().hirePumpAttendant('pump_1')).toBe(true);

    const state = JSON.parse(JSON.stringify(useGameStore.getState().gameState)) as GameState;
    const car = atPump(state);
    const tank = state.tanks.gasoline;
    let seenMidPour = false;
    for (let i = 0; i < 600 && (car.state === 'AT_PUMP' || car.state === 'REQUEST' || car.state === 'FUELING'); i++) {
      runSimulationTick(state, 0.05, createEffects());
      const poured = car.request.dispensedLiters;
      if (car.state === 'FUELING' && car.assignedActor === 'EMPLOYEE' && poured > 1 && poured < 19) {
        expect(tank.stock).toBeCloseTo(1000 - poured, 5);
        seenMidPour = true;
      }
    }
    expect(seenMidPour).toBe(true);
  });

  it('lets a car sent away mid-pour leave with what it took, and gives back only the rest', () => {
    const state = quiet();
    const car = atPump(state);
    const tank = state.tanks.gasoline;
    expect(beginFueling(state, car, 'LITERS', 20, 'PLAYER', createEffects())).toBe(true);
    tick(state, 1);
    const poured = car.request.dispensedLiters;

    const cleared = closeForecourt(state);
    expect(cleared.unpaidLiters).toBeCloseTo(poured, 1);
    expect(tank.stock).toBeCloseTo(1000 - poured, 5);
    expect(tank.reservedStock).toBeCloseTo(0, 5);
  });

  it('still settles, at the till, a pour saved before the tank drew as it went', () => {
    const state = quiet();
    const car = atPump(state);
    const tank = state.tanks.gasoline;
    car.state = 'PAYMENT';
    car.assignedActor = 'PLAYER';
    car.request = { ...car.request, dispensedLiters: 20, isFinished: true, reservedLiters: 20 };
    tank.reservedStock = 20;

    finalizeSale(state, car, createEffects());
    expect(tank.stock).toBeCloseTo(980, 5);
    expect(tank.reservedStock).toBeCloseTo(0, 5);
  });
});
