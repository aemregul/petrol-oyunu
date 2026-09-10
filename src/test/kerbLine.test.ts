import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  blockLayout,
  blockedWays,
  hasWayIn,
  FORECOURT_FRONT
} from '../domain/services/simulationEngine';
import { evaluatePlacement, snapPlacement } from '../domain/services/placement';
import { NEAR_SIDE_FRONT, onKerbLine } from '../domain/services/land';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState } from '../domain/types/gameState';

/**
 * Emre, 2026-09-10: a lamp post should be able to stand ON the kerb — not in
 * the grass in front of the concrete, nor in the cell behind it, but straddling
 * the line between them, the way a forecourt is lit in the game this one takes
 * after. Standing there it takes no ground: no phantom band, nothing narrowed,
 * and cars drive past it as if it were not there.
 *
 * Nothing else about placement changes. The driveway reserve still keeps the
 * mouth throats clear, and a pole out on the apron is the obstacle it always
 * was — the line is the privilege, not the pole.
 */

function plot(): GameState {
  const state = createInitialGameState();
  state.player.level = 99;
  return state;
}

function planted(state: GameState, at: [number, number]): GameState {
  state.buildings.pole = {
    id: 'pole',
    type: 'light_pole',
    level: 1,
    position: at,
    rotation: 0,
    size: GAME_CONFIG.buildings.light_pole.size,
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0
  } as GameState['buildings'][string];
  return state;
}

describe('a lamp post on the kerb line', () => {
  it('takes the front line when the pointer is brought near it', () => {
    const state = plot();
    // From the grass side and from the concrete side alike.
    for (const pointer of [0.8, 1, 1.4]) {
      const at = snapPlacement(state, 'light_pole', [8.5, pointer]);
      expect(at[1], `imleç z=${pointer}`).toBe(NEAR_SIDE_FRONT);
      expect(onKerbLine(state.station.plots, at, 'near')).toBe(true);
      expect(evaluatePlacement(state, 'light_pole', at, 0).valid).toBe(true);
    }
  });

  it('does the same on every other edge of the plot, not just the road one', () => {
    // Emre, 2026-09-10: "tüm arsa çevresine izin vermesini istiyorum".
    const state = plot();
    const { width, height } = state.station.plots;
    const edges: Array<{ name: string; pointer: [number, number]; at: [number, number] }> = [
      { name: 'sol kenar', pointer: [0.4, 8], at: [0, 8] },
      { name: 'sağ kenar', pointer: [width - 0.4, 8], at: [width, 8] },
      { name: 'arka kenar', pointer: [8.5, height - 0.4], at: [8.5, height] }
    ];

    for (const edge of edges) {
      const snapped = snapPlacement(state, 'light_pole', edge.pointer);
      expect(snapped, edge.name).toEqual(edge.at);
      expect(onKerbLine(state.station.plots, snapped, 'near'), edge.name).toBe(true);
      expect(evaluatePlacement(state, 'light_pole', snapped, 0).valid, edge.name).toBe(true);
    }
  });

  it('does not let a corner line run on out into the countryside', () => {
    // Sol kenar çizgisi arsanın boyu kadardır: önünde ve arkasında biter.
    const state = plot();
    expect(onKerbLine(state.station.plots, [0, -4], 'near')).toBe(false);
    expect(onKerbLine(state.station.plots, [0, state.station.plots.height + 4], 'near')).toBe(false);
    expect(onKerbLine(state.station.plots, [-6, 8], 'near')).toBe(false);
  });

  it('still leaves the band behind the line, and the grass in front of it', () => {
    const state = plot();
    // Kept: the cell of concrete poles have always been able to use.
    expect(snapPlacement(state, 'light_pole', [8.5, 1.7])[1]).toBe(1.5);
    expect(evaluatePlacement(state, 'light_pole', [8.5, 1.5], 0).valid).toBe(true);
    // Kept: the verge itself is still no place for a building.
    const onGrass = evaluatePlacement(state, 'light_pole', [8.5, 0.5], 0);
    expect(onGrass.valid).toBe(false);
    expect(onGrass.reason).toMatch(/banket/i);
  });

  it('narrows nothing while it stands there', () => {
    const state = plot();
    const block = blockLayout(state, 'near')!;
    expect(blockedWays(state, 'near')).toEqual([]);

    planted(state, [8.5, NEAR_SIDE_FRONT]);

    expect(blockedWays(state, 'near')).toEqual([]);
    expect(hasWayIn(state, block, 'near')).toBe(true);
  });

  it('is an obstacle again the moment it stands on the apron', () => {
    // The same pole one band deeper, where it has always blocked the way in.
    const state = planted(plot(), [2.5, 4.5]);
    expect(blockedWays(state, 'near')).toContain('CUSTOMERS');
  });

  it('leaves the driveway reserve exactly as it was', () => {
    const state = plot();
    const block = blockLayout(state, 'near')!;
    // The mouth throat refuses a pole on the line as it refuses everything.
    const inMouth = evaluatePlacement(
      state,
      'light_pole',
      snapPlacement(state, 'light_pole', [block.entry.x, NEAR_SIDE_FRONT]),
      0
    );
    expect(inMouth.valid).toBe(false);
    expect(inMouth.reason).toMatch(/rezerv/i);
  });

  it('keeps the kerb line the pathfinder uses in step with the engine', () => {
    // land.ts writes this number out so the pathfinder need not import the
    // engine back; if they drift, the rule quietly lands on the wrong row.
    expect(NEAR_SIDE_FRONT).toBe(FORECOURT_FRONT);
  });
});
