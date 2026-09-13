import { describe, it, expect } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';

/**
 * Emre, 2026-09-13: "pompa sayısı kadar pompacı alma olsun, şu an sınırsız
 * alınıyor". The hire only asked whether the chosen pump already had someone
 * on it, so an attendant taken off their pump stayed on the payroll and the
 * pump could be staffed again, and again. One attendant per pump now, and one
 * per charging post, counting everyone on the payroll.
 */

function station(): GameState {
  const state = createInitialGameState();
  state.player.level = 3;
  state.player.cash = 1_000_000;
  useGameStore.setState({ gameState: state });
  return state;
}

const store = () => useGameStore.getState();
const attendants = () =>
  Object.values(store().gameState.employees).filter((e) => e.role === 'PUMP_ATTENDANT');

describe('hiring pump attendants', () => {
  it('stops at one per pump, counting the one taken off a pump', () => {
    station();
    expect(store().hirePumpAttendant()).toBe(true);

    // Off the pump, still on the payroll.
    store().assignAttendantToPump(attendants()[0].id, null);
    expect(store().gameState.pumps.pump_1.employeeId).toBeNull();

    const cash = store().gameState.player.cash;
    // It used to hire a second one here, and a third after that.
    expect(store().hirePumpAttendant('pump_1')).toBe(false);
    expect(store().hirePumpAttendant()).toBe(false);
    expect(attendants()).toHaveLength(1);
    expect(store().gameState.player.cash).toBe(cash);
  });

  it('opens one more place for every pump built', () => {
    const state = station();
    state.pumps.pump_2 = { ...state.pumps.pump_1, id: 'pump_2', position: [13, 7], employeeId: null };
    useGameStore.setState({ gameState: { ...state } });

    expect(store().hirePumpAttendant()).toBe(true);
    expect(store().hirePumpAttendant()).toBe(true);
    expect(attendants().map((e) => e.assignedPumpId).sort()).toEqual(['pump_1', 'pump_2']);

    // Two pumps, two attendants: the one sent off pump_2 is the only one it gets back.
    const second = attendants().find((e) => e.assignedPumpId === 'pump_2')!;
    store().assignAttendantToPump(second.id, null);
    expect(store().hirePumpAttendant('pump_2')).toBe(false);
    expect(attendants()).toHaveLength(2);
  });

  it('counts a charging post as a place of its own', () => {
    const state = station();
    state.buildings.post = {
      id: 'post', type: 'ev_charger_ac', level: 1, position: [14, 4], rotation: 0,
      size: GAME_CONFIG.buildings.ev_charger_ac.size, health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    } as GameState['buildings'][string];
    useGameStore.setState({ gameState: { ...state } });

    expect(store().hirePumpAttendant('pump_1')).toBe(true);
    expect(store().hirePumpAttendant('post')).toBe(true);
    expect(attendants()).toHaveLength(2);

    const onPost = attendants().find((e) => e.assignedPumpId === 'post')!;
    store().assignAttendantToPump(onPost.id, null);
    expect(store().hirePumpAttendant('post')).toBe(false);
    expect(attendants()).toHaveLength(2);
  });
});
