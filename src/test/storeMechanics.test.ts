import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState } from '../domain/types/gameState';

/**
 * The store-level mechanics that were promised on the level screen and in the
 * catalogue but could not actually be reached: tank upgrades, pump repair and
 * upgrade, the manager's wage and hiring bar. Each of these was config plus a
 * store function with no working path between them.
 */

function stubBrowser(): void {
  (globalThis as any).window = {};
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  };
}

function freshState(): GameState {
  const state = createInitialGameState();
  state.player.cash = 1_000_000;
  state.player.level = 12;
  return state;
}

function putTank(state: GameState, level = 1): string {
  state.buildings.tankA = {
    id: 'tankA', type: 'tank_gasoline', level, position: [4, 4], rotation: 0,
    size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
  } as GameState['buildings'][string];
  return 'tankA';
}

beforeEach(() => {
  stubBrowser();
  useGameStore.setState({
    gameState: freshState(),
    buildMode: { active: false, buildingType: null, position: [0, 0], rotation: 0, isValid: true },
    relocating: null,
    editMode: true
  });
});

describe('tank packages', () => {
  it('upgrades a tank package into real litres, on the promised ladder', () => {
    const state = useGameStore.getState().gameState;
    putTank(state);
    state.player.level = 3;
    const before = state.tanks.gasoline.capacity;
    useGameStore.setState({ gameState: { ...state } });

    // 3.000 L is a level-4 promise; below it the money must not move.
    expect(useGameStore.getState().upgradeBuilding('tankA')).toBe(false);

    const ready = useGameStore.getState().gameState;
    ready.player.level = 4;
    useGameStore.setState({ gameState: { ...ready } });
    expect(useGameStore.getState().upgradeBuilding('tankA')).toBe(true);

    const after = useGameStore.getState().gameState;
    expect(after.buildings.tankA.level).toBe(2);
    // A level-2 package holds 3.000 L where the level-1 held 1.500.
    expect(after.tanks.gasoline.capacity).toBe(before + 1500);
  });

  it('counts the upgrade money when a tank is valued for sale', () => {
    const state = useGameStore.getState().gameState;
    putTank(state);
    useGameStore.setState({ gameState: { ...state } });
    const plain = useGameStore.getState().structureValue('tankA');

    const upgraded = useGameStore.getState().gameState;
    upgraded.buildings.tankA.level = 2;
    useGameStore.setState({ gameState: { ...upgraded } });

    // The 20.000 TL sunk into the level-2 package has to show in the price,
    // the way it always did for pumps and shops.
    expect(useGameStore.getState().structureValue('tankA')).toBeGreaterThan(plain);
  });

  it('takes a sold package’s litres away and spills what no longer fits', () => {
    const state = useGameStore.getState().gameState;
    putTank(state, 2);
    state.tanks.gasoline.capacity += 3000;
    state.tanks.gasoline.stock = state.tanks.gasoline.capacity;
    const capacityBefore = state.tanks.gasoline.capacity;
    useGameStore.setState({ gameState: { ...state } });

    expect(useGameStore.getState().sellStructure('tankA')).toBe(true);

    const after = useGameStore.getState().gameState;
    expect(after.tanks.gasoline.capacity).toBe(capacityBefore - 3000);
    expect(after.tanks.gasoline.stock).toBe(after.tanks.gasoline.capacity);
  });

  it('moves a tank without growing it and without resetting its level', () => {
    const state = useGameStore.getState().gameState;
    putTank(state, 2);
    state.tanks.gasoline.capacity += 3000;
    const capacityBefore = state.tanks.gasoline.capacity;
    useGameStore.setState({ gameState: { ...state } });

    expect(useGameStore.getState().relocateStructure('tankA')).toBe(true);
    useGameStore.getState().setBuildPreviewPos([13, 12]);
    expect(useGameStore.getState().confirmBuildPlacement()).toBe(true);

    const after = useGameStore.getState().gameState;
    const moved = Object.values(after.buildings).find((b) => b.type === 'tank_gasoline')!;
    // Relocation used to add another 1.500 L package and knock it back to Sv1.
    expect(after.tanks.gasoline.capacity).toBe(capacityBefore);
    expect(moved.level).toBe(2);
  });
});

describe('pump upgrades and repair', () => {
  it('holds pump upgrades to the promised level ladder', () => {
    const state = useGameStore.getState().gameState;
    state.player.level = 2;
    useGameStore.setState({ gameState: { ...state } });
    // S2 is promised at level 3; below it the money must not move.
    expect(useGameStore.getState().upgradePump('pump_1')).toBe(false);

    const again = useGameStore.getState().gameState;
    again.player.level = 3;
    useGameStore.setState({ gameState: { ...again } });
    expect(useGameStore.getState().upgradePump('pump_1')).toBe(true);
    expect(useGameStore.getState().gameState.pumps.pump_1.level).toBe(2);
  });

  it('repairs a worn pump back to full health for a price', () => {
    const state = useGameStore.getState().gameState;
    state.pumps.pump_1.health = 20;
    useGameStore.setState({ gameState: { ...state } });

    const cashBefore = useGameStore.getState().gameState.player.cash;
    expect(useGameStore.getState().repairPump('pump_1')).toBe(true);

    const after = useGameStore.getState().gameState;
    expect(after.pumps.pump_1.health).toBe(100);
    expect(after.player.cash).toBeLessThan(cashBefore);
  });
});

describe('the manager', () => {
  it('draws a wage at the end of the day like everybody else', () => {
    const state = useGameStore.getState().gameState;
    state.station.managerId = 'manager_1';
    useGameStore.setState({ gameState: { ...state } });

    useGameStore.getState().endDayAndShowReport();

    const wages = useGameStore.getState().gameState.dayState.todayStats.wages;
    expect(wages).toBeGreaterThanOrEqual(GAME_CONFIG.employees.manager.dailyWage);
  });

  it('cannot be hired until every advertised requirement actually holds', () => {
    const state = useGameStore.getState().gameState;
    state.player.reputation = 5;
    // Level and reputation are fine; the office, attendants and profit are not.
    useGameStore.setState({ gameState: { ...state } });
    expect(useGameStore.getState().hireManager()).toBe(false);

    const ready = useGameStore.getState().gameState;
    ready.buildings.office_1.level = 2;
    for (let i = 0; i < 2; i++) {
      const id = `emp_${i}`;
      ready.employees[id] = {
        id, name: `Pompacı ${i + 1}`, role: 'PUMP_ATTENDANT', level: 1, wage: 450,
        state: 'IDLE', assignedPumpId: null, currentVehicleId: null, serviceCount: 0,
        actionTimerSeconds: 0, worldPosition: [0, 0, 0]
      } as unknown as GameState['employees'][string];
    }
    ready.player.statistics.recentNetProfits = [1200, -300, 900];
    useGameStore.setState({ gameState: { ...ready } });

    expect(useGameStore.getState().hireManager()).toBe(true);
    expect(useGameStore.getState().gameState.station.managerId).toBe('manager_1');
  });
});
