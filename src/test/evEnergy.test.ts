import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity, BuildingEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import {
  createEffects,
  runSimulationTick,
  chargingPoints,
  energyAvailable,
  energyCapacity,
  beginCharging
} from '../domain/services/simulationEngine';
import { evaluatePlacement } from '../domain/services/placement';
import { useGameStore } from '../store/gameStore';

/**
 * Emre, 2026-09-07: the electric line is built in order — substation, then
 * battery bank, then posts. The bank is the electric fuel tank: it comes
 * full (200 kWh), grows with its level, chargers draw from it, and the grid
 * trickles it back at a price. A post is served like a pump: by the hand on
 * it, or by the player, never by itself.
 */

let restore: (() => void) | null = null;
beforeEach(() => {
  let value = 7;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  });
  restore = () => spy.mockRestore();
});
afterEach(() => restore?.());

function building(
  id: string,
  type: string,
  position: [number, number],
  extra: Partial<BuildingEntity> = {}
): BuildingEntity {
  return {
    id,
    type,
    level: 1,
    position,
    rotation: 0,
    size: GAME_CONFIG.buildings[type].size,
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0,
    ...extra
  };
}

/** The starting plot with the whole electric line stood up. */
function electric(bankKwh = 200): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.level = 12;
  state.station.open = false;
  state.buildings.sub = building('sub', 'ev_substation', [13, 12]);
  state.buildings.bank = building('bank', 'ev_storage', [9.5, 12.5], { energyKwh: bankKwh });
  state.buildings.dc = building('dc', 'ev_charger_dc', [13, 8]);
  return state;
}

/** An electric customer already plugged in at the post. */
function evAtPost(state: GameState, kwh = 40): VehicleEntity {
  const car: VehicleEntity = {
    id: 'ev',
    archetype: 'ev',
    modelVariant: 'kenney-sedan',
    fuelType: 'gasoline',
    tankCapacity: 60,
    currentFuel: 20,
    request: {
      mode: 'FULL', targetValue: kwh, calculatedLiters: kwh, calculatedPrice: 0,
      dispensedLiters: 0, isFinished: false
    },
    patience: 60,
    maxPatience: 60,
    satisfaction: 100,
    state: 'AT_PUMP',
    targetPumpId: null,
    assignedActor: null,
    worldPosition: [14.4, 0, 8],
    targetWaypoint: null,
    route: [],
    heading: 0,
    speed: 1,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false,
    chargingBuildingId: 'dc',
    chargeSecondsLeft: GAME_CONFIG.ev.dcChargeSeconds
  };
  state.vehicles.ev = car;
  return car;
}

function advance(state: GameState, seconds: number): void {
  const effects = createEffects();
  for (let i = 0; i < Math.round(seconds / 0.05); i++) runSimulationTick(state, 0.05, effects);
}

