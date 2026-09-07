import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity, BuildingEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import { evaluatePlacement } from '../domain/services/placement';
import {
  createEffects,
  runSimulationTick,
  getLayout,
  pumpBayOffset
} from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-07: a car that has charged does not vanish at the post a
 * few seconds later — it drives out through the exit like everyone else.
 */
let restore: (() => void) | null = null;
beforeEach(() => {
  let value = 11;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  });
  restore = () => spy.mockRestore();
});
afterEach(() => restore?.());

function building(id: string, type: string, position: [number, number], rotation: BuildingEntity['rotation'] = 0, extra: Partial<BuildingEntity> = {}): BuildingEntity {
  return {
    id, type, level: 1, position, rotation, size: GAME_CONFIG.buildings[type].size,
    health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0, ...extra
  };
}

function chargedCarAt(postPos: [number, number], rotation: BuildingEntity['rotation']): { state: GameState; car: VehicleEntity } {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.dayState.gameTime = 12;
  state.player.level = 12;
  state.station.open = false;
  state.buildings.sub = building('sub', 'ev_substation', [13, 12]);
  state.buildings.bank = building('bank', 'ev_storage', [9.5, 12.5], 0, { energyKwh: 200 });
  state.buildings.dc = building('dc', 'ev_charger_dc', postPos, rotation);
  const [ox, oz] = pumpBayOffset({ rotation, type: 'ev_charger_dc' });
  const car: VehicleEntity = {
    id: 'ev', archetype: 'ev', modelVariant: 'hatchback', fuelType: 'gasoline', tankCapacity: 60, currentFuel: 20,
    request: { mode: 'FULL', targetValue: 40, calculatedLiters: 40, calculatedPrice: 0, dispensedLiters: 39.9, isFinished: false },
    patience: 60, maxPatience: 60, satisfaction: 100, state: 'FUELING', targetPumpId: null, assignedActor: 'PLAYER',
    worldPosition: [postPos[0] + ox, 0, postPos[1] + oz], targetWaypoint: null, route: [], heading: 0, speed: 0,
    routeProgress: 0, waitingTimeSeconds: 0, shoppingIntent: false, chargingBuildingId: 'dc', chargeSecondsLeft: 0.02
  };
  state.vehicles.ev = car;
  return { state, car };
}

describe('leaving the charging post', () => {
  for (const [pos, rotation] of [
    // Against the right edge, with the substation and bank walling off the
    // return lane behind it.
    [[13, 8], 0],
    [[11, 9], 0],
    [[12, 9], 90],
    [[4, 8], 0],
    [[7, 10], 0],
    [[6, 8], 90],
    [[12, 6], 0]
  ] as Array<[[number, number], BuildingEntity['rotation']]>) {
    it(`drives out through the exit from a post at ${pos} rot ${rotation}`, () => {
      const { state, car } = chargedCarAt(pos, rotation);
      // Only spots the player could actually have built on.
      const probe = createInitialGameState();
      probe.player.level = 12;
      probe.buildings.sub = state.buildings.sub;
      probe.buildings.bank = state.buildings.bank;
      const verdict = evaluatePlacement(probe, 'ev_charger_dc', pos, rotation);
      console.log('placement', pos, rotation, verdict.valid ? 'ok' : verdict.reason);
      if (!verdict.valid) return;
      const effects = createEffects();
      const layout = getLayout(state);
      const startX = car.worldPosition[0];
      let lastPos: [number, number, number] = [...car.worldPosition] as [number, number, number];
      let sawExit = false;
      const bayZ = car.worldPosition[2];
      let deepest = bayZ;
      for (let i = 0; i < 6000 && car.state !== 'DESPAWN'; i++) {
        runSimulationTick(state, 0.05, effects);
        if (car.state === 'EXIT') sawExit = true;
        deepest = Math.max(deepest, car.worldPosition[2]);
        lastPos = [...car.worldPosition] as [number, number, number];
      }
      expect(sawExit).toBe(true);
      // Straight for the mouth: never deeper into the plot than the bay
      // and a roll ahead of it — no lap round the back to the far corner.
      expect(deepest).toBeLessThan(bayZ + 3);
      // Gone the way of the road: far from the post, past the plot's mouth,
      // never dissolved on the spot.
      expect(Math.abs(lastPos[0] - startX)).toBeGreaterThan(6);
      // Out on the highway, not somewhere on the concrete.
      expect(Math.abs(lastPos[2] - layout.roadLaneZ)).toBeLessThan(1.5);
      expect(car.state).toBe('DESPAWN');
    });
  }
});
