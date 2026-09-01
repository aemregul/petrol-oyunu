import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GAME_CONFIG } from '../config/gameConfig';
import {
  evaluatePlacement,
  getFootprint,
  snapPlacement,
  absorbedByRestComplex,
  PYLON_REACH
} from '../domain/services/placement';
import {
  DRIVEWAY_WIDTH,
  DRIVEWAY_Z,
  FAR_DRIVEWAY_Z,
  WIDE_DRIVEWAY_WIDTH,
  drivewayLaneX,
  drivewayMouths,
  defaultMouthX,
  syncPriceSign,
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

    expect(evaluatePlacement(state, 'trash_can', [0, 10], 0).valid).toBe(false);
    expect(evaluatePlacement(state, 'trash_can', [10, 10], 0).valid).toBe(true);

    const { width } = state.station.plots;
    expect(evaluatePlacement(state, 'trash_can', [width, 10], 0).valid).toBe(false);
  });

  it('rejects a structure overlapping the existing pump', () => {
    const state = createInitialGameState();
    state.player.level = 10;
    const pumpPos = state.pumps.pump_1.position;

    const onTop = evaluatePlacement(state, 'trash_can', [pumpPos[0], pumpPos[1]], 0);
    expect(onTop.valid).toBe(false);
    expect(onTop.reason).toContain('Pompa');

    // Clear of the pump's 2x3 footprint.
    expect(evaluatePlacement(state, 'trash_can', [pumpPos[0] + 4, pumpPos[1]], 0).valid).toBe(true);
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
    const onBareLand = evaluatePlacement(state, 'trash_can', [20, 3], 0);
    expect(onBareLand.valid).toBe(false);
    expect(onBareLand.reason).toContain('beton');

    state.station.plots.pavedParcels.push('2,0');
    expect(evaluatePlacement(state, 'trash_can', [20, 3], 0).valid).toBe(true);
  });
});

