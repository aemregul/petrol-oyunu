import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  evaluatePlacement,
  getFootprint,
  snapPlacement,
  absorbedByRestComplex
} from '../domain/services/placement';
import {
  DRIVEWAY_WIDTH,
  DRIVEWAY_Z,
  FAR_DRIVEWAY_Z,
  WIDE_DRIVEWAY_WIDTH,
  drivewayLaneX,
  drivewayMouths,
  defaultMouthX,
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

describe('structures', () => {
  const ready = () => {
    const state = createInitialGameState();
    state.player.level = 12;
    return state;
  };

  it('lets a canopy stand over a pump, and nothing else overlap one', () => {
    const state = ready();
    const pump = Object.values(state.pumps)[0];

    // A roof over the island is the whole point of the thing.
    expect(evaluatePlacement(state, 'canopy', pump.position, 0).valid).toBe(true);
    // But it has to be over a pump, not parked on spare concrete.
    expect(evaluatePlacement(state, 'canopy', [3, 3], 0).valid).toBe(false);
    // Everything else still keeps its distance.
    expect(evaluatePlacement(state, 'mini_market', pump.position, 0).valid).toBe(false);
  });

  it('builds a rest complex over the parade it replaces', () => {
    const state = ready();
    state.buildings = {
      mk: {
        id: 'mk', type: 'mini_market', level: 1, position: [4, 9], rotation: 0,
        size: [5, 5], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
      },
      wc: {
        id: 'wc', type: 'toilet', level: 1, position: [11, 9], rotation: 0,
        size: [2, 2], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
      }
    };
    state.pumps = {};

    const absorbed = absorbedByRestComplex(state, 'near').map((b) => b.id).sort();
    expect(absorbed).toEqual(['mk', 'wc']);

    // Those units are not obstacles to it: it is built over them, and asking
    // the player to demolish first would cost them the money twice.
    expect(evaluatePlacement(state, 'rest_complex', [7, 9], 0).valid).toBe(true);
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
    expect(snapPlacement(state, 'wide_entry', [6, 2])[1]).toBe(DRIVEWAY_Z);
  });

  it('follows the pointer across the road onto the far verge', () => {
    const state = ready();

    expect(snapPlacement(state, 'wide_entry', [6, -20])[1]).toBe(FAR_DRIVEWAY_Z);
    expect(FAR_DRIVEWAY_Z).toBeLessThan(DRIVEWAY_Z);
  });

  it('opens the far mouth only once the road carries two carriageways', () => {
    const state = ready();
    state.station.plots.ownedParcels.push('0,-1', '1,-1');
    state.station.plots.pavedParcels.push('0,-1', '1,-1');

    // Clear of the far block's own exit, which sits at the other end.
    const at: [number, number] = [8, FAR_DRIVEWAY_Z];
    expect(evaluatePlacement(state, 'wide_entry', at, 0).valid).toBe(false);

    state.station.roadLevel = 2;
    expect(evaluatePlacement(state, 'wide_entry', at, 0).valid).toBe(true);
  });

  it('lets the two mouths sit flush side by side, but never overlap', () => {
    const state = ready();
    const exitX = getLayout(state).exitX;

    // Flush against the default exit: touching is allowed, a hair closer is not.
    const flush = exitX - (WIDE_DRIVEWAY_WIDTH + DRIVEWAY_WIDTH) / 2;
    expect(evaluatePlacement(state, 'wide_entry', [flush, DRIVEWAY_Z], 0).valid).toBe(true);
    expect(evaluatePlacement(state, 'wide_entry', [flush + 1, DRIVEWAY_Z], 0).valid).toBe(false);
  });

  it('always leaves each block one way in and one way out', () => {
    const state = ready();
    state.station.roadLevel = 2;
    state.station.plots.ownedParcels.push('0,-1', '1,-1');
    state.station.plots.pavedParcels.push('0,-1', '1,-1');

    // Traffic across the road runs the other way, so the far block meets the
    // two openings in the opposite order: its entrance is the downstream one.
    const near = drivewayMouths(state, 'near');
    const far = drivewayMouths(state, 'far');
    expect(far.entry.x).toBe(near.exit.x);
    expect(far.exit.x).toBe(near.entry.x);

    // Widening the far entrance must not cost that block its exit.
    state.buildings.ramp = {
      id: 'ramp',
      type: 'wide_entry',
      level: 1,
      position: [5, FAR_DRIVEWAY_Z],
      rotation: 0,
      size: [6, 2],
      health: 100,
      constructionState: 'ACTIVE',
      builtAtTimestamp: 0
    };

    const widened = drivewayMouths(state, 'far');
    expect(widened.entry.x).toBe(5);
    expect(widened.entry.width).toBe(WIDE_DRIVEWAY_WIDTH);
    expect(widened.exit).toEqual(far.exit);
    // The near block is untouched by a ramp built across the road.
    expect(drivewayMouths(state, 'near')).toEqual(near);
  });

  it('gives each role its own default opening on each side of the road', () => {
    // The crux of it: a wide entrance must take over the entrance, never the
    // exit. Across the road the two swap places, because traffic does.
    expect(defaultMouthX('entry', 'near', 16)).toBe(defaultMouthX('exit', 'far', 16));
    expect(defaultMouthX('exit', 'near', 16)).toBe(defaultMouthX('entry', 'far', 16));
    expect(defaultMouthX('entry', 'near', 16)).not.toBe(defaultMouthX('exit', 'near', 16));
  });

  it('splits a widened mouth into two lanes and alternates arrivals', () => {
    const narrow = { x: 6, width: DRIVEWAY_WIDTH, z: DRIVEWAY_Z };
    const wide = { x: 6, width: WIDE_DRIVEWAY_WIDTH, z: DRIVEWAY_Z };

    // One lane: everyone drives down the middle of it.
    expect(drivewayLaneX(narrow, 0)).toBe(6);
    expect(drivewayLaneX(narrow, 1)).toBe(6);

    // Two lanes, one either side of the centre line, used in turn.
    expect(drivewayLaneX(wide, 0)).toBe(6 - WIDE_DRIVEWAY_WIDTH / 4);
    expect(drivewayLaneX(wide, 1)).toBe(6 + WIDE_DRIVEWAY_WIDTH / 4);
    expect(drivewayLaneX(wide, 2)).toBe(drivewayLaneX(wide, 0));
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
