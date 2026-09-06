import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  createEffects,
  triggerEvent,
  EVENT_TOAST_HOLD_MS
} from '../domain/services/simulationEngine';
import { GAME_EVENTS } from '../config/eventConfig';

/**
 * Sağ üstteki olay kartı yalnızca olayın adını taşır; "Rafineri Zammı"nın ne
 * işe yaradığı sol alttaki bildirimde anlatılır. O bildirim sıradan dört
 * saniyelik pillerden uzun kalmalı ki oyuncu okuyabilsin (Emre, 2026-09-06).
 */
describe('event explanation toast', () => {
  it('asks the corner to hold every event explanation longer than a normal pill', () => {
    for (const config of GAME_EVENTS) {
      const state = createInitialGameState();
      state.player.level = 10;
      const effects = createEffects();
      triggerEvent(state, config, effects);

      const explanation = effects.notifications.find((n) => n.title === config.name);
      expect(explanation, config.id).toBeDefined();
      expect(explanation!.message.length, config.id).toBeGreaterThan(10);
      expect(explanation!.holdMs, config.id).toBe(EVENT_TOAST_HOLD_MS);
    }
    // Uzun, ama sonsuz değil: 10 saniyeden az okunamaz, yarım dakikadan çok kalır.
    expect(EVENT_TOAST_HOLD_MS).toBeGreaterThanOrEqual(10_000);
    expect(EVENT_TOAST_HOLD_MS).toBeLessThanOrEqual(30_000);
  });
});
