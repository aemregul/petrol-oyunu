import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState, BuildingEntity, PumpEntity } from '../domain/types/gameState';
import { foldCanopiesIntoPumps, useGameStore } from '../store/gameStore';
import { isUnderCanopy, dispenseStep } from '../domain/services/simulationEngine';
import { evaluatePlacement } from '../domain/services/placement';

/**
 * The canopy stopped being a building the player parks over an island and
 * became part of the island itself. These cover the seams that move created:
 * the conversion of saves written under the old rules, and every place the
 * old code asked the buildings collection a question a pump now answers.
 */

function canopyBuilding(
  id: string,
  position: [number, number],
  rotation: 0 | 90 | 180 | 270 = 0
): BuildingEntity {
  return {
    id,
    type: 'canopy',
    level: 1,
    position,
    rotation,
    size: GAME_CONFIG.buildings.canopy.size,
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0
  } as BuildingEntity;
}

function pumpAt(id: string, position: [number, number]): PumpEntity {
  return {
    id,
    level: 1,
    position,
    rotation: 0,
    supportedFuels: ['gasoline'],
    state: 'IDLE',
    health: 100,
    employeeId: null,
    currentVehicleId: null,
    flowRateLps: 8
  };
}

describe('canopies belong to the pump they roof', () => {
  it('hands an old save\'s canopy to every island it covered, and removes it', () => {
    const state = createInitialGameState();
    const first = Object.values(state.pumps)[0];

    state.buildings[`c1`] = canopyBuilding('c1', first.position);
    const cashBefore = state.player.cash;

    foldCanopiesIntoPumps(state);

    expect(state.pumps[first.id].hasCanopy).toBe(true);
    expect(Object.values(state.buildings).some((b) => b.type === 'canopy')).toBe(false);
    // A converted canopy is neither charged for again nor refunded.
    expect(state.player.cash).toBe(cashBefore);
  });

  it('gives a canopy that covered several islands a roof each', () => {
    const state = createInitialGameState();
    state.pumps = {
      a: pumpAt('a', [8, 8]),
      b: pumpAt('b', [10, 8]),
      // Well clear of the roof, so it must stay bare.
      far: pumpAt('far', [20, 8])
    };
    // Wide enough to sit over both neighbours at once.
    const wide = canopyBuilding('c1', [9, 8]);
    wide.size = [6, 5];
    state.buildings.c1 = wide;

    foldCanopiesIntoPumps(state);

    expect(state.pumps.a.hasCanopy).toBe(true);
    expect(state.pumps.b.hasCanopy).toBe(true);
    expect(state.pumps.far.hasCanopy).toBeFalsy();
  });

  it('refunds a canopy whose pumps were all sold off', () => {
    const state = createInitialGameState();
    state.pumps = { far: pumpAt('far', [20, 8]) };
    state.buildings.orphan = canopyBuilding('orphan', [4, 4]);
    const cashBefore = state.player.cash;

    foldCanopiesIntoPumps(state);

    expect(state.buildings.orphan).toBeUndefined();
    expect(state.pumps.far.hasCanopy).toBeFalsy();
    expect(state.player.cash).toBeGreaterThan(cashBefore);
  });

  it('does nothing the second time it runs', () => {
    const state = createInitialGameState();
    const first = Object.values(state.pumps)[0];
    state.buildings.c1 = canopyBuilding('c1', first.position);

    foldCanopiesIntoPumps(state);
    const afterFirst = JSON.parse(JSON.stringify(state)) as GameState;
    foldCanopiesIntoPumps(state);

    // Every load runs this, so a second pass must not pay out again.
    expect(state.player.cash).toBe(afterFirst.player.cash);
    expect(state).toEqual(afterFirst);
  });

  it('no longer lets any structure be built on top of an island', () => {
    const state = createInitialGameState();
    state.player.level = 12;
    const pump = Object.values(state.pumps)[0];

    // The canopy was the one structure exempt from the overlap rule.
    expect(evaluatePlacement(state, 'canopy', pump.position, 0).valid).toBe(false);
  });
});

