import { describe, it, expect } from 'vitest';
import { SPLASH_MIN_MS, gateIsOpen, gateSettled, splashHoldMs } from '../ui/WelcomeGate';

/**
 * Emre, 2026-09-09: "önce çok ufak oyun açılıyor sonra login ekranı
 * geliyor". Firebase oturumu bildirene kadar kapı kapalıydı ve oyun o
 * boşlukta çiziliyordu. Karar gelene kadar artık ikisi de çizilmez.
 */
describe('the welcome gate', () => {
  it('is neither open nor settled while Firebase is still deciding', () => {
    const waiting = { accountReady: true, accountResolved: false, account: null };
    expect(gateIsOpen(waiting)).toBe(false);
    expect(gateSettled(waiting)).toBe(false);
  });

  it('opens once Firebase says nobody is signed in', () => {
    const nobody = { accountReady: true, accountResolved: true, account: null };
    expect(gateSettled(nobody)).toBe(true);
    expect(gateIsOpen(nobody)).toBe(true);
  });

  it('stays shut for a returning player', () => {
    const someone = { accountReady: true, accountResolved: true, account: { uid: 'u1' } };
    expect(gateSettled(someone)).toBe(true);
    expect(gateIsOpen(someone)).toBe(false);
  });

  /**
   * Emre, 2026-09-09: "ufak bir splash çıkıyor ama o kadar hızlı ki hiçbir
   * şey gözükmüyor". The splash now stays a readable while, counted from
   * the page's first paint rather than from when React caught up.
   */
  it('holds the splash for at least 1.2 s from first paint', () => {
    expect(SPLASH_MIN_MS).toBe(1200);
    expect(splashHoldMs(0)).toBe(1200);
    expect(splashHoldMs(400)).toBe(800);
    expect(splashHoldMs(1200)).toBe(0);
    // A slow network that already spent longer than the hold gets no extra wait.
    expect(splashHoldMs(3000)).toBe(0);
    expect(splashHoldMs(-5)).toBe(1200);
  });

  it('is settled from the start when there is no Firebase at all', () => {
    const offline = { accountReady: false, accountResolved: false, account: null };
    expect(gateSettled(offline)).toBe(true);
    expect(gateIsOpen(offline)).toBe(false);
  });
});
