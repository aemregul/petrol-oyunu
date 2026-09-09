import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  buildFeedbackNote,
  formatFeedbackNote,
  pickChannel,
  validFeedbackText,
  FEEDBACK_MAX_CHARS
} from '../services/feedback';

/**
 * Emre, 2026-09-09: the feedback box. Where a note goes is decided by what
 * is configured, in a fixed order, and the note always carries the context
 * that makes it answerable.
 */
describe('feedback', () => {
  it('takes the first road that is open: mail relay, then Firestore, then mailto, then the clipboard', () => {
    expect(pickChannel({ web3forms: 'abc', firebase: true, mailto: 'a@b.c' })).toBe('web3forms');
    expect(pickChannel({ web3forms: '  ', firebase: true, mailto: 'a@b.c' })).toBe('firestore');
    expect(pickChannel({ firebase: false, mailto: 'a@b.c' })).toBe('mailto');
    expect(pickChannel({ firebase: false })).toBe('clipboard');
  });

  it('refuses a note too short to mean anything and bounds a long one', () => {
    expect(validFeedbackText('   kısa  ')).toBeNull();
    expect(validFeedbackText('  araçlar girişte sıkışıyor  ')).toBe('araçlar girişte sıkışıyor');
    expect(validFeedbackText('x'.repeat(FEEDBACK_MAX_CHARS + 50))?.length).toBe(FEEDBACK_MAX_CHARS);
  });

  it('carries the day, the level, the till and the version with the words', () => {
    const state = createInitialGameState();
    state.dayState.currentDay = 7;
    state.player.level = 4;
    state.player.cash = 12345.6;
    const note = buildFeedbackNote('bug', 'girişte araçlar sıkışıyor', state, null, '1.0.0');
    expect(note.context).toMatchObject({ day: 7, level: 4, cash: 12346, version: '1.0.0', account: 'giriş yok' });
    const text = formatFeedbackNote(note);
    expect(text).toContain('[Hata] girişte araçlar sıkışıyor');
    expect(text).toContain('Gün 7 · Seviye 4');
    expect(text).toContain('Sürüm 1.0.0');
  });
});
