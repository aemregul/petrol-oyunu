import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GAME_CONFIG } from '../config/gameConfig';
import { facilityOnlyShare, stopChance, turnInChance } from '../domain/services/simulationEngine';
import { GameState } from '../domain/types/gameState';

/**
 * Emre, 2026-09-12: "istasyon büyüdükçe müşteri düşüyor". Drivers who come
 * only for a café or a shop were drawn out of the same odds as the fuel
 * customers, so every such building turned fuel custom into visitors: a car
 * park, a café and a shop cut the day's fuel customers by a third. The odds a
 * driver turns in now widen with that share, so the buildings mostly bring
 * their visitors in addition.
 */

function put(state: GameState, id: string, type: string, at: [number, number]): void {
  state.buildings[id] = {
    id, type, level: 1, position: at, rotation: 0, size: GAME_CONFIG.buildings[type].size,
    health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0,
    ...(GAME_CONFIG.facilities[type] ? { till: 0, todayRevenue: 0, todayVisits: 0, tariff: 0 } : {})
  } as GameState['buildings'][string];
}

function station(): GameState {
  const state = createInitialGameState();
  state.player.level = 8;
  return state;
}

describe('drivers who come only for the buildings', () => {
  it("leave a plain forecourt's odds exactly as they were", () => {
    const state = station();
    expect(facilityOnlyShare(state, 'near')).toBe(0);
    expect(turnInChance(state, 'near')).toBe(stopChance(state, 'near'));
  });

  it('come mostly on top of the fuel customers at a station with a park and a café', () => {
    const plain = station();
    const withBuildings = station();
    put(withBuildings, 'park', 'car_park', [10.5, 12.5]);
    put(withBuildings, 'cafe', 'cafe', [8.5, 9.5]);

    const share = facilityOnlyShare(withBuildings, 'near');
    expect(share).toBeGreaterThan(0.1);

    const odds = turnInChance(withBuildings, 'near');
    expect(odds).toBeGreaterThan(stopChance(withBuildings, 'near'));

    // Of everyone who turns in, the fuel customers: nearly what the forecourt
    // brought before a single building stood — they were about 85% of it.
    const fuelCustomers = odds * (1 - share);
    expect(fuelCustomers).toBeGreaterThan(stopChance(plain, 'near') * 0.92);
  });
});
