import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { LEVEL_DATIVE, MISSION_CHAIN, chainGoal, chainStatus, levelXp } from '../domain/services/missionChain';
import { SaveManager } from '../domain/services/SaveManager';
import { ATTENDANT_HIRE_LEVEL, EDIT_MODE_LEVEL, GAME_CONFIG } from '../config/gameConfig';
import { useGameStore, EDIT_MODE_LEVEL as STORE_EDIT_MODE_LEVEL } from '../store/gameStore';
import type { GameState } from '../domain/types/gameState';

/**
 * Emre, 2026-09-12: a player wrote in that the goal asking them to move a
 * building "in İnşaat modu" sent them hunting for a mode that does not exist.
 * The six tutorial goals became one main goal at a time, in the order the
 * game opens up, read from what the station has really done. These pin that
 * order against the game's own locks, the payment, and how an old save joins.
 */

const store = () => useGameStore.getState();
const at = (id: string) => MISSION_CHAIN.findIndex((s) => s.id === id);

describe('the main mission chain', () => {
  it('never asks for something before the game opens it', () => {
    for (const step of MISSION_CHAIN) {
      if (step.builds) expect(step.level, step.id).toBe(GAME_CONFIG.buildings[step.builds].unlockLevel);
    }
    expect(MISSION_CHAIN[at('hire_attendant')].level).toBe(ATTENDANT_HIRE_LEVEL);
    expect(MISSION_CHAIN[at('move_structure')].level).toBe(EDIT_MODE_LEVEL);
    expect(STORE_EDIT_MODE_LEVEL).toBe(EDIT_MODE_LEVEL);
    expect(MISSION_CHAIN[at('solar')].level).toBe(GAME_CONFIG.ev.solar.unlockLevel);
    expect(MISSION_CHAIN[at('manager')].level).toBe(GAME_CONFIG.employees.manager.minLevel);
    // What a thing needs comes before it: the battery before its chargers and
    // panels, a roof before the panels on it.
    expect(at('ev_substation')).toBeLessThan(at('ev_storage'));
    expect(at('ev_storage')).toBeLessThan(at('ev_charger_ac'));
    expect(at('ev_storage')).toBeLessThan(at('solar'));
    expect(at('canopy')).toBeLessThan(at('solar'));
  });

  it('asks for Düzenle by name, and for nothing the game no longer has', () => {
    const words = MISSION_CHAIN.map((s) => `${s.title} ${s.detail}`).join(' ');
    expect(words).not.toMatch(/İnşaat modu|Rapor/);
    expect(MISSION_CHAIN[at('move_structure')].detail).toContain('Düzenle');
    expect(new Set(MISSION_CHAIN.map((s) => s.id)).size).toBe(MISSION_CHAIN.length);
    for (const level of GAME_CONFIG.levels) expect(LEVEL_DATIVE[level.level], `Seviye ${level.level}`).toBeDefined();
  });

  it('starts a new station on its first goal with nothing done, and no tutorial list', () => {
    const state = createInitialGameState();
    expect(state.missions).toEqual([]);
    const status = chainStatus(state)!;
    expect(status).toMatchObject({ index: 0, value: 0, locked: false, complete: false });
    expect(status.step.id).toBe('serve_first');

    state.player.statistics.totalCustomersServed = 1;
    expect(chainStatus(state)!.complete).toBe(true);
  });

  it('shows a goal the game still locks as the level to reach, and counts it only once open', () => {
    const state = createInitialGameState();
    state.missionChain.step = at('hire_attendant');
    state.employees.e1 = { id: 'e1', role: 'PUMP_ATTENDANT', assignedPumpId: 'pump_1' } as never;
    state.player.level = ATTENDANT_HIRE_LEVEL - 1;
    state.player.xp = 540;

    const locked = chainStatus(state)!;
    expect(locked).toMatchObject({ locked: true, complete: false });
    expect(chainGoal(state, locked)).toMatchObject({
      title: "Seviye 3'e ulaş",
      value: 540,
      target: levelXp(ATTENDANT_HIRE_LEVEL),
      guide: 'guide_level'
    });

    state.player.level = ATTENDANT_HIRE_LEVEL;
    const open = chainStatus(state)!;
    expect(open.complete).toBe(true);
    expect(chainGoal(state, open)).toMatchObject({ title: 'Pompacı işe al', guide: 'guide_attendant' });
  });

  it('pays a met goal once, and puts up the next', () => {
    const state = createInitialGameState();
    const { cash, xp } = state.player;
    useGameStore.setState({ gameState: state });

    expect(store().claimChainReward()).toBe(false);
    expect(store().gameState.player.cash).toBe(cash);

    const served = JSON.parse(JSON.stringify(store().gameState)) as GameState;
    served.player.statistics.totalCustomersServed = 1;
    useGameStore.setState({ gameState: served });
    expect(store().claimChainReward()).toBe(true);

    const after = store().gameState;
    expect(after.player.cash).toBe(cash + 500);
    expect(after.player.xp).toBe(xp + 50);
    expect(after.missionChain).toEqual({ step: 1, announced: false });
    expect(chainStatus(after)!.step.id).toBe('set_price');
    expect(store().claimChainReward()).toBe(false);
    expect(store().gameState.player.cash).toBe(cash + 500);
  });

  it('counts prices set by hand, fuel or kWh', () => {
    useGameStore.setState({ gameState: createInitialGameState() });
    store().setFuelPrice('gasoline', 50);
    store().setEvPrice('ac', 12);
    expect(store().gameState.player.statistics.priceChanges).toBe(2);
  });

  it('brings a save from before the chain up to where the station stands, paying nothing for it', () => {
    const raw = createInitialGameState() as any;
    delete raw.missionChain;
    raw.missions = [
      { id: 'mission_T1', templateId: 'T1', type: 'TUTORIAL', metric: 'CUSTOMERS_SERVED', target: 1, progress: 1, completed: true, claimed: true },
      { id: 'mission_T4', templateId: 'T4', type: 'TUTORIAL', metric: 'PRICE_SET', target: 1, progress: 1, completed: true, claimed: false },
      {
        id: 'mission_D_SERVE_3',
        templateId: 'D_SERVE',
        type: 'DAILY_MAIN',
        description: 'Bugün 8 müşteriye hizmet ver',
        metric: 'CUSTOMERS_SERVED',
        target: 8,
        progress: 2,
        rewardCash: 1152,
        rewardXp: 90,
        completed: false,
        claimed: false,
        issuedOnDay: 3
      }
    ];
    raw.player.level = 2;
    raw.player.statistics.totalCustomersServed = 14;
    raw.fuelPurchaseHistory = [
      { id: 'r', day: 1, fuelType: 'gasoline', liters: 500, unitCost: 70, totalCost: 35450, supplierId: 'standart', deliveredAt: 0 }
    ];
    raw.buildings.bin = { ...raw.buildings.office_1, id: 'bin', type: 'trash_can', size: [1, 1] };
    const cash = raw.player.cash;

    const state = SaveManager.fromRaw(JSON.parse(JSON.stringify(raw)));
    expect(state.missions.map((m) => m.id)).toEqual(['mission_D_SERVE_3']);
    // Served, priced (the old goal says so), ordered, ten served, a bin: the day is next.
    expect(MISSION_CHAIN[state.missionChain.step].id).toBe('finish_day');
    expect(state.player.statistics.priceChanges).toBe(1);
    expect(state.player.cash).toBe(cash);
  });

  it('leaves a save already on the chain where it is, with its reward still to take', () => {
    const raw = createInitialGameState();
    raw.player.statistics.totalCustomersServed = 20;
    const state = SaveManager.fromRaw(JSON.parse(JSON.stringify(raw)));
    expect(state.missionChain).toEqual({ step: 0, announced: false });
    expect(chainStatus(state)!.complete).toBe(true);
  });
});
