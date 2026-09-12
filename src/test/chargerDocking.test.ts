import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { VehicleEntity } from '../domain/types/gameState';
import { blockLayout, createEffects, runSimulationTick } from '../domain/services/simulationEngine';
import { GAME_CONFIG } from '../config/gameConfig';

/**
 * Elektrikli müşteri şarj direğine gerçekten YANAŞIR — atanmakla kalmaz.
 *
 * Kota kurbanı bir denetçi ajanının yarım bıraktığı sondadan doğdu: bay
 * noktası park marjıyla (apron 2.5) betona kırpılınca, kenara yakın bir
 * direğin bay'i direğin dibine biniyordu; araç yanaşırken gövdesi direğe
 * girdiği için katı yapı kuralı her adımı geri aldı ve müşteri şarjın yarım
 * metre önünde sonsuza dek asılı kaldı (2000 oyun-saniyesinde 0 yanaşma,
 * 100+ sn solidStuck). Bay artık sürüş marjıyla (LANE_HALF_WIDTH) kırpılır.
 */
function seedRandom(seed = 5): () => void {
  let value = seed >>> 0;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  });
  return () => spy.mockRestore();
}

let restore: (() => void) | null = null;
beforeEach(() => {
  restore = seedRandom();
});
afterEach(() => {
  restore?.();
});

function probeCharger(
  size: [number, number],
  rotation: 0 | 90 | 180 | 270,
  requestedPosition?: [number, number]
) {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.level = 12;
  state.station.open = true;
  state.pumps = {};
  state.buildings = {};

  // The perpendicular stall needs an open manoeuvre aisle beyond its bay.
  // This central position has enough room in both tested rotations.
  const chargerPosition: [number, number] =
    requestedPosition ?? (rotation === 270 ? [12, 6] : [9, 10]);
  state.buildings.dc = {
    id: 'dc', type: 'ev_charger_dc', level: 1, position: chargerPosition, rotation,
    size, health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
  } as never;
  state.buildings.sub = {
    id: 'sub', type: 'ev_substation', level: 1, position: [3, 13], rotation: 0,
    size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
  } as never;
  state.buildings.bank = {
    id: 'bank', type: 'ev_storage', level: 1, position: [6, 13], rotation: 0,
    size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0, energyKwh: 200
  } as never;

  const layout = blockLayout(state, 'near')!;
  const car: VehicleEntity = {
    id: 'probe_ev', archetype: 'ev', modelVariant: 'hatchback', fuelType: 'gasoline',
    tankCapacity: 60, currentFuel: 20,
    request: { mode: 'FULL', targetValue: 30, calculatedLiters: 30, calculatedPrice: 0, dispensedLiters: 0, isFinished: false },
    patience: 400, maxPatience: 400, satisfaction: 100, state: 'ROAD_APPROACH',
    targetPumpId: null, assignedActor: null,
    worldPosition: [layout.entry.x - 4, 0, layout.roadLaneZ],
    targetWaypoint: [layout.entry.x, 0, layout.roadLaneZ],
    route: [[layout.entry.x, 0, layout.laneZ]],
    heading: Math.PI / 2, speed: 1, routeProgress: 0,
    waitingTimeSeconds: 0, shoppingIntent: false
  };
  state.vehicles = { [car.id]: car };

  const effects = createEffects();
  let assignedTicks = 0;
  let maxSolidStuck = 0;
  let sawReverse = false;
  let reverseHeading: number | null = null;
  for (let i = 0; i < 4000; i++) {
    state.dayState.gameTime = 12;
    runSimulationTick(state, 0.05, effects);
    for (const v of Object.values(state.vehicles)) {
      if (v.chargingBuildingId !== 'dc') continue;
      assignedTicks++;
      maxSolidStuck = Math.max(maxSolidStuck, v.solidStuckSeconds ?? 0);
      if (v.reversing) {
        sawReverse = true;
        reverseHeading ??= v.heading;
        expect(v.heading).toBeCloseTo(reverseHeading, 6);
      }
      if (v.state === 'AT_PUMP' || v.state === 'FUELING' || v.state === 'REQUEST') {
        return { assignedTicks, docked: true, maxSolidStuck, sawReverse };
      }
    }
  }
  return { assignedTicks, docked: false, maxSolidStuck, sawReverse };
}

