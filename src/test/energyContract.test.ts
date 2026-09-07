import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, BuildingEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import {
  createEffects,
  runSimulationTick,
  energyAvailable,
  drivewaySideAt,
  generatorRunning
} from '../domain/services/simulationEngine';
import { gridPriceAt, gridKwhPerHourFor, solarFactor } from '../domain/services/energy';
import { useGameStore } from '../store/gameStore';

/**
 * Emre, 2026-09-07: energy is worked like fuel. The grid is a contract on
 * the substation — bigger at each level, cheap at night, dear at the peak,
 * and the manager can be told to wait for the cheap window. Panels sit on
 * roofs the station already has. The generator burns the station's own
 * diesel, and never the reserve.
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

function building(id: string, type: string, position: [number, number], extra: Partial<BuildingEntity> = {}): BuildingEntity {
  return {
    id, type, level: 1, position, rotation: 0, size: GAME_CONFIG.buildings[type].size,
    health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0, ...extra
  };
}

/** The starting plot with a Sv.2 bank (400 kWh) at `bankKwh`, fed or not. */
function plot(bankKwh: number, withSubstation = true, hour = 10): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.dayState.gameTime = hour;
  state.dayState.weather = 'SUNNY';
  state.station.cleanliness = 100;
  state.player.level = 12;
  state.station.open = false;
  if (withSubstation) state.buildings.sub = building('sub', 'ev_substation', [13, 12]);
  state.buildings.bank = building('bank', 'ev_storage', [9.5, 12.5], { level: 2, energyKwh: bankKwh });
  return state;
}

function advance(state: GameState, seconds: number): void {
  const effects = createEffects();
  for (let i = 0; i < Math.round(seconds / 0.05); i++) runSimulationTick(state, 0.05, effects);
}

const HOUR = GAME_CONFIG.economy.realSecondsPerGameHour;
const side = drivewaySideAt(12.5);

describe('the grid contract', () => {
  it('prices the hour: cheap at night, dear at the peak, plain by day', () => {
    expect(gridPriceAt(23)).toBe(2.4);
    expect(gridPriceAt(3)).toBe(2.4);
    expect(gridPriceAt(6)).toBe(4.5);
    expect(gridPriceAt(12)).toBe(4.5);
    expect(gridPriceAt(18)).toBe(7.5);
    expect(gridPriceAt(21)).toBe(4.5);
  });

  it('grows with the substation level', () => {
    expect(gridKwhPerHourFor(1)).toBe(60);
    expect(gridKwhPerHourFor(2)).toBe(120);
    expect(gridKwhPerHourFor(3)).toBe(240);
  });

  it('pulls the level\'s kWh in an hour and bills the hour\'s price', () => {
    const state = plot(100);
    state.buildings.sub.level = 2;
    advance(state, HOUR);
    expect(energyAvailable(state, side)).toBeCloseTo(220, 0);
    expect(state.dayState.todayStats.energyCost).toBeCloseTo(120 * 4.5, 0);
  });

  it('bills the night price after ten', () => {
    const state = plot(100, true, 23);
    advance(state, HOUR);
    expect(state.dayState.todayStats.energyCost).toBeCloseTo(60 * 2.4, 0);
  });

  it('waits for the cheap window when the manager is told to, unless the bank is low', () => {
    const noon = plot(200);
    noon.station.managerId = 'mgr';
    noon.managerSettings.nightGridFill = true;
    advance(noon, HOUR);
    expect(energyAvailable(noon, side)).toBe(200);
    expect(noon.dayState.todayStats.energyCost ?? 0).toBe(0);

    const low = plot(40);
    low.station.managerId = 'mgr';
    low.managerSettings.nightGridFill = true;
    advance(low, HOUR);
    expect(energyAvailable(low, side)).toBeGreaterThan(40);

    const night = plot(200, true, 23);
    night.station.managerId = 'mgr';
    night.managerSettings.nightGridFill = true;
    advance(night, HOUR);
    expect(energyAvailable(night, side)).toBeCloseTo(260, 0);
  });
});

