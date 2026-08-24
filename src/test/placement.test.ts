import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { evaluatePlacement, getFootprint } from '../domain/services/placement';

describe('placement rules', () => {
  it('measures a footprint around the position centre', () => {
    const fp = getFootprint([10, 10], [2, 4], 0);
    expect(fp).toEqual({ minX: 9, minZ: 8, maxX: 11, maxZ: 12 });
  });

  it('swaps width and depth on a quarter turn', () => {
    const fp = getFootprint([10, 10], [2, 4], 90);
    expect(fp).toEqual({ minX: 8, minZ: 9, maxX: 12, maxZ: 11 });
  });

  it('rejects a structure hanging off the plot edge', () => {
    const state = createInitialGameState();
    state.player.level = 10;

    expect(evaluatePlacement(state, 'price_sign', [0, 10], 0).valid).toBe(false);
    expect(evaluatePlacement(state, 'price_sign', [10, 10], 0).valid).toBe(true);

    const { width } = state.station.plots;
    expect(evaluatePlacement(state, 'price_sign', [width, 10], 0).valid).toBe(false);
  });

  it('rejects a structure overlapping the existing pump', () => {
    const state = createInitialGameState();
    state.player.level = 10;
    const pumpPos = state.pumps.pump_1.position;

    const onTop = evaluatePlacement(state, 'price_sign', [pumpPos[0], pumpPos[1]], 0);
    expect(onTop.valid).toBe(false);
    expect(onTop.reason).toContain('Pompa');

    // Clear of the pump's 2x3 footprint.
    expect(evaluatePlacement(state, 'price_sign', [pumpPos[0] + 4, pumpPos[1]], 0).valid).toBe(true);
  });

  it('keeps level gates in force', () => {
    const state = createInitialGameState();
    const locked = evaluatePlacement(state, 'mini_market', [12, 16], 0);
    expect(locked.valid).toBe(false);
    expect(locked.reason).toContain('Seviye');
  });

});

describe('placement — paving', () => {
  it('refuses to build on owned land that has not been paved', () => {
    const state = createInitialGameState();
    state.player.level = 10;

    // Buy a neighbouring parcel without paving it.
    state.station.plots.ownedParcels.push('2,0');

    // Grid x 16..24 is the new parcel: owned, but bare.
    const onBareLand = evaluatePlacement(state, 'price_sign', [20, 3], 0);
    expect(onBareLand.valid).toBe(false);
    expect(onBareLand.reason).toContain('beton');

    state.station.plots.pavedParcels.push('2,0');
    expect(evaluatePlacement(state, 'price_sign', [20, 3], 0).valid).toBe(true);
  });
});
