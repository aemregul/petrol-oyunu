import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';
import { calculateEndOfDayReputation } from '../domain/formulas/economy';
import { GameState } from '../domain/types/gameState';

/** Walks every number in the state and reports anything that is not finite. */
function badNumbers(node: unknown, path = '', out: string[] = []): string[] {
  if (typeof node === 'number') {
    if (!Number.isFinite(node)) out.push(`${path} = ${node}`);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      badNumbers(value, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

/** Everything that should be true of a station at any moment of any day. */
function check(state: GameState, note: (message: string) => void): void {
  for (const bad of badNumbers(state)) note('not a number: ' + bad);

  if (state.player.reputation < 1 || state.player.reputation > 5) note('reputation out of range');
  if (state.station.cleanliness < 0 || state.station.cleanliness > 100) note('cleanliness out of range');

  for (const [fuel, tank] of Object.entries(state.tanks)) {
    if (tank.stock < -0.01) note(`${fuel} stock went negative`);
    if (tank.stock > tank.capacity + 0.01) note(`${fuel} stock exceeds the tank`);
    if (tank.reservedStock < -0.01) note(`${fuel} reservation went negative`);
    if (tank.reservedStock > tank.capacity + 0.01) note(`${fuel} reservation exceeds the tank`);
  }

  // A pump left holding a customer who has gone is a bay that never works
  // again, and the player has no way of seeing why.
  for (const pump of Object.values(state.pumps)) {
    if (pump.currentVehicleId && !state.vehicles[pump.currentVehicleId]) {
      note('pump still holds a vehicle that no longer exists');
    }
    if (pump.health < 0 || pump.health > 100) note('pump health out of range');
  }

  for (const employee of Object.values(state.employees)) {
    if (employee.assignedPumpId && !state.pumps[employee.assignedPumpId]) {
      note('employee assigned to a pump that no longer exists');
    }
    if (employee.currentVehicleId && !state.vehicles[employee.currentVehicleId]) {
      note('employee still serving a vehicle that no longer exists');
    }
  }

  for (const vehicle of Object.values(state.vehicles)) {
    if (vehicle.chargingBuildingId && !state.buildings[vehicle.chargingBuildingId]) {
      note('vehicle plugged into a charger that no longer exists');
    }
    if (vehicle.patience > vehicle.maxPatience + 0.01) note('patience above its own maximum');
  }
}

describe('a station left running', () => {
  it('holds together over several trading days', () => {
    const state = createInitialGameState();
    state.player.level = 12;
    state.player.cash = 400000;
    state.dayState.timeSpeed = 1;
    state.employees = {
      e1: {
        id: 'e1', name: 'Ahmet', role: 'PUMP_ATTENDANT', level: 3, wage: 1000,
        assignedPumpId: 'pump_1', state: 'IDLE', serviceCount: 0,
        currentVehicleId: null, actionTimerSeconds: 0, worldPosition: [8, 0, 7]
      }
    } as never;
    // A manager set up the way an attentive player would: reordering well
    // before the tank runs dry, because running dry now costs custom.
    state.station.managerId = 'mgr';
    state.managerSettings.autoFuelOrder = true;
    state.managerSettings.orderThresholdPercent = 55;
    state.managerSettings.orderTargetPercent = 95;

    const problems: string[] = [];
    const note = (message: string) => {
      if (!problems.includes(message)) problems.push(message);
    };

    const reputationByDay: number[] = [];

    for (let day = 0; day < 3; day++) {
      for (let tick = 0; tick < 20000; tick++) {
        const effects = createEffects();
        runSimulationTick(state, 0.2, effects);
        if (effects.dayEnded || state.dayState.isDayEnding) break;
        if (tick % 100 === 0) check(state, note);
      }

      const { customersServed: served, customersLost: failed } = state.dayState.todayStats;
      const average = served > 0 ? state.dayState.todayStats.serviceScoreSum / served : 60;
      const tookOn = served + failed;
      const penalty = tookOn > 0 ? Math.min(0.35, (failed / tookOn) * 0.6) : 0;
      state.player.reputation = calculateEndOfDayReputation(
        state.player.reputation,
        average,
        -penalty
      );
      reputationByDay.push(state.player.reputation);

      Object.assign(state.dayState.todayStats, {
        customersServed: 0, customersLost: 0, customersTurnedAway: 0, serviceScoreSum: 0
      });
      state.dayState.gameTime = 6;
      state.dayState.isDayEnding = false;
      state.dayState.isDayActive = true;
      state.vehicles = {};
    }

    expect(problems).toEqual([]);

    // A station that is serving its customers well should be gaining a name,
    // not losing one. Reputation used to fall every day no matter how it was
    // run, because every driver who passed a full forecourt counted against it.
    expect(reputationByDay[reputationByDay.length - 1]).toBeGreaterThan(3);
  });
});
