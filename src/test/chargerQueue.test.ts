import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity, BuildingEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import {
  createEffects,
  runSimulationTick,
  blockLayout,
  pumpBayOffset,
  queueSlotPosition
} from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-07: electric customers do not wait in the pump queue at the
 * front; they line up behind the charging post, on the way in to its bay,
 * and the head of that line takes the post when it comes free.
 */
let restore: (() => void) | null = null;
beforeEach(() => {
  let value = 3;
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

function ev(id: string, state: GameState, x: number): VehicleEntity {
  const layout = blockLayout(state, 'near')!;
  return {
    id, archetype: 'ev', modelVariant: 'hatchback', fuelType: 'gasoline', tankCapacity: 60, currentFuel: 20,
    request: { mode: 'FULL', targetValue: 30, calculatedLiters: 30, calculatedPrice: 0, dispensedLiters: 0, isFinished: false },
    patience: 400, maxPatience: 400, satisfaction: 100, state: 'ROAD_APPROACH', targetPumpId: null, assignedActor: null,
    worldPosition: [x, 0, layout.roadLaneZ], targetWaypoint: null,
    route: [[layout.entry.x, 0, layout.roadLaneZ], [layout.entry.x, 0, layout.laneZ]],
    heading: 0, speed: 1, routeProgress: 0, waitingTimeSeconds: 0, shoppingIntent: false
  };
}

describe('the line behind the post', () => {
  it('holds the second electric car behind the post, not in the pump queue, and hands it the post', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.dayState.gameTime = 12;
    state.player.level = 12;
    // These are real arrivals exercising the station queue, so the forecourt
    // must be open. A closed station now correctly keeps ROAD_APPROACH cars on
    // the highway; using it merely as a spawn suppressor contradicted that
    // regression rule.
    state.station.open = true;
    state.buildings.sub = building('sub', 'ev_substation', [13, 13]);
    state.buildings.bank = building('bank', 'ev_storage', [9.5, 12.5], 0, { energyKwh: 200 });
    // Deep enough in the plot for two to wait behind it, off the front lane.
    state.buildings.dc = building('dc', 'ev_charger_dc', [13, 10]);
    const layout = blockLayout(state, 'near')!;
    // Two electric customers, a little apart on the road.
    state.vehicles.a = ev('a', state, layout.entry.x - 3);
    state.vehicles.b = ev('b', state, layout.entry.x - 9);
    const a = state.vehicles.a;
    const b = state.vehicles.b;
    // The post never frees on its own: the driver is never served, so the
    // second car's wait is a wait.
    const effects = createEffects();

    const [ox, oz] = pumpBayOffset({ rotation: 0, type: 'ev_charger_dc' });
    const bay = [13 + ox, 10 + oz];
    const pumpSlot = queueSlotPosition(state, 0, 'near');

    let queuedAt: [number, number, number] | null = null;
    for (let i = 0; i < 4000; i++) {
      runSimulationTick(state, 0.05, effects);
      if (b.state === 'QUEUE' && b.targetWaypoint === null && !queuedAt) queuedAt = [...b.worldPosition] as [number, number, number];
      if (queuedAt && a.state === 'AT_PUMP') break;
    }
    expect(a.chargingBuildingId).toBe('dc');
    expect(b.state).toBe('QUEUE');
    expect(queuedAt).not.toBeNull();
    // Behind the post's bay, on its approach line — well clear of the pump lay-by.
    expect(Math.abs(queuedAt![0] - bay[0])).toBeLessThan(0.6);
    expect(queuedAt![2]).toBeLessThan(bay[1] - 1.5);
    expect(Math.hypot(queuedAt![0] - pumpSlot[0], queuedAt![2] - pumpSlot[2])).toBeGreaterThan(2);

    // The first car is served and goes; the second takes the post.
    a.chargeSecondsLeft = 0.01;
    a.assignedActor = 'PLAYER';
    a.state = 'FUELING';
    for (let i = 0; i < 4000 && b.state !== 'AT_PUMP'; i++) runSimulationTick(state, 0.05, effects);
    expect(b.chargingBuildingId).toBe('dc');
    expect(b.state).toBe('AT_PUMP');
    expect(Math.hypot(b.worldPosition[0] - bay[0], b.worldPosition[2] - bay[1])).toBeLessThan(0.8);
  });
});
