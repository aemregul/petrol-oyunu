import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick, stopChance, nightLighting } from '../domain/services/simulationEngine';
import { unitPrice } from '../domain/services/catalogRules';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState } from '../domain/types/gameState';

/**
 * The economy, pinned (Emre, 2026-09-08: "4 derece zorluk"). Before this
 * tuning a pump paid for itself in four game days — sixteen real minutes —
 * because the station kept nineteen percent of every litre. Now the pump
 * prices are İstanbul's real ones with a station margin of about eight
 * percent, structures cost 2.2× and climb with every unit, and wages are
 * up. The figures below are what that is meant to feel like; move them
 * only on purpose.
 */

// A deterministic road, so the day's takings are the same every run. An LCG
// rather than a constant: transaction ids are the clock plus a random, and
// a pinned constant made two sales in one millisecond collide.
let seed = 11;
let restore: (() => void) | null = null;
beforeEach(() => {
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  });
  restore = () => spy.mockRestore();
});
afterEach(() => restore?.());

function attendant(state: GameState, id: string, pumpId: string): void {
  const tier = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];
  state.employees[id] = {
    id, name: id, role: 'PUMP_ATTENDANT', level: 1, wage: tier.dailyWage, assignedPumpId: pumpId,
    state: 'IDLE', serviceCount: 0, currentVehicleId: null, actionTimerSeconds: 0, worldPosition: [0, 0, 0]
  } as never;
}

function runDay(state: GameState): void {
  const effects = createEffects();
  for (let i = 0; i < 200000 && !effects.dayEnded; i++) runSimulationTick(state, 0.1, effects);
}

/** What the day actually made: sales less the fuel they took, tips, wages and keep. */
function dayNet(state: GameState): number {
  const t = state.dayState.todayStats;
  const wages = Object.values(state.employees).reduce((s, e) => s + e.wage, 0);
  const upkeep =
    Object.keys(state.pumps).length * GAME_CONFIG.buildings.pump_standard.dailyUpkeep +
    Object.values(state.buildings).reduce((s, b) => s + (GAME_CONFIG.buildings[b.type]?.dailyUpkeep ?? 0), 0);
  return t.fuelRevenue - t.fuelCost + t.tips - wages - upkeep;
}

describe('the price list', () => {
  it('sells fuel at the real İstanbul board and keeps about eight percent of it', () => {
    const f = GAME_CONFIG.fuels;
    expect(f.gasoline.regionalRetail).toBe(76.9);
    expect(f.diesel.regionalRetail).toBe(88.9);
    expect(f.lpg.regionalRetail).toBe(35);
    for (const fuel of [f.gasoline, f.diesel, f.lpg]) {
      expect(fuel.baseWholesale + fuel.targetMargin).toBeCloseTo(fuel.regionalRetail, 2);
      expect(fuel.targetMargin / fuel.regionalRetail).toBeGreaterThan(0.07);
      expect(fuel.targetMargin / fuel.regionalRetail).toBeLessThan(0.09);
    }
  });

  it('prices the yard and the payroll at the harder level', () => {
    expect(GAME_CONFIG.buildings.pump_standard.price).toBe(39500);
    expect(GAME_CONFIG.buildings.mini_market.price).toBe(61500);
    expect(GAME_CONFIG.buildings.rest_complex.price).toBe(330000);
    expect(GAME_CONFIG.buildings.pump_standard.dailyUpkeep).toBe(160);
    expect(GAME_CONFIG.employees.pumpAttendant.tierLevels[0].dailyWage).toBe(900);
    expect(GAME_CONFIG.employees.pumpAttendant.tierLevels[0].hireCost).toBe(12000);
    expect(GAME_CONFIG.employees.manager.hireCost).toBe(90000);
    expect(GAME_CONFIG.employees.manager.tiers.map((t) => t.dailyWage)).toEqual([4000, 5200, 6500]);
    // The free money stays: level rewards are the bait that empties a wallet.
    expect(GAME_CONFIG.levels.find((l) => l.level === 2)?.rewardCash).toBe(1500);
  });
});

describe('a day at the starting station', () => {
  it('clears a few thousand lira and pays a second pump back in about two weeks', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.cash = 300000;
    attendant(state, 'e1', 'pump_1');
    runDay(state);

    const net = dayNet(state);
    const nextPump = unitPrice(state, 'pump_standard');
    expect(state.dayState.todayStats.customersServed).toBeGreaterThan(10);
    expect(net).toBeGreaterThan(1500);
    expect(net).toBeLessThan(6000);
    expect(nextPump).toBe(51400);
    const paybackDays = nextPump / net;
    expect(paybackDays).toBeGreaterThan(8);
    expect(paybackDays).toBeLessThan(35);
  });
});

describe('the forecourt after dark', () => {
  // Level 2 promised "Aydınlatmalı Gece Trafiği"; until now no light pole
  // was ever read by the engine. A dark forecourt now loses forty percent of
  // its night stops, and four poles win them all back.
  it('is passed by unlit and pulled into when lit', () => {
    const dark = createInitialGameState();
    dark.dayState.gameTime = 23;
    expect(nightLighting(dark, 'near')).toBeCloseTo(0.6, 5);
    const unlit = stopChance(dark, 'near');

    const lit = createInitialGameState();
    lit.dayState.gameTime = 23;
    for (let i = 0; i < 4; i++) {
      lit.buildings[`lp${i}`] = {
        id: `lp${i}`, type: 'light_pole', level: 1, position: [3 + i * 2, 8], rotation: 0,
        size: [1, 1], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
      };
    }
    expect(nightLighting(lit, 'near')).toBe(1);
    // Four poles also carry a little appeal, so the lit block draws at least 1/0.6 more.
    expect(stopChance(lit, 'near') / unlit).toBeGreaterThanOrEqual(1 / 0.6 - 1e-9);

    // By day the poles are scenery: the night factor is one for both.
    dark.dayState.gameTime = 12;
    expect(nightLighting(dark, 'near')).toBe(1);
  });
});
