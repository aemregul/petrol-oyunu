import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { evaluatePlacement } from '../domain/services/placement';
import { blockedWays } from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-12: "pompalar yarı boşken sürücüler geri dönüyor". Of the 150
 * spots the placement rules accepted for a second pump on the starting plot, 69
 * were ones no waiting car could drive to. Tucked in behind the first island,
 * the pump was built, paid for and never used once, while drivers turned away
 * beside it. A layout has to leave every pump reachable from the queue.
 */
describe('a pump a waiting car cannot reach', () => {
  it('is refused where it would be built', () => {
    const state = createInitialGameState();
    state.player.level = 12;

    const tucked = evaluatePlacement(state, 'pump_standard', [8.5, 10], 90);
    expect(tucked.valid).toBe(false);
    expect(tucked.reason).toContain('ulaşamaz');
    // The spot that stood idle at 0% through six measured days.
    expect(evaluatePlacement(state, 'pump_standard', [12, 7.5], 90).valid).toBe(false);

    // In line with the first island, near it or with a car's length between: both work.
    expect(evaluatePlacement(state, 'pump_standard', [11.5, 7], 90).valid).toBe(true);
    expect(evaluatePlacement(state, 'pump_standard', [13, 7], 90).valid).toBe(true);
  });

  it('is reported on a save that already has one', () => {
    const state = createInitialGameState();
    expect(blockedWays(state, 'near')).not.toContain('PUMP_ACCESS');

    state.pumps.pump_2 = { ...state.pumps.pump_1, id: 'pump_2', position: [8.5, 10] };
    expect(blockedWays(state, 'near')).toContain('PUMP_ACCESS');

    state.pumps.pump_2.position = [13, 7];
    expect(blockedWays(state, 'near')).not.toContain('PUMP_ACCESS');
  });
});