describe('structures', () => {
  const ready = () => {
    const state = createInitialGameState();
    state.player.level = 12;
    return state;
  };

  it('keeps every structure off the pump islands', () => {
    const state = ready();
    const pump = Object.values(state.pumps)[0];

    // The canopy used to be the one exception, allowed to share ground with
    // the island it roofed. Roofs belong to the pump now, so the forecourt
    // has no overlap exemptions left at all.
    expect(evaluatePlacement(state, 'mini_market', pump.position, 0).valid).toBe(false);
    expect(evaluatePlacement(state, 'canopy', pump.position, 0).valid).toBe(false);
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

describe('signage', () => {
  const ready = () => {
    const state = createInitialGameState();
    state.player.level = 12;
    return state;
  };

  it('keeps the price board on its mark between the two mouths', () => {
    const state = ready();
    const mouths = drivewayMouths(state, 'near');

    syncPriceSign(state);
    const sign = Object.values(state.buildings).find((b) => b.type === 'price_sign')!;
    expect(sign.position[0]).toBeCloseTo((mouths.entry.x + mouths.exit.x) / 2, 1);
    expect(sign.position[1]).toBe(DRIVEWAY_Z);

    // Widen the plot and the exit moves, so the board moves with it.
    state.station.plots.width = 32;
    syncPriceSign(state);
    const widened = drivewayMouths(state, 'near');
    expect(sign.position[0]).toBeCloseTo((widened.entry.x + widened.exit.x) / 2, 1);

    // It is the station's own equipment, so there is nothing to buy — but the
    // one that exists can be picked up and slid along the frontage.
    expect(GAME_CONFIG.buildings.price_sign.fixed).toBe(true);

    // Along the verge between the mouths is the whole of where it may go: the
    // board is there to be read from the carriageway, so back on the concrete
    // it would face the forecourt and eat a bay's worth of ground.
    const onVerge = snapPlacement(state, 'price_sign', [
      (widened.entry.x + widened.exit.x) / 2,
      DRIVEWAY_Z
    ]);
    delete state.buildings[sign.id];
    expect(evaluatePlacement(state, 'price_sign', onVerge, 0).valid).toBe(true);

    // Deep on the concrete, and out past a ramp, are both refused.
    expect(evaluatePlacement(state, 'price_sign', [onVerge[0], 10], 0).valid).toBe(false);
    expect(
      evaluatePlacement(state, 'price_sign', [widened.entry.x, onVerge[1]], 0).valid
    ).toBe(false);

    state.buildings[sign.id] = sign;

    // Once the player has chosen a spot, the layout stops overruling them.
    sign.movedByPlayer = true;
    sign.position = [10, 10];
    state.station.plots.width = 40;
    syncPriceSign(state);
    expect(sign.position).toEqual([10, 10]);
  });

  it('lets the pylon overhang the plot, but not by much and never onto the road', () => {
    const state = ready();
    const { width } = state.station.plots;

    // On the plot, and a couple of units past its edge.
    expect(evaluatePlacement(state, 'pylon_sign', [12, 6], 0).valid).toBe(true);
    expect(evaluatePlacement(state, 'pylon_sign', [width + 1, 6], 0).valid).toBe(true);

    // Any further out and it is a sign in a field.
    expect(evaluatePlacement(state, 'pylon_sign', [width + 1 + PYLON_REACH, 6], 0).valid).toBe(false);

    // And it may never stand in the carriageway.
    expect(evaluatePlacement(state, 'pylon_sign', [12, -2], 0).valid).toBe(false);
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

  it('keeps ordinary structures off the frontage strip, on both blocks', () => {
    const state = ready();

    // Near block: the concrete starts one cell behind the plot's front
    // boundary; the strip in front of that line is verge.
    expect(evaluatePlacement(state, 'trash_can', [10.5, 0.5], 0).valid).toBe(false);
    expect(evaluatePlacement(state, 'trash_can', [10.5, 1.5], 0).valid).toBe(true);
    // A deep footprint dipping into the strip is refused; flush with it is not.
    expect(evaluatePlacement(state, 'pump_standard', [10, 1.5], 0).valid).toBe(false);
    expect(evaluatePlacement(state, 'pump_standard', [10, 2.5], 0).valid).toBe(true);

    // Far block: its concrete already ends on the parcel boundary, and the
    // parcel checks alone cannot police an overhang — parcelAt folds the road
    // corridor into row 0, which is owned and paved.
    state.station.roadLevel = 2;
    state.station.plots.ownedParcels.push('0,-1', '1,-1');
    state.station.plots.pavedParcels.push('0,-1', '1,-1');
    expect(evaluatePlacement(state, 'trash_can', [10.5, -13.5], 0).valid).toBe(false);
    expect(evaluatePlacement(state, 'trash_can', [10.5, -14.5], 0).valid).toBe(true);

    // The verge is still the signs' ground: the strip rule must not catch them.
    expect(evaluatePlacement(state, 'price_sign', [10, 0], 0).valid).toBe(true);
  });

  it('lands an ordinary structure squarely on the grid, whatever its size', () => {
    const state = ready();

    // Positions are footprint centres, so where the centre belongs depends on
    // the footprint's parity: an even one centres on a grid line, an odd one
    // in the middle of a square. Either way the edges come out on the lines.
    const bin = snapPlacement(state, 'trash_can', [7, 11]); // 1x1
    expect(bin).toEqual([7.5, 11.5]);

    // A pump is 2 wide and 3 deep, so the two axes snap differently.
    expect(GAME_CONFIG.buildings.pump_standard.size).toEqual([2, 3]);
    expect(snapPlacement(state, 'pump_standard', [7.4, 11.6])).toEqual([7, 11.5]);

    // A quarter turn swaps the footprint, and the snapping swaps with it.
    expect(snapPlacement(state, 'pump_standard', [7.4, 11.6], 90)).toEqual([7.5, 12]);
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
