import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { followsAccount, isFreshSave, reconcile, stripForCloud } from '../services/cloudSave';

/**
 * Emre, 2026-09-09: the save follows the account. Which copy wins when a
 * player signs in is the whole risk — a fresh browser must never wipe a
 * real game, and a real game must never be replaced by an older one.
 */
describe('the cloud copy of the save', () => {
  it('follows Google and e-mail accounts, never a guest', () => {
    expect(followsAccount(null)).toBe(false);
    expect(followsAccount({ uid: 'a', name: 'x', email: null, provider: 'guest' })).toBe(false);
    expect(followsAccount({ uid: 'a', name: 'x', email: 'a@b.c', provider: 'email' })).toBe(true);
    expect(followsAccount({ uid: 'a', name: 'x', email: 'a@b.c', provider: 'google' })).toBe(true);
  });

  it('knows a save nobody has played', () => {
    const fresh = createInitialGameState();
    expect(isFreshSave(fresh)).toBe(true);
    const played = createInitialGameState();
    played.player.statistics.totalCustomersServed = 1;
    expect(isFreshSave(played)).toBe(false);
    const spent = createInitialGameState();
    spent.player.cash -= 1;
    expect(isFreshSave(spent)).toBe(false);
  });

  it('sends a local game up when the cloud is empty, and pulls the cloud over a fresh browser', () => {
    const local = createInitialGameState();
    expect(reconcile(local, null, 'me')).toBe('push');
    // A fresh browser signing in: the cloud game comes down even though the
    // local file was written a moment ago.
    local.updatedAt = Date.now();
    expect(reconcile(local, { updatedAt: local.updatedAt - 100000, day: 9, level: 6, saveId: 'c' }, 'me')).toBe('pull');
  });

  it('between two played copies keeps the one saved later', () => {
    const local = createInitialGameState();
    local.player.statistics.totalCustomersServed = 40;
    local.updatedAt = 2000;
    expect(reconcile(local, { updatedAt: 3000, day: 5, level: 3, saveId: 'c' }, 'me')).toBe('pull');
    expect(reconcile(local, { updatedAt: 1000, day: 5, level: 3, saveId: 'c' }, 'me')).toBe('push');
    expect(reconcile(local, { updatedAt: 2000, day: 5, level: 3, saveId: 'c' }, 'me')).toBe('push');
  });

  it('never pushes another player\'s game from a shared machine', () => {
    const local = createInitialGameState();
    local.player.statistics.totalCustomersServed = 40;
    local.updatedAt = 9000;
    local.ownerUid = 'somebody-else';
    // Their game is newer, and still not this account's.
    expect(reconcile(local, { updatedAt: 1000, day: 2, level: 2, saveId: 'c' }, 'me')).toBe('pull');
    expect(reconcile(local, null, 'me')).toBe('fresh');
    // The same save is the owner's own when they come back.
    expect(reconcile(local, null, 'somebody-else')).toBe('push');
  });

  it('leaves the road traffic behind when it goes up', () => {
    const state = createInitialGameState();
    state.vehicles.v1 = { id: 'v1' } as never;
    const slim = stripForCloud(state);
    expect(Object.keys(slim.vehicles)).toHaveLength(0);
    expect(slim.pumps).toBe(state.pumps);
    expect(JSON.stringify(slim).length).toBeLessThan(200_000);
  });
});
