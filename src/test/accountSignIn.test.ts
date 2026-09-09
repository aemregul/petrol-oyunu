import { describe, it, expect } from 'vitest';
import { popupThenRedirect, describeAuthError } from '../services/account';

/**
 * Emre, 2026-09-09: "Google ile devam et'e basınca hiçbir şey açılmıyor".
 * A blocked popup now falls through to the redirect flow, and every failure
 * gets a sentence a tester can act on instead of vanishing.
 */
describe('the Google button', () => {
  it('falls back to a redirect only when the popup was blocked', async () => {
    const calls: string[] = [];
    await popupThenRedirect(
      async () => { calls.push('popup'); throw { code: 'auth/popup-blocked' }; },
      async () => { calls.push('redirect'); }
    );
    expect(calls).toEqual(['popup', 'redirect']);

    calls.length = 0;
    await expect(popupThenRedirect(
      async () => { calls.push('popup'); throw { code: 'auth/unauthorized-domain' }; },
      async () => { calls.push('redirect'); }
    )).rejects.toEqual({ code: 'auth/unauthorized-domain' });
    expect(calls).toEqual(['popup']);

    calls.length = 0;
    await popupThenRedirect(async () => { calls.push('popup'); }, async () => { calls.push('redirect'); });
    expect(calls).toEqual(['popup']);
  });

  it('tells the tester what to do', () => {
    expect(describeAuthError({ code: 'auth/popup-blocked' })).toMatch(/engelledi/);
    expect(describeAuthError({ code: 'auth/unauthorized-domain' })).toMatch(/Authorized domains/);
    expect(describeAuthError({ code: 'auth/operation-not-allowed' })).toMatch(/Sign-in method/);
    expect(describeAuthError({ code: 'auth/some-new-code' })).toContain('auth/some-new-code');
    expect(describeAuthError(new Error('x'))).toBe('Giriş başarısız oldu. Lütfen tekrar deneyin.');
  });
});
