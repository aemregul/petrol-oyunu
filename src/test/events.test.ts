import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, BuildingEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import { GAME_EVENTS } from '../config/eventConfig';
import {
  createEffects,
  runSimulationTick,
  triggerEvent,
  energyAvailable,
  eventEffectSummary,
  hourOfDay
} from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-09: "bu olayların çoğunu hiç görmedim". The in-day roll
 * fired about once every two and a half days and only Yoğun Trafik was
 * open at level one, so the catalogue was mostly a list. Now the road
 * throws one or two a day, paced, and each one does what its card says.
 */

let seed = 3;
let restore: (() => void) | null = null;
beforeEach(() => {
  seed = 3;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  });
  restore = () => spy.mockRestore();
});
afterEach(() => restore?.());

/** Runs one day and returns the in-day events it threw, with their hours. */
function runDay(state: GameState): Array<{ id: string; hour: number }> {
  const effects = createEffects();
  const seen: Array<{ id: string; hour: number }> = [];
  let count = state.todayEventIds.length;
  for (let i = 0; i < 200000 && !effects.dayEnded; i++) {
    runSimulationTick(state, 0.1, effects);
    if (state.todayEventIds.length > count) {
      seen.push({ id: state.todayEventIds[state.todayEventIds.length - 1], hour: state.dayState.gameTime });
      count = state.todayEventIds.length;
    }
  }
  return seen;
}

function newDay(state: GameState): void {
  state.dayState.gameTime = GAME_CONFIG.economy.dayStartHour;
  state.dayState.isDayEnding = false;
  state.dayState.isDayActive = true;
  state.todayEventIds = [];
  state.activeEvents = [];
  state.dayState.eventsToday = 0;
  state.dayState.lastEventAtHour = undefined;
}

describe('the road\'s events', () => {
  it('throws one to three a day, spaced out, and shows most of the catalogue within a week', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.station.open = false;
    state.player.level = 6;

    const all: string[] = [];
    for (let day = 0; day < 7; day++) {
      newDay(state);
      const seen = runDay(state);
      expect(seen.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < seen.length; i++) expect(seen[i].hour - seen[i - 1].hour).toBeGreaterThanOrEqual(1.5);
      for (const s of seen) all.push(s.id);
    }
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all.length).toBeLessThanOrEqual(21);
    expect(new Set(all).size).toBeGreaterThanOrEqual(5);
  });

  it('opens the catalogue early enough to be seen', () => {
    const byLevel = (lvl: number) => GAME_EVENTS.filter((e) => !e.daily && e.minLevel <= lvl).length;
    expect(byLevel(2)).toBeGreaterThanOrEqual(6);
    expect(byLevel(5)).toBe(GAME_EVENTS.filter((e) => !e.daily).length);
    // Trouble outweighs luck a little: this is the harder game.
    const weight = (cat: string) => GAME_EVENTS.filter((e) => !e.daily && e.category === cat).reduce((s, e) => s + e.weight, 0);
    expect(weight('INCIDENT')).toBeGreaterThan(weight('OPPORTUNITY'));
  });

  it('says on the card what it does', () => {
    expect(eventEffectSummary({ trafficMultiplier: 1.9 })).toBe('trafik +90%');
    expect(eventEffectSummary({ trafficMultiplier: 0.5 })).toBe('trafik -50%');
    expect(eventEffectSummary({ wholesalePriceModifier: -0.06 })).toBe('alış -6%');
    expect(eventEffectSummary({ tipMultiplier: 3, trafficMultiplier: 1.2 })).toBe('trafik +20% · bahşiş ×3');
    expect(
      eventEffectSummary({ tipMultiplier: 3, trafficMultiplier: 1.2, archetypeWeightMultiplier: { luxury: 6 } })
    ).toBe('trafik +20% · bahşiş ×3 · lüks / spor ×6');
    expect(eventEffectSummary({ pumpsDisabled: true })).toBe('pompalar ve şarj kapalı');
    expect(eventEffectSummary({ cashDelta: 6000, trafficMultiplier: 1.35 })).toBe('trafik +35% · +₺6.000');
  });

  /**
   * Emre, 2026-09-09: "VIP konvoyu geldiğinde trafikte bir akış görmüyorum".
   * The event was three-times tips and a +20% the road swallowed whole; no
   * car on it looked any different. Now the luxury share of who drives past
   * — and who turns in — climbs while the convoy is in town.
   */
  it('fills the road with luxury cars while the VIP convoy is in town', () => {
    const spawnShare = (withConvoy: boolean): { luxury: number; total: number } => {
      seed = 3;
      const state = createInitialGameState();
      state.dayState.timeSpeed = 1;
      state.station.open = false;
      state.player.level = 1;
      // Nothing else may fire and muddy the mix.
      state.dayState.eventsToday = 99;
      if (withConvoy) {
        triggerEvent(state, GAME_EVENTS.find((e) => e.id === 'vip_convoy')!, createEffects());
      }
      const effects = createEffects();
      const seen = new Set<string>();
      let luxury = 0;
      for (let i = 0; i < 20000; i++) {
        state.dayState.gameTime = 12;
        for (const e of state.activeEvents) e.remainingHours = 2;
        runSimulationTick(state, 0.1, effects);
        for (const v of Object.values(state.vehicles)) {
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          if (v.archetype === 'luxury') luxury++;
        }
      }
      return { luxury, total: seen.size };
    };

    const quiet = spawnShare(false);
    const convoy = spawnShare(true);
    expect(quiet.total).toBeGreaterThan(200);
    expect(convoy.total).toBeGreaterThan(200);
    // One in sixteen on an ordinary day; about one in three with the convoy.
    expect(quiet.luxury / quiet.total).toBeLessThan(0.12);
    expect(convoy.luxury / convoy.total).toBeGreaterThan(0.24);
    expect(convoy.luxury / convoy.total).toBeLessThan(0.36);
  });

  it('cuts the grid and the charging posts during an outage, not only the pumps', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.dayState.gameTime = 10;
    state.station.open = false;
    state.player.level = 12;
    const bld = (id: string, type: string, position: [number, number], extra: Partial<BuildingEntity> = {}): BuildingEntity => ({
      id, type, level: 1, position, rotation: 0, size: GAME_CONFIG.buildings[type].size,
      health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0, ...extra
    });
    state.buildings.sub = bld('sub', 'ev_substation', [13, 12]);
    state.buildings.bank = bld('bank', 'ev_storage', [9.5, 12.5], { energyKwh: 50 });

    const outage = GAME_EVENTS.find((e) => e.id === 'power_outage')!;
    triggerEvent(state, outage, createEffects());
    const before = energyAvailable(state, 'near');
    const effects = createEffects();
    for (let i = 0; i < 50; i++) runSimulationTick(state, 0.1, effects);
    // Nothing came down the wire while the lights were out...
    expect(energyAvailable(state, 'near')).toBeCloseTo(before, 3);
    expect(hourOfDay(state.dayState.gameTime)).toBeLessThan(11);

    // ...and once they are back, the bank fills again.
    state.activeEvents = [];
    for (let i = 0; i < 50; i++) runSimulationTick(state, 0.1, effects);
    expect(energyAvailable(state, 'near')).toBeGreaterThan(before);
  });
});
