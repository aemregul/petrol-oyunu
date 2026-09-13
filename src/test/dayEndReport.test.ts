import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reviveLoadedSave, useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState, VehicleEntity } from '../domain/types/gameState';
import {
  beginFueling,
  closeForecourt,
  createEffects,
  dismissVehicle,
  dispenseStep,
  finalizeSale,
  runSimulationTick
} from '../domain/services/simulationEngine';
import { dayReport } from '../domain/services/dayReport';

/**
 * Players, 2026-09-13: closing time should not roll the day over on its own.
 * At six the books are settled, the clock stops and a proper report goes up —
 * the cars that came, were served and were lost, and what the day earned
 * against what it cost — and the next morning starts when the player says so.
 */

function stubBrowser(): void {
  (globalThis as any).window = {};
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  };
}

const store = () => useGameStore.getState();

let restoreRandom: (() => void) | null = null;
function seedRandom(seed: number): void {
  let value = seed;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  });
  restoreRandom = () => spy.mockRestore();
}

beforeEach(() => {
  stubBrowser();
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  useGameStore.setState({ gameState: state, activeModal: 'NONE' });
});

afterEach(() => {
  restoreRandom?.();
  restoreRandom = null;
});

/** A customer standing at the starting pump's bay, ready to be served. */
function customerAtPump(state: GameState, id = 'car'): VehicleEntity {
  const pump = state.pumps.pump_1;
  const vehicle: VehicleEntity = {
    id,
    archetype: 'commuter',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 50,
    currentFuel: 20,
    request: {
      mode: 'LITERS',
      targetValue: 20,
      calculatedLiters: 20,
      calculatedPrice: 0,
      dispensedLiters: 0,
      isFinished: false
    },
    patience: 40,
    maxPatience: 40,
    satisfaction: 100,
    state: 'AT_PUMP',
    targetPumpId: pump.id,
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
  state.vehicles[id] = vehicle;
  pump.currentVehicleId = id;
  pump.state = 'REQUEST_READY';
  return vehicle;
}

describe('closing time', () => {
  it('stops the day at six and waits for the player to start the next', () => {
    const state = store().gameState;
    state.dayState.gameTime = GAME_CONFIG.economy.dayEndHour - 0.01;
    useGameStore.setState({ gameState: { ...state } });

    for (let i = 0; i < 20 && store().gameState.dayState.isDayActive; i++) store().simulationTick(0.2);

    let now = store().gameState;
    expect(now.dayState.isDayActive).toBe(false);
    expect(now.dayState.currentDay).toBe(1);
    expect(now.dayState.gameTime).toBe(GAME_CONFIG.economy.dayEndHour);
    expect(now.player.statistics.daysCompleted).toBe(1);
    expect(store().activeModal).toBe('DAY_REPORT');

    // However long the report stays up, nothing moves on by itself.
    store().setActiveModal('NONE');
    for (let i = 0; i < 200; i++) store().simulationTick(0.2);
    now = store().gameState;
    expect(now.dayState.currentDay).toBe(1);
    expect(now.dayState.gameTime).toBe(GAME_CONFIG.economy.dayEndHour);
    expect(now.player.statistics.daysCompleted).toBe(1);

    store().startNextDay();
    const morning = store().gameState;
    expect(morning.dayState.currentDay).toBe(2);
    expect(morning.dayState.isDayActive).toBe(true);
    expect(morning.dayState.gameTime).toBe(GAME_CONFIG.economy.dayStartHour);
    expect(morning.dayState.todayStats.openingCash).toBe(morning.player.cash);
    expect(store().activeModal).toBe('NONE');
  });

  it('settles the books once, however often closing time is asked for', () => {
    const state = store().gameState;
    state.station.managerId = 'manager_1';
    useGameStore.setState({ gameState: { ...state } });

    store().endDayAndShowReport();
    const settled = store().gameState;
    expect(settled.dayState.todayStats.wages).toBeGreaterThanOrEqual(GAME_CONFIG.employees.manager.dailyWage);

    store().setActiveModal('NONE');
    store().endDayAndShowReport();
    const again = store().gameState;
    expect(again.player.cash).toBe(settled.player.cash);
    expect(again.player.statistics.daysCompleted).toBe(1);
    expect(again.player.statistics.recentNetProfits).toEqual(settled.player.statistics.recentNetProfits);
    // All a second call does is put the report back up.
    expect(store().activeModal).toBe('DAY_REPORT');
  });

  it('has no next morning to start while the day is still running', () => {
    store().startNextDay();
    expect(store().gameState.dayState.currentDay).toBe(1);
    expect(store().gameState.dayState.isDayActive).toBe(true);
  });

  it('reports the same net the books record for the day', () => {
    const state = store().gameState;
    Object.assign(state.dayState.todayStats, {
      fuelRevenue: 5200,
      fuelCost: 3900.4,
      marketRevenue: 800,
      marketCost: 400,
      tips: 120,
      repairs: 250,
      energyCost: 60.4
    });
    useGameStore.setState({ gameState: { ...state } });

    store().endDayAndShowReport();
    const closed = store().gameState;
    const t = closed.dayState.todayStats;
    const report = dayReport(closed);

    expect(Math.round(report.net)).toBe(closed.player.statistics.recentNetProfits?.at(-1));
    expect(report.income.total).toBe(5200 + 800 + 120);
    // The grid's bill is named apart from the rest of the upkeep, and counted once.
    expect(report.expenses.energy).toBe(60);
    expect(report.expenses.upkeep + report.expenses.energy).toBe(t.upkeep);
    expect(report.expenses.total).toBeCloseTo(3900.4 + 400 + 250 + t.wages + t.upkeep + t.loanPayments, 6);
  });

  it('brings a save that stopped at the report back to the report, not the next morning', () => {
    store().endDayAndShowReport();
    const saved = JSON.parse(JSON.stringify(store().gameState)) as GameState;

    const revived = reviveLoadedSave(saved);
    expect(revived.modal).toBe('DAY_REPORT');
    expect(revived.state.dayState.isDayActive).toBe(false);
    expect(revived.state.dayState.currentDay).toBe(1);
  });
});

describe("the day's cars", () => {
  it('books a driver by the first reason they leave with', () => {
    const state = createInitialGameState();
    const car = customerAtPump(state);
    const effects = createEffects();
    expect(beginFueling(state, car, 'LITERS', 20, 'PLAYER', effects)).toBe(true);
    for (let i = 0; i < 200 && car.state === 'FUELING'; i++) dispenseStep(state, car, 0.5, effects);
    finalizeSale(state, car, effects);

    const served = car.departureReason!;
    expect(served.startsWith('SERVED_')).toBe(true);
    expect(state.dayState.todayStats.departures).toEqual({ [served]: 1 });

    // Turned out by the closed sign on the way out, they were still served.
    dismissVehicle(state, car, 'CLOSED');
    expect(car.departureReason).toBe('CLOSED');
    expect(state.dayState.todayStats.departures).toEqual({ [served]: 1 });

    const report = dayReport(state);
    expect(report.served).toBe(1);
    expect(report.lost).toBe(0);
    expect(report.stillHere).toBe(0);
  });

  it('accounts for every car that came: served, lost, or still on the plot', () => {
    seedRandom(20260913);
    const start = store().gameState;
    start.player.level = 12;
    start.player.cash = 200_000;
    useGameStore.setState({ gameState: { ...start } });
    expect(store().hirePumpAttendant('pump_1')).toBe(true);
    const state = JSON.parse(JSON.stringify(store().gameState)) as GameState;

    const tick = 0.05;
    const hour = Math.round(GAME_CONFIG.economy.realSecondsPerGameHour / tick);
    const effects = createEffects();
    // Twelve hours of trade, with the doors shut for one of them.
    for (let i = 0; i < 12 * hour; i++) {
      if (i === 6 * hour) {
        state.station.open = false;
        closeForecourt(state);
      }
      if (i === 7 * hour) state.station.open = true;
      runSimulationTick(state, tick, effects);
    }

    const report = dayReport(state);
    expect(report.arrivals).toBeGreaterThan(10);
    expect(report.served).toBeGreaterThan(0);
    expect(report.lostBy.some((entry) => entry.why === 'CLOSED')).toBe(true);
    expect(report.served + report.visited + report.lost + report.stillHere).toBe(report.arrivals);
  });
});
