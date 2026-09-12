import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState } from '../domain/types/gameState';
import { GAME_EVENTS } from '../config/eventConfig';
import {
  createEffects,
  runSimulationTick,
  triggerEvent,
  rollDailyEvent,
  rollFuelDeal,
  isFuelDealOn,
  FUEL_DEAL_NAME,
  FUEL_DEAL_DAY_CHANCE
} from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-12: "Rafineri zammı ile indirimin aynı anda veya tahmin
 * edilebilir sırayla gelmesi" and "yakıt indiriminin neredeyse her gün
 * gelmesi". Over 300 simulated days the one-minute 30% deal opened on every
 * single one, and on 31% of them beside a refinery hike or a currency shock.
 * It now comes on some quiet days only: never on a day the market moved,
 * never two days running.
 */

afterEach(() => vi.restoreAllMocks());

function seeded(start: number): void {
  let seed = start >>> 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  });
}

const event = (id: string) => GAME_EVENTS.find((e) => e.id === id)!;

/** One day of the forecourt, an hour a tick, closed to custom: did the deal open? */
function dealOpensToday(state: GameState): boolean {
  state.station.open = false;
  let opened = false;
  const effects = createEffects();
  for (let i = 0; i < 60 && !effects.dayEnded; i++) {
    runSimulationTick(state, 10, effects);
    if (isFuelDealOn(state)) opened = true;
  }
  return opened;
}

describe('the one-minute fuel deal', () => {
  it('has a different name from the smaller all-day supply discount', () => {
    expect(FUEL_DEAL_NAME).toBe('Tedarikte Dev İndirim');
    expect(event('supply_discount').name).toBe('Tedarik İndirimi');
    expect(FUEL_DEAL_NAME).not.toBe(event('supply_discount').name);
  });

  it('stays shut on a day the market moved, however the dice fall', () => {
    for (const id of ['refinery_hike', 'currency_shock', 'supply_discount']) {
      const state = createInitialGameState();
      state.dayState.timeSpeed = 1;
      state.dayState.currentDay = 4;
      triggerEvent(state, event(id), createEffects());

      vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(rollFuelDeal(state), id).toBeNull();
      vi.restoreAllMocks();

      expect(dealOpensToday(state), id).toBe(false);
    }
  });

  it('does not come two days running', () => {
    const state = createInitialGameState();
    state.dayState.currentDay = 7;
    vi.spyOn(Math, 'random').mockReturnValue(0);

    state.dayState.fuelDealLastDay = 6;
    expect(rollFuelDeal(state)).toBeNull();
    state.dayState.fuelDealLastDay = 5;
    expect(rollFuelDeal(state)).not.toBeNull();
  });

  it('opens on a deal day and marks the day, so tomorrow has none', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.dayState.currentDay = 3;
    state.dayState.fuelDealAtHour = 10;

    expect(dealOpensToday(state)).toBe(true);
    expect(state.dayState.fuelDealLastDay).toBe(3);
  });

  it('over a thousand days: on some quiet days, never beside a market move, never back to back', () => {
    seeded(11);
    const state = createInitialGameState();
    state.player.level = 5;
    let deals = 0;
    let quiet = 0;
    let clash = 0;
    let backToBack = 0;

    for (let day = 2; day <= 1001; day++) {
      state.dayState.currentDay = day;
      state.activeEvents = [];
      state.todayEventIds = [];
      rollDailyEvent(state, createEffects());
      const moved = state.activeEvents.some((e) => (e.effects.wholesalePriceModifier ?? 0) !== 0);
      if (!moved) quiet++;

      const hour = rollFuelDeal(state);
      if (hour === null) continue;
      deals++;
      if (moved) clash++;
      if (state.dayState.fuelDealLastDay === day - 1) backToBack++;
      state.dayState.fuelDealLastDay = day;
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(21);
    }

    expect(clash).toBe(0);
    expect(backToBack).toBe(0);
    // Far from every day, and not so rare it is never seen: about one in four or five.
    expect(deals / 1000).toBeGreaterThan(0.15);
    expect(deals / 1000).toBeLessThan(0.35);
    expect(deals / quiet).toBeLessThanOrEqual(FUEL_DEAL_DAY_CHANCE);
  });
});
