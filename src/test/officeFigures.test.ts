import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GAME_CONFIG } from '../config/gameConfig';
import { officeFigures } from '../ui/modals/OfficeModal';

/**
 * The office card's figures, pinned: what the player reads there has to be
 * the same arithmetic the day-end settlement runs.
 */
describe('office summary', () => {
  it('adds the books up the way the settlement does', () => {
    const state = createInitialGameState();
    state.player.cash = 5000;
    state.tanks.gasoline.stock = 100;
    state.tanks.gasoline.averageCost = 40;
    state.tanks.diesel.stock = 0;
    state.tanks.lpg.stock = 0;
    state.buildings.wc = {
      id: 'wc', type: 'toilet', level: 1, position: [1, 7], rotation: 0, size: [2, 2],
      health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0, till: 450
    };
    state.employees.emp = {
      id: 'emp', name: 'A', role: 'PUMP_ATTENDANT', level: 1, wage: 650, assignedPumpId: 'pump_1',
      state: 'IDLE', serviceCount: 0, currentVehicleId: null, actionTimerSeconds: 0, worldPosition: [0, 0, 0]
    };

    const f = officeFigures(state);
    expect(f.stockValue).toBe(4000);
    expect(f.tills).toBe(450);
    expect(f.assets).toBe(5000 + 4000 + 450);
    // One attendant's wage plus every structure's keep: pump, office, farm,
    // price sign and the toilet.
    const upkeep =
      GAME_CONFIG.buildings.pump_standard.dailyUpkeep +
      GAME_CONFIG.buildings.office.dailyUpkeep +
      GAME_CONFIG.buildings.tank_farm.dailyUpkeep +
      GAME_CONFIG.buildings.price_sign.dailyUpkeep +
      GAME_CONFIG.buildings.toilet.dailyUpkeep;
    expect(f.dailyExpenses).toBe(650 + upkeep);
    expect(f.wages).toBe(650);
    expect(f.pumps).toBe(1);
    expect(f.attendants).toBe(1);
    expect(f.unmanned).toBe(0);
    expect(f.hireAllCost).toBe(0);
  });

  it('prices staffing every empty pump at the hiring rate', () => {
    const state = createInitialGameState();
    state.pumps.pump_2 = { ...state.pumps.pump_1, id: 'pump_2', position: [14, 7] };
    const f = officeFigures(state);
    expect(f.unmanned).toBe(2);
    expect(f.hireAllCost).toBe(2 * GAME_CONFIG.employees.pumpAttendant.tierLevels[0].hireCost);
  });

  it('shows where the day is taking the name', () => {
    const state = createInitialGameState();
    state.player.reputation = 3;
    // A quiet day drifts toward a middling score; a day of good service lifts it.
    expect(officeFigures(state).reputationTarget).toBe(3);
    state.dayState.todayStats.customersServed = 10;
    state.dayState.todayStats.serviceScoreSum = 950;
    expect(officeFigures(state).reputationTarget).toBeGreaterThan(3);
  });
});
