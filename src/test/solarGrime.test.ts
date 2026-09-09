import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, BuildingEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import {
  createEffects,
  runSimulationTick,
  solarKwhPerHourNow,
  washSolarPanels,
  drivewaySideAt
} from '../domain/services/simulationEngine';
import { solarCleanCost } from '../domain/services/energy';
import { useGameStore } from '../store/gameStore';

/**
 * Emre, 2026-09-08: the glass has its own grime. Dust takes a roof of
 * panels down on its own clock, rain rinses it, a wash from the office or
 * the manager's rounds brings it back to full, and a dirty roof makes less.
 */

function building(id: string, type: string, position: [number, number], extra: Partial<BuildingEntity> = {}): BuildingEntity {
  return {
    id, type, level: 1, position, rotation: 0, size: GAME_CONFIG.buildings[type].size,
    health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0, ...extra
  };
}

/** A closed station at noon with one roof of panels and somewhere to put the kWh. */
function roofed(weather: GameState['dayState']['weather'] = 'SUNNY'): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.dayState.gameTime = 13;
  state.dayState.weather = weather;
  state.station.open = false;
  state.player.cash = 100000;
  const pump = state.pumps.pump_1;
  pump.hasCanopy = true;
  pump.hasSolarCanopy = true;
  const side = drivewaySideAt(pump.position[1]);
  const z = side === 'near' ? 12.5 : -20;
  state.buildings.bank = building('bank', 'ev_storage', [9.5, z], { level: 2, energyKwh: 0 });
  return state;
}

function advance(state: GameState, seconds: number): void {
  const effects = createEffects();
  for (let i = 0; i < Math.round(seconds / 0.1); i++) runSimulationTick(state, 0.1, effects);
}

describe('solar grime', () => {
  it('dulls the glass a little every second, and rain rinses it', () => {
    const dry = roofed('SUNNY');
    advance(dry, 100);
    expect(dry.pumps.pump_1.solarCleanliness).toBeCloseTo(100 - 100 * GAME_CONFIG.ev.solar.grimePerSecond, 1);

    const wet = roofed('RAIN');
    wet.pumps.pump_1.solarCleanliness = 50;
    advance(wet, 100);
    const perSecond = GAME_CONFIG.ev.solar.rainWashPerSecond - GAME_CONFIG.ev.solar.grimePerSecond;
    expect(wet.pumps.pump_1.solarCleanliness).toBeCloseTo(50 + 100 * perSecond, 1);
    // Never past clean.
    wet.pumps.pump_1.solarCleanliness = 99.5;
    advance(wet, 20);
    expect(wet.pumps.pump_1.solarCleanliness).toBe(100);
  });

  it('makes half as much from a filthy roof as from a clean one', () => {
    const state = roofed();
    const clean = solarKwhPerHourNow(state, 'near');
    expect(clean).toBeGreaterThan(0);
    state.pumps.pump_1.solarCleanliness = 0;
    expect(solarKwhPerHourNow(state, 'near')).toBeCloseTo(clean * GAME_CONFIG.ev.solar.minGrimeFactor, 5);
    // The forecourt's own grime no longer touches the roof.
    state.pumps.pump_1.solarCleanliness = 100;
    state.station.cleanliness = 0;
    expect(solarKwhPerHourNow(state, 'near')).toBeCloseTo(clean, 5);
  });

  it('is washed for the price of the roof, back to full', () => {
    const state = roofed();
    state.pumps.pump_1.solarCleanliness = 20;
    const cash = state.player.cash;
    const cost = solarCleanCost(GAME_CONFIG.buildings.canopy.size);
    expect(cost).toBe(600);
    expect(washSolarPanels(state, state.pumps.pump_1, 'test')).toBe(cost);
    expect(state.pumps.pump_1.solarCleanliness).toBe(100);
    expect(state.player.cash).toBe(cash - cost);
    // A roof with no panels has nothing to wash.
    state.pumps.pump_1.hasSolarCanopy = false;
    expect(washSolarPanels(state, state.pumps.pump_1, 'test')).toBeNull();
  });

  it('is washed on the second-grade manager\'s rounds once it drops below half', () => {
    const junior = roofed();
    junior.station.managerId = 'mgr';
    junior.station.managerLevel = 1;
    junior.pumps.pump_1.solarCleanliness = 30;
    advance(junior, 2);
    expect(junior.pumps.pump_1.solarCleanliness).toBeLessThan(31);

    const senior = roofed();
    senior.station.managerId = 'mgr';
    senior.station.managerLevel = 2;
    senior.pumps.pump_1.solarCleanliness = 30;
    const cash = senior.player.cash;
    advance(senior, 2);
    expect(senior.pumps.pump_1.solarCleanliness).toBeGreaterThan(99);
    expect(senior.player.cash).toBeLessThan(cash);
    expect(senior.managerLogs.some((l) => l.reason.includes('paneller'))).toBe(true);
  });
});

describe('the office wash button', () => {
  beforeEach(() => {
    (globalThis as any).window = {};
    (globalThis as any).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    const state = roofed();
    state.pumps.pump_1.solarCleanliness = 10;
    useGameStore.setState({ gameState: state });
  });

  it('washes one roof and refuses a roof without panels', () => {
    expect(useGameStore.getState().cleanSolarPanels('pump_1')).toBe(true);
    expect(useGameStore.getState().gameState.pumps.pump_1.solarCleanliness).toBe(100);
    const bare = useGameStore.getState().gameState;
    bare.pumps.pump_1.hasSolarCanopy = false;
    useGameStore.setState({ gameState: { ...bare } });
    expect(useGameStore.getState().cleanSolarPanels('pump_1')).toBe(false);
  });
});