describe('roof panels', () => {
  it('follow the sun, the sky and the grime', () => {
    expect(solarFactor(13, 'SUNNY', 100)).toBeCloseTo(1, 5);
    expect(solarFactor(13, 'RAIN', 100)).toBeCloseTo(0.2, 5);
    expect(solarFactor(13, 'SUNNY', 0)).toBeCloseTo(0.5, 5);
    expect(solarFactor(0, 'SUNNY', 100)).toBe(0);
    expect(solarFactor(6, 'SUNNY', 100)).toBe(0);
  });

  it('put a canopy\'s kWh into the bank', () => {
    // No substation, so what arrives is the sun's alone.
    const state = plot(100, false, 13);
    // Noon is the arc's top; over the hour after it the arc falls a little.
    const pump = Object.values(state.pumps).find((p) => drivewaySideAt(p.position[1]) === side)!;
    pump.hasCanopy = true;
    pump.hasSolarCanopy = true;
    const before = energyAvailable(state, side);
    advance(state, HOUR);
    const made = energyAvailable(state, side) - before;
    // 15 cells × 0.8 = 12 kWh at the top of the arc; a shade under over
    // the hour that follows.
    expect(made).toBeGreaterThan(11.2);
    expect(made).toBeLessThanOrEqual(12);
    expect(state.dayState.todayStats.solarKwh).toBeCloseTo(made, 1);
    expect(state.dayState.todayStats.energyCost ?? 0).toBe(0);
  });

  it('make nothing at midnight', () => {
    const state = plot(100, false, 0);
    const pump = Object.values(state.pumps).find((p) => drivewaySideAt(p.position[1]) === side)!;
    pump.hasCanopy = true;
    pump.hasSolarCanopy = true;
    advance(state, HOUR);
    expect(energyAvailable(state, side)).toBe(100);
  });
});

describe('the diesel generator', () => {
  it('burns the tank\'s diesel into the bank when it is low, at what the diesel cost', () => {
    const state = plot(40, false);
    state.buildings.gen = building('gen', 'diesel_generator', [13, 8]);
    state.tanks.diesel.stock = 1000;
    state.tanks.diesel.reservedStock = 0;
    state.tanks.diesel.averageCost = 30;
    expect(generatorRunning(state, state.buildings.gen)).toBe(true);
    advance(state, HOUR);
    expect(energyAvailable(state, side)).toBeCloseTo(120, 0);
    expect(state.tanks.diesel.stock).toBeCloseTo(976, 0);
    expect(state.dayState.todayStats.generatorLiters).toBeCloseTo(24, 0);
    expect(state.dayState.todayStats.energyCost).toBeCloseTo(24 * 30, 0);
  });

  it('stays quiet when the bank is above the line, when switched off, and at the reserve', () => {
    const fullEnough = plot(300, false);
    fullEnough.buildings.gen = building('gen', 'diesel_generator', [13, 8]);
    fullEnough.tanks.diesel.stock = 1000;
    expect(generatorRunning(fullEnough, fullEnough.buildings.gen)).toBe(false);

    const off = plot(40, false);
    off.buildings.gen = building('gen', 'diesel_generator', [13, 8], { generatorOff: true });
    off.tanks.diesel.stock = 1000;
    expect(generatorRunning(off, off.buildings.gen)).toBe(false);

    const dry = plot(40, false);
    dry.buildings.gen = building('gen', 'diesel_generator', [13, 8]);
    dry.tanks.diesel.stock = dry.tanks.diesel.capacity * 0.15;
    dry.tanks.diesel.reservedStock = 0;
    expect(generatorRunning(dry, dry.buildings.gen)).toBe(false);
    advance(dry, HOUR);
    expect(dry.tanks.diesel.stock).toBeCloseTo(dry.tanks.diesel.capacity * 0.15, 3);
  });
});

describe('buying panels', () => {
  beforeEach(() => {
    (globalThis as any).window = {};
    (globalThis as any).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  });

  it('needs a roof, a bank on the block and the money; then the panels are there', () => {
    const state = plot(100);
    state.player.cash = 100000;
    const pump = Object.values(state.pumps).find((p) => drivewaySideAt(p.position[1]) === side)!;
    useGameStore.setState({ gameState: state });

    // No canopy yet: nothing to bolt the panels to.
    expect(useGameStore.getState().fitSolarCanopy(pump.id)).toBe(false);
    useGameStore.getState().fitCanopy(pump.id);
    const afterRoof = useGameStore.getState().gameState.player.cash;
    expect(useGameStore.getState().fitSolarCanopy(pump.id)).toBe(true);
    expect(useGameStore.getState().gameState.pumps[pump.id].hasSolarCanopy).toBe(true);
    expect(useGameStore.getState().gameState.player.cash).toBe(afterRoof - 15 * 600);
  });

  it('refuses panels on a block with no bank', () => {
    const state = plot(100);
    delete state.buildings.bank;
    state.player.cash = 100000;
    const pump = Object.values(state.pumps).find((p) => drivewaySideAt(p.position[1]) === side)!;
    pump.hasCanopy = true;
    useGameStore.setState({ gameState: state });
    expect(useGameStore.getState().fitSolarCanopy(pump.id)).toBe(false);
  });
});