describe('the electric line', () => {
  it('is built in order: substation, bank, post', () => {
    const state = createInitialGameState();
    state.player.level = 12;
    const spot: [number, number] = [9.5, 12.5];
    expect(evaluatePlacement(state, 'ev_storage', spot, 0).reason).toMatch(/Elektrik Altyapısı/);
    expect(evaluatePlacement(state, 'ev_charger_ac', [13, 8], 0).reason).toMatch(/Enerji Depolama/);

    state.buildings.sub = building('sub', 'ev_substation', [13, 12]);
    expect(evaluatePlacement(state, 'ev_storage', spot, 0).valid).toBe(true);
    expect(evaluatePlacement(state, 'ev_charger_ac', [13, 8], 0).reason).toMatch(/Enerji Depolama/);

    state.buildings.bank = building('bank', 'ev_storage', spot);
    expect(evaluatePlacement(state, 'ev_charger_ac', [13, 8], 0).valid).toBe(true);
  });

  it('holds 200 kWh at first and more at each level', () => {
    expect(energyCapacity({ level: 1 })).toBe(200);
    expect(energyCapacity({ level: 2 })).toBe(400);
    expect(energyCapacity({ level: 3 })).toBe(800);
  });

  it('gives a new bank its full charge from the yard', () => {
    (globalThis as any).window = {};
    (globalThis as any).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    const state = createInitialGameState();
    state.player.level = 12;
    state.player.cash = 500000;
    state.buildings.sub = building('sub', 'ev_substation', [13, 12]);
    useGameStore.setState({ gameState: state });
    useGameStore.getState().enterBuildMode('ev_storage');
    useGameStore.getState().pinBuildPreviewAt([9.5, 12.5]);
    expect(useGameStore.getState().confirmBuildPlacement()).toBe(true);
    const bank = Object.values(useGameStore.getState().gameState.buildings).find((b) => b.type === 'ev_storage')!;
    expect(bank.energyKwh).toBe(200);
  });

  it('keeps a post dark until a bank stands behind it', () => {
    const state = electric();
    expect(chargingPoints(state, 'near')).toHaveLength(1);
    delete state.buildings.bank;
    expect(chargingPoints(state, 'near')).toHaveLength(0);
  });

  it('waits for a hand to start the charge, then draws the kWh out of the bank', () => {
    // Half full, so the grid's top-up shows in the arithmetic instead of
    // vanishing against the brim.
    const state = electric(100);
    const car = evAtPost(state, 40);
    const perSecond = GAME_CONFIG.ev.gridKwhPerHour / GAME_CONFIG.economy.realSecondsPerGameHour;

    // Plugged in and waiting: nothing is drawn, patience runs.
    advance(state, 2);
    expect(car.state).toBe('AT_PUMP');
    expect(energyAvailable(state, 'near')).toBeCloseTo(100 + perSecond * 2, 1);
    expect(car.patience).toBeLessThan(60);

    // The player starts it.
    const before = energyAvailable(state, 'near');
    expect(beginCharging(state, car, 'PLAYER')).toBe(true);
    expect(car.state).toBe('FUELING');
    const half = GAME_CONFIG.ev.dcChargeSeconds / 2;
    advance(state, half);
    // Half the charge in: half the battery's kWh out of the bank, less what
    // the grid put back meanwhile.
    expect(energyAvailable(state, 'near')).toBeCloseTo(before - 20 + perSecond * half, 0);

    const cash = state.player.cash;
    // The tariff is the player's, set from the office (Emre, 2026-09-08),
    // not the catalogue's.
    state.evPricing = { ac: GAME_CONFIG.ev.acPricePerKwh, dc: 20 };
    advance(state, GAME_CONFIG.ev.dcChargeSeconds / 2 + 0.5);
    // Charged, paid for 40 kWh at the board's price, and on its way.
    expect(['OPTIONAL_SHOP', 'TO_PARK', 'EXIT', 'DESPAWN']).toContain(car.state);
    expect(state.player.cash).toBeGreaterThanOrEqual(cash + Math.round(40 * 20));
  });

  it('lets an attendant on the post start it', () => {
    const state = electric(200);
    state.employees.emp = {
      id: 'emp', name: 'A', role: 'PUMP_ATTENDANT', level: 3, wage: 1000, assignedPumpId: 'dc',
      state: 'IDLE', serviceCount: 0, currentVehicleId: null, actionTimerSeconds: 0, worldPosition: [0, 0, 0]
    };
    const car = evAtPost(state, 40);
    advance(state, 3);
    expect(car.state).toBe('FUELING');
    expect(car.assignedActor).toBe('EMPLOYEE');
    // The attendant keeps the post: the orphan sweep must not unassign them.
    expect(state.employees.emp.assignedPumpId).toBe('dc');
    advance(state, GAME_CONFIG.ev.dcChargeSeconds + 1);
    expect(['OPTIONAL_SHOP', 'TO_PARK', 'EXIT', 'DESPAWN']).toContain(car.state);
    expect(state.employees.emp.serviceCount).toBe(1);
  });

  it('turns an electric customer away from an empty bank, and says why', () => {
    const state = electric(0);
    // A dead grid for the test's sake, so the bank stays empty.
    const grid = GAME_CONFIG.ev.gridKwhPerHour;
    GAME_CONFIG.ev.gridKwhPerHour = 0;
    try {
      const car = evAtPost(state, 40);
      const effects = createEffects();
      for (let i = 0; i < 20; i++) runSimulationTick(state, 0.05, effects);
      expect(['EXIT', 'DESPAWN']).toContain(car.state);
      expect(effects.notifications.some((n) => n.message.includes('Batarya boş'))).toBe(true);
    } finally {
      GAME_CONFIG.ev.gridKwhPerHour = grid;
    }
  });

  it('tops the bank up from the grid and puts the bill in the books', () => {
    const state = electric(100);
    advance(state, 10); // one game hour
    expect(energyAvailable(state, 'near')).toBeCloseTo(100 + GAME_CONFIG.ev.gridKwhPerHour, 1);
    expect(state.dayState.todayStats.energyCost).toBeCloseTo(GAME_CONFIG.ev.gridKwhPerHour * GAME_CONFIG.ev.gridPricePerKwh, 1);
    // Never past the brim.
    advance(state, 60);
    expect(energyAvailable(state, 'near')).toBe(200);
  });
});
