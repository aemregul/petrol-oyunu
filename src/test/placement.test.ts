import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { evaluatePlacement, getFootprint, snapPlacement } from '../domain/services/placement';
import {
  DRIVEWAY_Z,
  WIDE_DRIVEWAY_WIDTH,
  getLayout
} from '../domain/services/simulationEngine';
import { pavedFrontage } from '../domain/services/land';

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

describe('driveway ramps', () => {
  const ready = () => {
    const state = createInitialGameState();
    state.player.level = 10;
    return state;
  };

  it('pins a ramp to the verge however far the pointer strays', () => {
    const state = ready();

    // The pointer was well inside the forecourt; the ramp stays on the road.
    expect(snapPlacement(state, 'wide_entry', [6, 12])[1]).toBe(DRIVEWAY_Z);
    expect(snapPlacement(state, 'wide_entry', [6, -9])[1]).toBe(DRIVEWAY_Z);
  });

  it('slides along the frontage but never off the concrete', () => {
    const state = ready();
    const { maxX } = pavedFrontage(state.station.plots.pavedParcels)!;

    expect(snapPlacement(state, 'wide_entry', [7, 0])[0]).toBe(7);
    expect(snapPlacement(state, 'wide_entry', [-40, 0])[0]).toBe(WIDE_DRIVEWAY_WIDTH / 2);
    expect(snapPlacement(state, 'wide_entry', [999, 0])[0]).toBe(maxX - WIDE_DRIVEWAY_WIDTH / 2);
  });

  it('leaves ordinary structures where the pointer put them', () => {
    const state = ready();
    expect(snapPlacement(state, 'price_sign', [7, 11])).toEqual([7, 11]);
  });

  it('refuses a mouth that would run into the other driveway', () => {
    const state = ready();
    const exitX = getLayout(state).exitX;

    expect(evaluatePlacement(state, 'wide_entry', [exitX, DRIVEWAY_Z], 0).valid).toBe(false);
    expect(evaluatePlacement(state, 'wide_entry', [3, DRIVEWAY_Z], 0).valid).toBe(true);
  });

  it('moves the mouth cars aim at once a wide ramp is built', () => {
    const state = ready();
    const before = getLayout(state);

    state.buildings.ramp = {
      id: 'ramp',
      type: 'wide_entry',
      level: 1,
      position: [6, DRIVEWAY_Z],
      rotation: 0,
      size: [4, 2],
      health: 100,
      constructionState: 'ACTIVE',
      builtAtTimestamp: 0
    };

    const after = getLayout(state);
    expect(before.entryX).not.toBe(6);
    expect(after.entryX).toBe(6);
    // The kerb has to open wider for it, and the exit is left alone.
    expect(after.entryWidth).toBe(WIDE_DRIVEWAY_WIDTH);
    expect(after.exitX).toBe(before.exitX);
    expect(after.exitWidth).toBe(before.exitWidth);
  });
});
