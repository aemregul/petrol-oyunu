import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { nextPumpNumber, pumpName, pumpNumber } from '../domain/services/pumpNames';

/**
 * Emre, 2026-09-09: "pump_1" is an id, not a name. The player sees
 * "Pompa 1"; a bought pump takes the next number and keeps it when moved;
 * a save from before numbers reads its pumps in the order they were put down.
 */
describe('pump names', () => {
  it('calls the starting pump Pompa 1 and hands the next number out in order', () => {
    const state = createInitialGameState();
    expect(pumpName(state, 'pump_1')).toBe('Pompa 1');
    expect(pumpName(state, state.pumps.pump_1)).toBe('Pompa 1');
    expect(nextPumpNumber(state)).toBe(2);

    state.pumps.pump_k3x9 = { ...state.pumps.pump_1, id: 'pump_k3x9', number: 2 };
    expect(pumpName(state, 'pump_k3x9')).toBe('Pompa 2');
    expect(nextPumpNumber(state)).toBe(3);

    // A pump sold in the middle leaves a gap rather than renumbering the rest.
    delete state.pumps.pump_1;
    expect(pumpName(state, 'pump_k3x9')).toBe('Pompa 2');
    expect(nextPumpNumber(state)).toBe(3);
  });

  it('falls back to the order pumps were put down for a save without numbers', () => {
    const state = createInitialGameState();
    delete state.pumps.pump_1.number;
    state.pumps.pump_abc = { ...state.pumps.pump_1, id: 'pump_abc' };
    delete state.pumps.pump_abc.number;
    expect(pumpNumber(state, state.pumps.pump_1)).toBe(1);
    expect(pumpNumber(state, state.pumps.pump_abc)).toBe(2);
    expect(pumpName(state, 'missing')).toBe('Pompa');
  });
});
