import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState } from '../domain/types/gameState';
import { evaluatePlacement } from '../domain/services/placement';

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

/** The starting station's own petrol tank, standing since day one. */
function theTank(state: GameState, level = 1): string {
  state.buildings.tank_1.level = level;
  return 'tank_1';
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
    theTank(state);
    state.player.level = 3;
    const before = state.tanks.gasoline.capacity;
    useGameStore.setState({ gameState: { ...state } });

    // 3.000 L is a level-4 promise; below it the money must not move.
    expect(useGameStore.getState().upgradeBuilding('tank_1')).toBe(false);

    const ready = useGameStore.getState().gameState;
    ready.player.level = 4;
    useGameStore.setState({ gameState: { ...ready } });
    expect(useGameStore.getState().upgradeBuilding('tank_1')).toBe(true);

    const after = useGameStore.getState().gameState;
    expect(after.buildings.tank_1.level).toBe(2);
    // A level-2 farm holds 3.000 L of each fuel where level-1 held 1.500.
    expect(after.tanks.gasoline.capacity).toBe(before + 1500);
    expect(after.tanks.diesel.capacity).toBe(3000);
    expect(after.tanks.lpg.capacity).toBe(3000);
  });

  it('counts the upgrade money when a tank is valued for sale', () => {
    const plain = useGameStore.getState().structureValue('tank_1');

    const upgraded = useGameStore.getState().gameState;
    upgraded.buildings.tank_1.level = 2;
    useGameStore.setState({ gameState: { ...upgraded } });

    // The 20.000 TL sunk into the level-2 package has to show in the price,
    // the way it always did for pumps and shops.
    expect(useGameStore.getState().structureValue('tank_1')).toBeGreaterThan(plain);
  });

  it('allows one farm, and one expansion only beside a maxed farm', () => {
    const state = useGameStore.getState().gameState;

    // A second farm is never on the menu.
    const second = evaluatePlacement(state, 'tank_farm', [4, 4], 0);
    expect(second.valid).toBe(false);
    expect(second.reason).toContain('Maksimum alım');

    // The expansion waits until the farm has topped out.
    const early = evaluatePlacement(state, 'tank_expansion', [4, 4], 0);
    expect(early.valid).toBe(false);
    expect(early.reason).toContain('Sv3');

    state.buildings.tank_1.level = 3;
    useGameStore.setState({ gameState: { ...state } });
    expect(evaluatePlacement(useGameStore.getState().gameState, 'tank_expansion', [4, 4], 0).valid).toBe(true);
  });

  it('doubles every fuel on buying the expansion, and halves them on selling it', () => {
    const state = useGameStore.getState().gameState;
    state.buildings.tank_1.level = 3;
    state.tanks.gasoline.capacity = 6000;
    state.tanks.diesel.capacity = 6000;
    state.tanks.lpg.capacity = 6000;
    useGameStore.setState({ gameState: { ...state } });

    useGameStore.getState().enterBuildMode('tank_expansion');
    useGameStore.getState().setBuildPreviewPos([4, 4]);
    expect(useGameStore.getState().confirmBuildPlacement()).toBe(true);

    let tanks = useGameStore.getState().gameState.tanks;
    expect(tanks.gasoline.capacity).toBe(12000);
    expect(tanks.diesel.capacity).toBe(12000);
    expect(tanks.lpg.capacity).toBe(12000);

    const expansion = Object.values(useGameStore.getState().gameState.buildings).find(
      (b) => b.type === 'tank_expansion'
    )!;
    expect(useGameStore.getState().sellStructure(expansion.id)).toBe(true);

    tanks = useGameStore.getState().gameState.tanks;
    expect(tanks.gasoline.capacity).toBe(6000);
  });

  it('never lets the farm itself be sold', () => {
    // The farm is the station's storage; selling it would strand every fuel.
    expect(useGameStore.getState().sellStructure('tank_1')).toBe(false);
    expect(useGameStore.getState().gameState.buildings.tank_1).toBeTruthy();
  });

  it('moves a tank without growing it and without resetting its level', () => {
    const state = useGameStore.getState().gameState;
    theTank(state, 2);
    state.tanks.gasoline.capacity = 3000;
    const capacityBefore = state.tanks.gasoline.capacity;
    useGameStore.setState({ gameState: { ...state } });

    expect(useGameStore.getState().relocateStructure('tank_1')).toBe(true);
    useGameStore.getState().setBuildPreviewPos([4, 4]);
    expect(useGameStore.getState().confirmBuildPlacement()).toBe(true);

    const after = useGameStore.getState().gameState;
    const moved = Object.values(after.buildings).find((b) => b.type === 'tank_farm')!;
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

  it('sells nozzles for money, gated only by the promised levels', () => {
    const state = useGameStore.getState().gameState;
    state.player.level = 2;
    useGameStore.setState({ gameState: { ...state } });

    // Diesel opens at level 3; below it the module is not for sale.
    expect(useGameStore.getState().addPumpFuel('pump_1', 'diesel')).toBe(false);

    const ready = useGameStore.getState().gameState;
    ready.player.level = 3;
    useGameStore.setState({ gameState: { ...ready } });

    const cashBefore = useGameStore.getState().gameState.player.cash;
    expect(useGameStore.getState().addPumpFuel('pump_1', 'diesel')).toBe(true);

    const after = useGameStore.getState().gameState;
    expect(after.pumps.pump_1.supportedFuels).toContain('diesel');
    expect(after.player.cash).toBe(cashBefore - GAME_CONFIG.pumpFuelModules.diesel.cost);

    // Already fitted: the same money cannot be taken twice.
    expect(useGameStore.getState().addPumpFuel('pump_1', 'diesel')).toBe(false);
  });

  it('no longer bundles fuels into the speed ladder', () => {
    const state = useGameStore.getState().gameState;
    state.player.level = 12;
    useGameStore.setState({ gameState: { ...state } });

    expect(useGameStore.getState().upgradePump('pump_1')).toBe(true);
    expect(useGameStore.getState().upgradePump('pump_1')).toBe(true);

    // S3 pump, still petrol-only: reach is bought at the nozzle, not the ladder.
    const pump = useGameStore.getState().gameState.pumps.pump_1;
    expect(pump.level).toBe(3);
    expect(pump.supportedFuels).toEqual(['gasoline']);
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

    // The day rolls straight into the next morning, so the wage shows in the
    // closed day's recorded net: nothing sold, the manager still got paid.
    const after = useGameStore.getState().gameState;
    const closedDayNet = after.player.statistics.recentNetProfits?.at(-1) ?? 0;
    expect(closedDayNet).toBeLessThanOrEqual(-GAME_CONFIG.employees.manager.dailyWage);
    // And the game did not stop: the new day is already running.
    expect(after.dayState.isDayActive).toBe(true);
    expect(after.dayState.currentDay).toBe(2);
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
