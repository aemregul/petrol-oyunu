import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOUR_STEPS } from '../ui/tour/tourSteps';
import { TOUR_STEP_COUNT } from '../ui/tour/tourCount';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';

/**
 * Emre, 2026-09-09: the first-run tour. Every step that points at something
 * must point at a thing the HUD actually tags, or the spotlight cuts a hole
 * round nothing; and the store's count of steps must be the list's, or the
 * tour ends a step early or never.
 */
describe('the tour', () => {
  it('has one card per step, each pointing at a tagged piece of the HUD', () => {
    const hud = readFileSync(resolve(__dirname, '../ui/HUD.tsx'), 'utf8');
    const ids = new Set<string>();
    for (const step of TOUR_STEPS) {
      expect(ids.has(step.id)).toBe(false);
      ids.add(step.id);
      expect(step.body.length).toBeGreaterThan(0);
      if (step.target === null) continue;
      // Static targets are written out; the bar's doors are tagged by key.
      const tagged =
        hud.includes(`data-tour="${step.target}"`) ||
        (hud.includes('data-tour={item.key}') && hud.includes(`key: '${step.target}'`));
      expect(tagged, `no data-tour for ${step.target}`).toBe(true);
    }
    expect(TOUR_STEP_COUNT).toBe(TOUR_STEPS.length);
  });

  describe('in the store', () => {
    beforeEach(() => {
      (globalThis as any).window = {};
      (globalThis as any).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
      const state = createInitialGameState();
      state.dayState.timeSpeed = 1;
      useGameStore.setState({ gameState: state, tour: { active: false, step: 0, resumeSpeed: 1 } });
    });

    it('stops the clock while it runs, steps through, and puts the clock back', () => {
      useGameStore.getState().startTour();
      expect(useGameStore.getState().tour).toEqual({ active: true, step: 0, resumeSpeed: 1 });
      expect(useGameStore.getState().gameState.dayState.timeSpeed).toBe(0);

      useGameStore.getState().prevTourStep();
      expect(useGameStore.getState().tour.step).toBe(0);
      useGameStore.getState().nextTourStep();
      useGameStore.getState().nextTourStep();
      expect(useGameStore.getState().tour.step).toBe(2);
      useGameStore.getState().prevTourStep();
      expect(useGameStore.getState().tour.step).toBe(1);

      for (let i = 0; i < TOUR_STEP_COUNT; i++) useGameStore.getState().nextTourStep();
      const after = useGameStore.getState();
      expect(after.tour.active).toBe(false);
      expect(after.gameState.settings.tourSeen).toBe(true);
      expect(after.gameState.dayState.timeSpeed).toBe(1);
    });

    it('can be skipped, and is then not offered again', () => {
      useGameStore.getState().startTour();
      useGameStore.getState().endTour();
      expect(useGameStore.getState().tour.active).toBe(false);
      expect(useGameStore.getState().gameState.settings.tourSeen).toBe(true);
    });

    it('restores the exact player speed after the tour, including pause and relaxed speed', () => {
      for (const speed of [0, 0.5] as const) {
        const state = createInitialGameState();
        state.dayState.timeSpeed = speed;
        useGameStore.setState({
          gameState: state,
          tour: { active: false, step: 0, resumeSpeed: 1 }
        });

        useGameStore.getState().startTour();
        expect(useGameStore.getState().tour.resumeSpeed).toBe(speed);
        useGameStore.getState().endTour();
        expect(useGameStore.getState().gameState.dayState.timeSpeed).toBe(speed);
      }
    });
  });
});
