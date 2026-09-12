import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { ATTENDANT_HIRE_LEVEL, GAME_CONFIG } from '../config/gameConfig';

/**
 * Emre, 2026-09-11: "oyuna başlar başlamaz pompacı alınabiliyor, 3. seviye
 * istemiyor". The Personel card waited for level 3; the pump's own card and
 * the office's hire-all did not, and neither did the store behind all three.
 */

function stationAt(level: number): void {
  const state = createInitialGameState();
  state.player.level = level;
  state.player.cash = 100_000;
  useGameStore.setState({ gameState: state });
}

describe('hiring a pump attendant', () => {
  it('opens at level 3', () => {
    expect(ATTENDANT_HIRE_LEVEL).toBe(3);
  });

  it('is refused below it from every door, with nothing paid and nobody hired', () => {
    for (const level of [1, 2]) {
      stationAt(level);
      // The pump's card names its pump; Personel and the office's hire-all do not.
      expect(useGameStore.getState().hirePumpAttendant('pump_1')).toBe(false);
      expect(useGameStore.getState().hirePumpAttendant()).toBe(false);

      const after = useGameStore.getState().gameState;
      expect(Object.keys(after.employees)).toHaveLength(0);
      expect(after.player.cash).toBe(100_000);
    }
  });

  it('goes through at level 3, for the hire cost', () => {
    stationAt(3);
    expect(useGameStore.getState().hirePumpAttendant('pump_1')).toBe(true);

    const after = useGameStore.getState().gameState;
    expect(Object.values(after.employees).map((e) => e.assignedPumpId)).toEqual(['pump_1']);
    expect(after.player.cash).toBe(100_000 - GAME_CONFIG.employees.pumpAttendant.tierLevels[0].hireCost);
  });

  it('shows the lock on every hire button, not only on the Personel card', () => {
    for (const file of ['../ui/PumpPanel.tsx', '../ui/modals/OfficeModal.tsx', '../ui/modals/StaffModal.tsx']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source, file).toContain('player.level < ATTENDANT_HIRE_LEVEL');
    }
  });
});
