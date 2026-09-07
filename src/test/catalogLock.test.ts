import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GAME_CONFIG } from '../config/gameConfig';
import { catalogLock } from '../ui/modals/BuildModal';
import { BuildingEntity } from '../domain/types/gameState';

/**
 * Emre, 2026-09-07: the catalogue card says in orange why a thing cannot be
 * bought yet and shows KİLİTLİ; the electric line unlocks in order.
 */
function stand(state: ReturnType<typeof createInitialGameState>, id: string, type: string): void {
  const b: BuildingEntity = {
    id, type, level: 1, position: [0, 0], rotation: 0, size: GAME_CONFIG.buildings[type].size,
    health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
  };
  state.buildings[id] = b;
}

describe('catalogue locks', () => {
  it('unlocks the electric line one piece after the other', () => {
    const state = createInitialGameState();
    state.player.level = 12;
    const item = (t: string) => GAME_CONFIG.buildings[t];
    expect(catalogLock(state, item('ev_substation'))).toBeNull();
    expect(catalogLock(state, item('ev_storage'))).toBe('Elektrik altyapısı gerekli');
    expect(catalogLock(state, item('ev_charger_dc'))).toBe('Enerji depolama gerekli');
    stand(state, 'sub', 'ev_substation');
    expect(catalogLock(state, item('ev_storage'))).toBeNull();
    expect(catalogLock(state, item('ev_charger_ac'))).toBe('Enerji depolama gerekli');
    stand(state, 'bank', 'ev_storage');
    expect(catalogLock(state, item('ev_charger_ac'))).toBeNull();
    expect(catalogLock(state, item('ev_charger_dc'))).toBeNull();
  });

  it('names the level before anything else', () => {
    const state = createInitialGameState();
    state.player.level = 1;
    const storage = GAME_CONFIG.buildings.ev_storage;
    expect(catalogLock(state, storage)).toBe(`Seviye ${storage.unlockLevel} gerekli`);
  });

  it('holds the wide tank behind the farm at Sv.3', () => {
    const state = createInitialGameState();
    state.player.level = 20;
    expect(catalogLock(state, GAME_CONFIG.buildings.tank_expansion)).toBe('Tank Sahası Sv.3 gerekli');
    const farm = Object.values(state.buildings).find((b) => b.type === 'tank_farm')!;
    farm.level = 3;
    expect(catalogLock(state, GAME_CONFIG.buildings.tank_expansion)).toBeNull();
  });
});