describe('the electric customer docks at the post', () => {
  for (const [size, rotation] of [
    [[1, 2], 0],
    [GAME_CONFIG.buildings.ev_charger_dc.size, 0],
    [GAME_CONFIG.buildings.ev_charger_dc.size, 90],
    [GAME_CONFIG.buildings.ev_charger_dc.size, 180],
    [GAME_CONFIG.buildings.ev_charger_dc.size, 270]
  ] as Array<[[number, number], 0 | 90 | 180 | 270]>) {
    it(`docks and never wedges — size ${size} rot ${rotation}`, () => {
      const r = probeCharger(size, rotation);
      expect(r.assignedTicks).toBeGreaterThan(0);
      expect(r.docked).toBe(true);
      expect(r.sawReverse).toBe(true);
      // Katı kurala anlık sürtünme olabilir; saplanma olamaz.
      expect(r.maxSolidStuck).toBeLessThan(5);
    });
  }

  it('parks two cars in adjacent stalls without stacking them', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.dayState.gameTime = 12;
    state.player.level = 12;
    state.station.open = true;
    state.pumps = {};
    state.buildings = {
      sub: {
        id: 'sub', type: 'ev_substation', level: 1, position: [3, 13], rotation: 0,
        size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
      },
      bank: {
        id: 'bank', type: 'ev_storage', level: 1, position: [6, 13], rotation: 0,
        size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0,
        energyKwh: 200
      },
      dc1: {
        id: 'dc1', type: 'ev_charger_dc', level: 1, position: [9, 8], rotation: 0,
        size: [1, 2], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
      },
      dc2: {
        id: 'dc2', type: 'ev_charger_dc', level: 1, position: [9, 11], rotation: 0,
        size: [1, 2], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
      }
    } as never;
    const layout = blockLayout(state, 'near')!;
    const arriving = (id: string, x: number): VehicleEntity => ({
      id, archetype: 'ev', modelVariant: 'hatchback', fuelType: 'gasoline',
      tankCapacity: 60, currentFuel: 20,
      request: { mode: 'FULL', targetValue: 30, calculatedLiters: 30, calculatedPrice: 0, dispensedLiters: 0, isFinished: false },
      patience: 400, maxPatience: 400, satisfaction: 100, state: 'ROAD_APPROACH',
      targetPumpId: null, assignedActor: null,
      worldPosition: [x, 0, layout.roadLaneZ],
      targetWaypoint: [layout.entry.x, 0, layout.roadLaneZ],
      route: [[layout.entry.x, 0, layout.laneZ]], heading: Math.PI / 2, speed: 1,
      routeProgress: 0, waitingTimeSeconds: 0, shoppingIntent: false
    });
    state.vehicles = {
      a: arriving('a', layout.entry.x - 3),
      b: arriving('b', layout.entry.x - 9)
    };

    const effects = createEffects();
    const reversed = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      runSimulationTick(state, 0.05, effects);
      for (const car of Object.values(state.vehicles)) if (car.reversing) reversed.add(car.id);
      if (state.vehicles.a?.state === 'AT_PUMP' && state.vehicles.b?.state === 'AT_PUMP') break;
    }

    expect(new Set([state.vehicles.a.chargingBuildingId, state.vehicles.b.chargingBuildingId])).toEqual(
      new Set(['dc1', 'dc2'])
    );
    expect(state.vehicles.a.state).toBe('AT_PUMP');
    expect(state.vehicles.b.state).toBe('AT_PUMP');
    expect(reversed).toEqual(new Set(['a', 'b']));
    expect(
      Math.hypot(
        state.vehicles.a.worldPosition[0] - state.vehicles.b.worldPosition[0],
        state.vehicles.a.worldPosition[2] - state.vehicles.b.worldPosition[2]
      )
    ).toBeGreaterThan(2);
  });

  it('does not strand a charger from an older edge-of-plot save', () => {
    const r = probeCharger([1, 2], 0, [13, 8]);
    expect(r.assignedTicks).toBeGreaterThan(0);
    expect(r.docked).toBe(true);
  });
});
