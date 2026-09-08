import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, BuildingEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import { evaluatePlacement } from '../domain/services/placement';
import { buildLimitReason, catalogLimitReason, ownedCount, unitPrice } from '../domain/services/catalogRules';

/**
 * Emre, 2026-09-08: no unlimited buying, and the next one costs more than
 * the last. A shop, a toilet, a restaurant and a café per block; one rest
 * complex, one tyre bay, one oil bay, one car wash on the whole station;
 * five AC posts and ten DC posts wherever they stand. Pumps and posts get
 * dearer with every one bought; decoration more gently.
 */

function building(id: string, type: string, position: [number, number]): BuildingEntity {
  return {
    id, type, level: 1, position, rotation: 0, size: GAME_CONFIG.buildings[type].size,
    health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
  };
}

/** The first spot on the starting plot where the thing may be put down. */
function validSpot(state: GameState, type: string): [number, number] {
  for (let z = 2; z <= 12; z += 0.5) {
    for (let x = 2; x <= 14; x += 0.5) {
      if (evaluatePlacement(state, type, [x, z], 0).valid) return [x, z];
    }
  }
  throw new Error(`no room for ${type}`);
}

describe('build limits', () => {
  it('allows one toilet per block, and says which block is still open', () => {
    const state = createInitialGameState();
    state.player.level = 12;
    const spot = validSpot(state, 'toilet');
    state.buildings.wc = building('wc', 'toilet', spot);

    // The near block is full; the check speaks before the ground is looked at.
    const again = evaluatePlacement(state, 'toilet', spot, 0);
    expect(again.valid).toBe(false);
    expect(again.reason).toContain('karşı arsaya');
    expect(buildLimitReason(state, 'toilet', 'near')).not.toBeNull();
    // The far block is not.
    expect(buildLimitReason(state, 'toilet', 'far')).toBeNull();
    expect(catalogLimitReason(state, 'toilet')).toBeNull();

    // Both full: the catalogue card locks.
    state.buildings.wc2 = building('wc2', 'toilet', [8, -20]);
    expect(catalogLimitReason(state, 'toilet')).toContain('Her iki arsada');
  });

  it('counts the rest complex as the shop, restaurant, café and toilet of its block', () => {
    const state = createInitialGameState();
    state.buildings.rc = building('rc', 'rest_complex', [8, 8]);
    for (const type of ['mini_market', 'restaurant', 'cafe', 'toilet']) {
      expect(ownedCount(state, type, 'near')).toBe(1);
      expect(buildLimitReason(state, type, 'near')).not.toBeNull();
      expect(buildLimitReason(state, type, 'far')).toBeNull();
    }
    // And there is only ever the one complex.
    expect(buildLimitReason(state, 'rest_complex', 'far')).toContain('yalnızca bir');
  });

  it('caps the station at five AC and ten DC posts, whichever block they stand on', () => {
    const state = createInitialGameState();
    for (let i = 0; i < 5; i++) state.buildings[`ac${i}`] = building(`ac${i}`, 'ev_charger_ac', [i * 2, i % 2 ? 8 : -20]);
    expect(buildLimitReason(state, 'ev_charger_ac', 'near')).toContain('en fazla 5');
    expect(buildLimitReason(state, 'ev_charger_ac', 'far')).toContain('en fazla 5');
    for (let i = 0; i < 9; i++) state.buildings[`dc${i}`] = building(`dc${i}`, 'ev_charger_dc', [i * 2, 10]);
    expect(buildLimitReason(state, 'ev_charger_dc', 'near')).toBeNull();
    state.buildings.dc9 = building('dc9', 'ev_charger_dc', [18, 10]);
    expect(buildLimitReason(state, 'ev_charger_dc', 'near')).toContain('en fazla 10');
  });

  it('lets one of each service bay stand on the whole station', () => {
    const state = createInitialGameState();
    state.buildings.tyre = building('tyre', 'tyre_service', [8, -20]);
    expect(buildLimitReason(state, 'tyre_service', 'near')).toContain('yalnızca bir');
    expect(buildLimitReason(state, 'car_wash', 'near')).toBeNull();
  });
});

describe('progressive pricing', () => {
  it('charges more for every pump already owned', () => {
    const state = createInitialGameState();
    // The starting station has one pump: the next is 30% up on the catalogue.
    expect(GAME_CONFIG.buildings.pump_standard.price).toBe(39500);
    expect(unitPrice(state, 'pump_standard')).toBe(51400);
    state.pumps.pump_2 = { ...state.pumps.pump_1, id: 'pump_2' };
    expect(unitPrice(state, 'pump_standard')).toBe(66800);
  });

  it('climbs gently for decoration and not at all for the first of anything', () => {
    const state = createInitialGameState();
    expect(unitPrice(state, 'mini_market')).toBe(GAME_CONFIG.buildings.mini_market.price);
    for (let i = 0; i < 5; i++) state.buildings[`lp${i}`] = building(`lp${i}`, 'light_pole', [i, 8]);
    const base = GAME_CONFIG.buildings.light_pole.price;
    expect(unitPrice(state, 'light_pole')).toBe(Math.round((base * Math.pow(1.1, 5)) / 100) * 100);
  });
});
