import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState, BuildingEntity } from '../domain/types/gameState';
import { DRIVEWAY_Z, drivewayRole } from '../domain/services/simulationEngine';
import { evaluatePlacement } from '../domain/services/placement';

/**
 * Every structure on the forecourt has to survive being picked up and put back
 * down. The move flow lifts the entity out of state and rebuilds it from what
 * it was carrying, so a type the flow does not know about is a type the player
 * loses the moment they touch it.
 */

/** A plot big enough to hold anything in the catalogue, with money to spare. */
function ready(): GameState {
  const state = createInitialGameState();
  state.player.cash = 5_000_000;
  state.player.level = 20;
  state.station.roadLevel = 2;
  // The expansion only places beside a maxed farm.
  state.buildings.tank_1.level = 3;

  for (let col = 0; col <= 3; col++) {
    for (let row = 0; row <= 3; row++) {
      const key = `${col},${row}`;
      if (!state.station.plots.ownedParcels.includes(key)) {
        state.station.plots.ownedParcels.push(key);
      }
      if (!state.station.plots.pavedParcels.includes(key)) {
        state.station.plots.pavedParcels.push(key);
      }
    }
  }
  return state;
}

/**
 * The first spot on the plot the rules accept for this type. Found rather than
 * guessed: what a canopy, a ramp and a hotel each need is different, and a
 * hand-picked coordinate would only be testing the coordinate.
 */
function legalSpot(state: GameState, type: string): [number, number] {
  // Ramps belong on the verge, and only certain x positions are mouths.
  const rows = drivewayRole(type) ? [DRIVEWAY_Z] : [4, 6, 8, 10, 12, 14, 16, 18];

  for (const z of rows) {
    for (let x = 2; x <= 22; x += 1) {
      const at: [number, number] = [x, z];
      if (evaluatePlacement(state, type, at, 0).valid) return at;
    }
  }

  throw new Error(`${type} için arsada geçerli konum bulunamadı`);
}

function put(state: GameState, type: string, position: [number, number]): string {
  const id = `test_${type}`;
  state.buildings[id] = {
    id,
    type,
    level: 1,
    position,
    rotation: 0,
    size: GAME_CONFIG.buildings[type].size,
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0
  } as BuildingEntity;
  return id;
}

beforeEach(() => {
  // The store is UI code: most actions play a click and write a save. Neither
  // exists in a node test, so both are stubbed rather than mocked away — the
  // point of these tests is to run the real move flow, not a stand-in.
  (globalThis as any).window = {};
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  };

  useGameStore.setState({
    gameState: ready(),
    buildMode: { active: false, buildingType: null, pinned: false, position: [0, 0], pointer: [0, 0], rotation: 0, isValid: true },
    relocating: null,
    editMode: true
  });
});

describe('relocating structures', () => {
  const types = Object.keys(GAME_CONFIG.buildings).filter(
    (t) => GAME_CONFIG.buildings[t].category !== 'pump'
  );

  it.each(types)('picks %s up and puts it back down', (type) => {
    const state = useGameStore.getState().gameState;

    // Some of these come with the station. Move the one that is already
    // there rather than adding a second the rules would reject anyway.
    const existing = Object.values(state.buildings).find((b) => b.type === type);
    const id = existing ? existing.id : put(state, type, legalSpot(state, type));
    useGameStore.setState({ gameState: { ...state } });

    expect(useGameStore.getState().relocateStructure(id)).toBe(true);
    expect(useGameStore.getState().buildMode.active).toBe(true);
    expect(useGameStore.getState().gameState.buildings[id]).toBeUndefined();

    expect(useGameStore.getState().confirmBuildPlacement()).toBe(true);

    const rebuilt = Object.values(useGameStore.getState().gameState.buildings).filter(
      (b) => b.type === type
    );
    expect(rebuilt.length).toBe(1);
    expect(useGameStore.getState().relocating).toBeNull();
  });

  it('carries a pump’s grades, wear and attendant to its new bay', () => {
    const state = useGameStore.getState().gameState;
    const pump = state.pumps.pump_1;
    pump.supportedFuels = ['gasoline', 'diesel'];
    pump.level = 3;
    pump.health = 61;
    pump.flowRateLps = 13;
    useGameStore.setState({ gameState: { ...state } });

    expect(useGameStore.getState().relocateStructure('pump_1')).toBe(true);
    expect(useGameStore.getState().gameState.pumps.pump_1).toBeUndefined();
    expect(useGameStore.getState().relocating?.pump?.supportedFuels).toEqual([
      'gasoline',
      'diesel'
    ]);

    useGameStore.getState().setBuildPreviewPos([12, 6]);
    expect(useGameStore.getState().confirmBuildPlacement()).toBe(true);

    const pumps = Object.values(useGameStore.getState().gameState.pumps);
    expect(pumps.length).toBe(1);
    expect(pumps[0].level).toBe(3);
    expect(pumps[0].health).toBe(61);
    expect(pumps[0].flowRateLps).toBe(13);
    expect(pumps[0].supportedFuels).toEqual(['gasoline', 'diesel']);
  });

  it('puts a cancelled move back exactly where it came from', () => {
    const state = useGameStore.getState().gameState;
    const origin: [number, number] = [10, 8];
    const id = put(state, 'mini_market', origin);
    useGameStore.setState({ gameState: { ...state } });

    useGameStore.getState().relocateStructure(id);
    useGameStore.getState().setBuildPreviewPos([4, 4]);
    useGameStore.getState().exitBuildMode();

    const back = Object.values(useGameStore.getState().gameState.buildings).find(
      (b) => b.type === 'mini_market'
    );
    expect(back?.position).toEqual(origin);
  });

  it('puts a cancelled pump move back as a pump, not a building', () => {
    useGameStore.getState().relocateStructure('pump_1');
    useGameStore.getState().exitBuildMode();

    const pumps = Object.values(useGameStore.getState().gameState.pumps);
    expect(pumps.length).toBe(1);
    expect(
      Object.values(useGameStore.getState().gameState.buildings).some(
        (b) => b.type === 'pump_standard'
      )
    ).toBe(false);
  });
});
