import type { AccountProfile } from './account';
import type { GameState } from '../domain/types/gameState';

/**
 * The guest's temporary licence (Emre, 2026-09-14). A guest plays five
 * in-game days; the sixth morning belongs to a registered station. Nothing is
 * taken away at the limit — the save stays in this browser, and signing in or
 * signing up carries it to the account, where it carries on from that morning.
 *
 * Counted in closed days rather than the calendar, so the fifth day is played
 * to its end, and a fresh start gets a fresh five.
 */
export const GUEST_DAY_LIMIT = 5;

/**
 * Whether the licence applies at all: to a guest, and only where there is an
 * account to sign up for. A game running without Firebase is not limited.
 */
export function guestLicenceApplies(
  account: Pick<AccountProfile, 'provider'> | null,
  backendReady: boolean
): boolean {
  return backendReady && account?.provider === 'guest';
}

/** Days a guest has left, counting today; none once the fifth day has closed. */
export function guestDaysLeft(state: Pick<GameState, 'player'>): number {
  return Math.max(0, GUEST_DAY_LIMIT - state.player.statistics.daysCompleted);
}

/**
 * A save a guest has used up: five days closed and never tied to an account.
 * A registered player's save carries its owner, so signing out of one never
 * reads as an expired guest.
 */
export function guestSaveSpent(state: Pick<GameState, 'player' | 'ownerUid'>): boolean {
  return !state.ownerUid && guestDaysLeft(state) === 0;
}
