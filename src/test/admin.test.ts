import { describe, it, expect } from 'vitest';
import { accountIsAdmin } from '../services/admin';
import { createInitialGameState } from '../domain/types/initialState';

/**
 * Emre, 2026-09-09: the admin panel opens for the accounts .env names and
 * for nobody else — never a guest, whatever the list says. The frame
 * counter that replaced the stats bar starts off.
 */
describe('the admin door', () => {
  const uids = ['abc123'];
  const emails = ['owner@example.com'];
  it('opens for a listed uid or e-mail, case-insensitively', () => {
    expect(accountIsAdmin({ uid: 'ABC123', name: 'x', email: null, provider: 'google' }, uids, emails)).toBe(true);
    expect(accountIsAdmin({ uid: 'other', name: 'x', email: 'Owner@Example.com', provider: 'email' }, uids, emails)).toBe(true);
  });
  it('stays shut for everyone else, and for guests even when listed', () => {
    expect(accountIsAdmin(null, uids, emails)).toBe(false);
    expect(accountIsAdmin({ uid: 'other', name: 'x', email: 'someone@example.com', provider: 'email' }, uids, emails)).toBe(false);
    expect(accountIsAdmin({ uid: 'abc123', name: 'x', email: null, provider: 'guest' }, uids, emails)).toBe(false);
    expect(accountIsAdmin({ uid: 'abc123', name: 'x', email: null, provider: 'google' }, [], [])).toBe(false);
  });
});

describe('the frame counter', () => {
  it('is off in a fresh save', () => {
    expect(createInitialGameState().settings.showFps).toBeFalsy();
  });
});
