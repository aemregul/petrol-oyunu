import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config/gameConfig';
import { managerTierAt } from '../domain/services/managerDuties';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';
import { createInitialGameState } from '../domain/types/initialState';
import type { GameState } from '../domain/types/gameState';

function managed(level: 1 | 2 | 3): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.station.open = false;
  state.player.cash = 1_000_000;
  state.station.managerId = 'manager_audit';
  state.station.managerLevel = level;
  state.station.managerTourSecondsLeft = 0;
  state.managerSettings.autoFuelOrder = true;
  state.managerSettings.autoPricing = true;
  state.managerSettings.autoAssignAttendants = true;
  state.managerSettings.autoMaintenance = true;
  state.managerSettings.autoRepair = true;
  state.managerSettings.autoClean = true;
  state.managerSettings.dealStockUp = true;
  return state;
}

function runRound(state: GameState): void {
  runSimulationTick(state, 0.05, createEffects());
}

function fillAllTanks(state: GameState): void {
  for (const tank of Object.values(state.tanks)) {
    tank.stock = tank.capacity;
    tank.reservedStock = 0;
  }
}

describe('manager automation audit', () => {
  it('uses the advertised round delay at every level', () => {
    for (const level of [1, 2, 3] as const) {
      const state = managed(level);
      runRound(state);
      expect(state.station.managerTourSecondsLeft).toBe(managerTierAt(level).tourSeconds);
    }
  });

  it('orders only the low fuels, not every fuel just because gasoline ran out', () => {
    const state = managed(1);
    state.pumps.pump_1.supportedFuels = ['gasoline', 'diesel', 'lpg'];
    fillAllTanks(state);
    state.tanks.gasoline.stock = 0;

    runRound(state);

    expect(state.fuelOrders.map((order) => order.fuelType)).toEqual(['gasoline']);
  });

  it('orders each low fuel independently when more than one really needs stock', () => {
    const state = managed(1);
    state.pumps.pump_1.supportedFuels = ['gasoline', 'diesel', 'lpg'];
    fillAllTanks(state);
    state.tanks.gasoline.stock = 0;
    state.tanks.diesel.stock = 0;

    runRound(state);

    expect(state.fuelOrders.map((order) => order.fuelType).sort()).toEqual(['diesel', 'gasoline']);
  });

  it('never orders a fuel that no installed pump can sell', () => {
    const state = managed(1);
    for (const tank of Object.values(state.tanks)) {
      tank.stock = 0;
      tank.reservedStock = 0;
    }

    runRound(state);

    expect(state.fuelOrders.map((order) => order.fuelType)).toEqual(['gasoline']);
  });

  it('protects the cash reserve instead of placing an unaffordable order', () => {
    const state = managed(1);
    fillAllTanks(state);
    state.tanks.gasoline.stock = 0;
    state.player.cash = state.managerSettings.kasaReserve;

    runRound(state);

    expect(state.fuelOrders).toHaveLength(0);
    expect(state.player.cash).toBe(state.managerSettings.kasaReserve);
    expect(state.managerLogs.some((entry) => entry.result === 'SKIPPED_RESERVE')).toBe(true);
  });

  it('assigns an idle attendant and services a worn pump at level one', () => {
    const state = managed(1);
    state.managerSettings.autoFuelOrder = false;
    state.pumps.pump_1.health = 30;
    state.employees.idle = {
      id: 'idle',
      name: 'Boştaki Usta',
      role: 'PUMP_ATTENDANT',
      level: 1,
      wage: 900,
      assignedPumpId: null,
      state: 'UNASSIGNED',
      serviceCount: 0,
      currentVehicleId: null,
      actionTimerSeconds: 0,
      worldPosition: [0, 0, 0]
    };

    runRound(state);

    expect(state.employees.idle.assignedPumpId).toBe('pump_1');
    expect(state.pumps.pump_1.health).toBe(100);
  });

  it('changes prices only for fuels the station can sell at level two', () => {
    const state = managed(2);
    state.managerSettings.autoFuelOrder = false;
    const before = {
      gasoline: state.pricing.gasoline.playerPrice,
      diesel: state.pricing.diesel.playerPrice,
      lpg: state.pricing.lpg.playerPrice
    };
    state.pricing.gasoline.playerPrice += 10;
    state.pricing.diesel.playerPrice += 10;
    state.pricing.lpg.playerPrice += 10;

    runRound(state);

    expect(state.pricing.gasoline.playerPrice).not.toBe(before.gasoline + 10);
    expect(state.pricing.diesel.playerPrice).toBe(before.diesel + 10);
    expect(state.pricing.lpg.playerPrice).toBe(before.lpg + 10);
  });

  it('repairs a broken pump and cleans the site at level two', () => {
    const state = managed(2);
    state.managerSettings.autoFuelOrder = false;
    state.pumps.pump_1.health = 0;
    state.pumps.pump_1.state = 'BROKEN';
    state.station.cleanliness = 20;

    runRound(state);

    expect(state.pumps.pump_1.state).toBe('IDLE');
    expect(state.pumps.pump_1.health).toBe(100);
    expect(state.station.cleanliness).toBeCloseTo(45, 2);
  });

  it('enforces the current grade when an old save carries senior order controls', () => {
    const state = managed(1);
    fillAllTanks(state);
    state.managerSettings.orderThresholdPercent = 50;
    state.managerSettings.orderTargetPercent = 100;
    state.tanks.gasoline.stock = state.tanks.gasoline.capacity * 0.3;

    runRound(state);
    expect(state.fuelOrders).toHaveLength(0);

    state.station.managerTourSecondsLeft = 0;
    state.tanks.gasoline.stock = state.tanks.gasoline.capacity * 0.1;
    runRound(state);
    const order = state.fuelOrders.find((candidate) => candidate.fuelType === 'gasoline');
    const step = GAME_CONFIG.fuels.gasoline.orderStepLiters;
    const expected = Math.floor((state.tanks.gasoline.capacity * 0.8) / step) * step;
    expect(order?.liters).toBe(expected);
  });

  it('lets level three fill to the brim during a deal even when stock is below the normal reorder threshold', () => {
    const state = managed(3);
    fillAllTanks(state);
    const tank = state.tanks.gasoline;
    tank.stock = tank.capacity * 0.1;
    state.dayState.fuelDealSecondsLeft = 60;

    runRound(state);

    const order = state.fuelOrders.find((candidate) => candidate.fuelType === 'gasoline');
    const step = GAME_CONFIG.fuels.gasoline.orderStepLiters;
    const expected = Math.floor((tank.capacity - tank.stock) / step) * step;
    expect(order?.liters).toBe(expected);
  });
});
