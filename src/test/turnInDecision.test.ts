import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity } from '../domain/types/gameState';
import {
  blockLayout,
  createEffects,
  drivewayLaneX,
  LAYOUT,
  queueSlotPosition,
  runSimulationTick
} from '../domain/services/simulationEngine';

/**
 * Emre, 2026-09-12: "pompalar yarı boşken sürücüler geri dönüyor". A driver
 * judged the forecourt the moment they appeared on the road — far off-screen,
 * some ten seconds short of the entrance — and a full queue then sent them on,
 * though a pump had usually come free by the time they could have turned in.
 * The call is now made within sight of the entry mouth, still out on the road.
 */

afterEach(() => vi.restoreAllMocks());

function seeded(start: number): void {
  let seed = start >>> 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  });
}

function car(id: string, state: VehicleEntity['state'], at: [number, number, number]): VehicleEntity {
  return {
    id,
    archetype: 'commuter',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 80,
    currentFuel: 20,
    request: {
      mode: 'LITERS', targetValue: 20, calculatedLiters: 20, calculatedPrice: 0,
      dispensedLiters: 0, isFinished: false
    },
    // Nobody here gives up: the forecourt stays exactly as full as it starts.
    patience: 1e6,
    maxPatience: 1e6,
    satisfaction: 100,
    state,
    targetPumpId: null,
    assignedActor: null,
    worldPosition: at,
    targetWaypoint: null,
    route: [],
    heading: Math.PI / 2,
    speed: 0,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
}

/** The starting station with its one bay taken and both queue places filled. */
function fullForecourt(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.dayState.eventsToday = 99;

  const served = car('served', 'AT_PUMP', [8.5, 0, 5.6]);
  served.targetPumpId = 'pump_1';
  state.vehicles.served = served;
  state.pumps.pump_1.currentVehicleId = 'served';
  state.pumps.pump_1.state = 'REQUEST_READY';

  for (const slot of [0, 1]) {
    const waiting = car(`queued${slot}`, 'QUEUE', queueSlotPosition(state, slot, 'near'));
    waiting.waitingTimeSeconds = 100 - slot;
    state.vehicles[waiting.id] = waiting;
  }
  return state;
}

describe('a driver on the road finding the forecourt full', () => {
  it('judges it within sight of the entrance, not the moment they appear', () => {
    seeded(3);
    const state = fullForecourt();
    const block = blockLayout(state, 'near')!;
    const mouthX = drivewayLaneX(block.entry, 0);
    const effects = createEffects();

    let arrival: VehicleEntity | undefined;
    for (let i = 0; i < 20000 && !arrival; i++) {
      runSimulationTick(state, 0.05, effects);
      arrival = Object.values(state.vehicles).find(
        (v) => v.state === 'ROAD_APPROACH' && mouthX - v.worldPosition[0] > 30
      );
    }
    expect(arrival, 'no driver turned towards the station').toBeDefined();

    // Still far down the road: it keeps coming rather than giving up unseen.
    // It used to be driving on past by now.
    for (let i = 0; i < 10; i++) runSimulationTick(state, 0.05, effects);
    expect(arrival!.state).toBe('ROAD_APPROACH');

    // Within sight, the bay still taken and the queue still full: it drives on,
    // and never leaves the carriageway to do it.
    let leftTheRoad = false;
    for (let i = 0; i < 4000 && arrival!.state === 'ROAD_APPROACH'; i++) {
      runSimulationTick(state, 0.05, effects);
      if (Math.abs(arrival!.worldPosition[2] - block.roadLaneZ) > LAYOUT.roadHalfWidth + 0.5) leftTheRoad = true;
    }
    expect(arrival!.state).toBe('PASSING');
    expect(leftTheRoad).toBe(false);
    expect(mouthX - arrival!.worldPosition[0]).toBeLessThan(10);
  });
});
