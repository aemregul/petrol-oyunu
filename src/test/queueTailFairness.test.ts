import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity } from '../domain/types/gameState';
import { createEffects, queueSlotPosition, runSimulationTick } from '../domain/services/simulationEngine';

/**
 * From level six a driver who finds no room to manoeuvre is a lost customer
 * and costs the station reputation — the layout was meant to be at fault. But
 * the last place of a short queue lies against the plot's edge, and a longer
 * body cannot swing into it however the forecourt is built. Over a measured
 * season that charged the station for a luxury saloon, a family estate or a
 * lorry turning up behind one waiting car, a dozen times and more. That driver
 * found the forecourt full; the name is only at stake when even an empty queue
 * cannot be reached.
 */

afterEach(() => vi.restoreAllMocks());

function vehicle(
  id: string,
  archetype: VehicleEntity['archetype'],
  modelVariant: VehicleEntity['modelVariant'],
  state: VehicleEntity['state'],
  worldPosition: [number, number, number]
): VehicleEntity {
  return {
    id, archetype, modelVariant, fuelType: 'gasoline', tankCapacity: 80, currentFuel: 20,
    request: {
      mode: 'LITERS', targetValue: 20, calculatedLiters: 20, calculatedPrice: 0,
      dispensedLiters: 0, isFinished: false
    },
    patience: 1e6, maxPatience: 1e6, satisfaction: 100, state, targetPumpId: null, assignedActor: null,
    worldPosition, targetWaypoint: null, route: [], heading: Math.PI / 2, speed: 1, routeProgress: 0,
    waitingTimeSeconds: 0, shoppingIntent: false
  };
}

/** A level-6 station, its bay taken and one car already waiting. Nobody new comes in. */
function oneWaiting(): GameState {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.dayState.eventsToday = 99;
  state.player.level = 6;
  state.player.reputation = 4;

  const served = vehicle('served', 'commuter', 'sedan', 'AT_PUMP', [8.5, 0, 5.6]);
  served.targetPumpId = 'pump_1';
  state.vehicles.served = served;
  state.pumps.pump_1.currentVehicleId = 'served';
  state.pumps.pump_1.state = 'REQUEST_READY';

  const waiting = vehicle('waiting', 'commuter', 'sedan', 'QUEUE', queueSlotPosition(state, 0, 'near'));
  waiting.waitingTimeSeconds = 30;
  state.vehicles.waiting = waiting;
  return state;
}

describe('a long body at the tail of a short queue', () => {
  it('drives on as from a full forecourt, not as a customer the layout lost', () => {
    const state = oneWaiting();
    // Arrived at the mouth, on the front lane, like any driver turning in.
    const bus = vehicle('bus', 'bus', 'bus', 'ROAD_APPROACH', [3, 0, 4]);
    state.vehicles.bus = bus;

    const effects = createEffects();
    for (let i = 0; i < 40 && bus.state === 'ROAD_APPROACH'; i++) runSimulationTick(state, 0.05, effects);

    expect(bus.state).not.toBe('QUEUE');
    expect(state.dayState.todayStats.customersLost).toBe(0);
    expect(state.player.reputation).toBe(4);
    expect(state.dayState.todayStats.customersTurnedAway).toBe(1);
  });
});