describe('what a roof is worth', () => {
  it('reads the roof off the pump rather than the buildings around it', () => {
    const bare = pumpAt('a', [8, 8]);
    const roofed = { ...pumpAt('b', [8, 8]), hasCanopy: true };

    expect(isUnderCanopy(bare)).toBe(false);
    expect(isUnderCanopy(roofed)).toBe(true);
  });

  it('fills faster under a roof', () => {
    const measure = (hasCanopy: boolean): number => {
      const state = createInitialGameState();
      const pump = Object.values(state.pumps)[0];
      pump.hasCanopy = hasCanopy;
      pump.state = 'FUELING';

      const vehicle = {
        id: 'v1',
        state: 'FUELING',
        targetPumpId: pump.id,
        request: { calculatedLiters: 500, dispensedLiters: 0, isFinished: false }
      } as never;
      state.vehicles = { v1: vehicle };

      dispenseStep(state, state.vehicles.v1, 1, { sounds: [] } as never);
      return state.vehicles.v1.request.dispensedLiters;
    };

    const plain = measure(false);
    const sheltered = measure(true);
    expect(sheltered).toBeGreaterThan(plain);
    expect(sheltered / plain).toBeCloseTo(1.05, 5);
  });
});

/** The store reaches for the browser on any action that makes a sound. */
function stubBrowser(): void {
  (globalThis as any).window = {};
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  };
}

describe('buying and selling a roof', () => {
  beforeEach(() => {
    stubBrowser();
    const state = createInitialGameState();
    state.player.level = 12;
    state.player.cash = 500_000;
    useGameStore.setState({
      gameState: state,
      fittingCanopy: false,
      selectedPumpId: null,
      buildMode: { ...useGameStore.getState().buildMode, active: false }
    });
  });

  it('charges for a canopy and fits it to the chosen island', () => {
    const store = useGameStore.getState();
    const pump = Object.values(store.gameState.pumps)[0];
    const cashBefore = store.gameState.player.cash;

    expect(store.fitCanopy(pump.id)).toBe(true);

    const after = useGameStore.getState().gameState;
    expect(after.pumps[pump.id].hasCanopy).toBe(true);
    expect(after.player.cash).toBe(cashBefore - GAME_CONFIG.buildings.canopy.price);
  });

  it('refuses to fit a second roof to the same island', () => {
    const store = useGameStore.getState();
    const pump = Object.values(store.gameState.pumps)[0];
    store.fitCanopy(pump.id);

    const cashAfterFirst = useGameStore.getState().gameState.player.cash;
    expect(useGameStore.getState().fitCanopy(pump.id)).toBe(false);
    expect(useGameStore.getState().gameState.player.cash).toBe(cashAfterFirst);
  });

  it('will not fit one that cannot be paid for', () => {
    const broke = JSON.parse(
      JSON.stringify(useGameStore.getState().gameState)
    ) as GameState;
    broke.player.cash = 10;
    useGameStore.setState({ gameState: broke });

    const pump = Object.values(broke.pumps)[0];
    expect(useGameStore.getState().fitCanopy(pump.id)).toBe(false);
    expect(useGameStore.getState().gameState.pumps[pump.id].hasCanopy).toBeFalsy();
  });

  it('pays something back when the roof comes off', () => {
    const store = useGameStore.getState();
    const pump = Object.values(store.gameState.pumps)[0];
    store.fitCanopy(pump.id);

    const cashBefore = useGameStore.getState().gameState.player.cash;
    expect(useGameStore.getState().removeCanopy(pump.id)).toBe(true);

    const after = useGameStore.getState().gameState;
    expect(after.pumps[pump.id].hasCanopy).toBeFalsy();
    expect(after.player.cash).toBeGreaterThan(cashBefore);
  });

  it('counts the roof towards what the pump sells for', () => {
    const store = useGameStore.getState();
    const pump = Object.values(store.gameState.pumps)[0];
    const bareValue = store.structureValue(pump.id);

    store.fitCanopy(pump.id);
    const roofedValue = useGameStore.getState().structureValue(pump.id);

    expect(roofedValue).toBeGreaterThan(bareValue);
  });
});
