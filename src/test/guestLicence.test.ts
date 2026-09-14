import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { GUEST_DAY_LIMIT, guestDaysLeft, guestLicenceApplies, guestSaveSpent } from '../services/guestLicence';
import type { AccountProfile } from '../services/account';

/**
 * Emre, 2026-09-14: a guest plays five in-game days on a temporary licence;
 * the sixth morning needs an account, and the station goes with it.
 */

function stubBrowser(): void {
  (globalThis as any).window = {};
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  };
}

const guest: AccountProfile = { uid: 'g1', name: 'Misafir İşletmeci', email: null, provider: 'guest' };
const member: AccountProfile = { uid: 'm1', name: 'Emre', email: 'emre@example.com', provider: 'email' };

const store = () => useGameStore.getState();

/** A save whose day has just closed, after `closed` completed days. */
function closedDay(closed: number) {
  const state = createInitialGameState();
  state.dayState.currentDay = closed;
  state.dayState.isDayActive = false;
  state.dayState.isDayEnding = true;
  state.player.statistics.daysCompleted = closed;
  return state;
}

beforeEach(() => stubBrowser());

describe('the guest licence', () => {
  it('applies to guests only, and only where there is an account to sign up for', () => {
    expect(guestLicenceApplies(guest, true)).toBe(true);
    expect(guestLicenceApplies(member, true)).toBe(false);
    expect(guestLicenceApplies(null, true)).toBe(false);
    expect(guestLicenceApplies(guest, false)).toBe(false);
  });

  it('counts down the days a guest has left and stops at none', () => {
    const state = createInitialGameState();
    expect(guestDaysLeft(state)).toBe(GUEST_DAY_LIMIT);
    state.player.statistics.daysCompleted = GUEST_DAY_LIMIT - 1;
    expect(guestDaysLeft(state)).toBe(1);
    state.player.statistics.daysCompleted = GUEST_DAY_LIMIT + 3;
    expect(guestDaysLeft(state)).toBe(0);
  });

  it('reads a used-up save as a guest one only if no account ever owned it', () => {
    const state = closedDay(GUEST_DAY_LIMIT);
    expect(guestSaveSpent(state)).toBe(true);
    state.ownerUid = member.uid;
    expect(guestSaveSpent(state)).toBe(false);
  });

  it("keeps a guest's sixth morning closed and shows the way to an account", () => {
    useGameStore.setState({ gameState: closedDay(GUEST_DAY_LIMIT), account: guest, accountReady: true, activeModal: 'DAY_REPORT' });
    store().startNextDay();
    expect(store().gameState.dayState.isDayActive).toBe(false);
    expect(store().gameState.dayState.currentDay).toBe(GUEST_DAY_LIMIT);
    expect(store().activeModal).toBe('GUEST_LIMIT');
  });

  it('lets the same station carry on once it belongs to an account', () => {
    useGameStore.setState({ gameState: closedDay(GUEST_DAY_LIMIT), account: member, accountReady: true, activeModal: 'DAY_REPORT' });
    store().startNextDay();
    expect(store().gameState.dayState.isDayActive).toBe(true);
    expect(store().gameState.dayState.currentDay).toBe(GUEST_DAY_LIMIT + 1);
  });

  it('never limits a game with no accounts to sign up for', () => {
    useGameStore.setState({ gameState: closedDay(GUEST_DAY_LIMIT + 2), account: guest, accountReady: false, activeModal: 'DAY_REPORT' });
    store().startNextDay();
    expect(store().gameState.dayState.currentDay).toBe(GUEST_DAY_LIMIT + 3);
  });

  it('tells a guest each morning how many days are left', () => {
    useGameStore.setState({ gameState: closedDay(2), account: guest, accountReady: true, activeModal: 'DAY_REPORT' });
    store().startNextDay();
    const note = store().gameState.notifications.find((n) => n.title === 'Geçici Ruhsat');
    expect(note?.message).toContain(`${GUEST_DAY_LIMIT - 2} gün`);
  });
});
