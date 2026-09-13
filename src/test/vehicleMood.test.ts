import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { BuildingEntity, GameState, VehicleEntity } from '../domain/types/gameState';
import {
  blockLayout,
  closeForecourt,
  createEffects,
  dismissVehicle,
  finalizeSale,
  queueSlotPosition,
  runSimulationTick
} from '../domain/services/simulationEngine';
import { GAME_CONFIG } from '../config/gameConfig';
import { DEPARTURE_GLYPHS, FACILITY_GLYPHS, vehicleMood } from '../rendering/vehicleMood';

/**
 * Live testers, 2026-09-13: players wanted to read off each car what the
 * driver came for, how their patience was holding, and why they left. The
 * engine now keeps the last of those on the car for the drive out. These pin
 * that every way off the forecourt says which it was, and what the roof shows.
 */

afterEach(() => vi.restoreAllMocks());

function seeded(start: number): void {
  let seed = start >>> 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  });
}

function car(
  id: string,
  state: VehicleEntity['state'],
  at: [number, number, number] = [8.5, 0, 5.6]
): VehicleEntity {
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
    patience: 120,
    maxPatience: 120,
    satisfaction: 100,
    state,
    targetPumpId: null,
    assignedActor: null,
    worldPosition: at,
    targetWaypoint: null,
    route: [],
    heading: Math.PI / 2,
    speed: 1,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
}

/** The starting station, shut to new arrivals so only the cars placed here move. */
function station(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.station.open = false;
  return state;
}

describe('why a driver left', () => {
  it('is patience, for a queue that never moved', () => {
    const state = station();
    // Somebody is at the only bay and stays there.
    const served = car('served', 'AT_PUMP');
    served.targetPumpId = 'pump_1';
    state.vehicles.served = served;
    state.pumps.pump_1.currentVehicleId = 'served';
    state.pumps.pump_1.state = 'REQUEST_READY';

    const waiting = car('waiting', 'QUEUE', queueSlotPosition(state, 0, 'near'));
    waiting.patience = 0.01;
    state.vehicles.waiting = waiting;

    runSimulationTick(state, 0.05, createEffects());
    expect(['EXIT', 'DESPAWN']).toContain(waiting.state);
    expect(waiting.departureReason).toBe('PATIENCE');
  });

  it('is the empty tank, for a driver who pulled up to a dry pump', () => {
    const state = station();
    state.tanks.gasoline.stock = 0;
    const driver = car('driver', 'AT_PUMP');
    state.vehicles.driver = driver;

    const effects = createEffects();
    runSimulationTick(state, 0.05, effects);
    runSimulationTick(state, 0.5, effects);
    expect(['EXIT', 'DESPAWN']).toContain(driver.state);
    expect(driver.departureReason).toBe('NO_FUEL');
  });

  it('is the broken pump, when no bay on the block can pour', () => {
    const state = station();
    state.pumps.pump_1.state = 'BROKEN';
    const driver = car('driver', 'AT_PUMP');
    state.vehicles.driver = driver;

    const effects = createEffects();
    runSimulationTick(state, 0.05, effects);
    runSimulationTick(state, 0.5, effects);
    expect(['EXIT', 'DESPAWN']).toContain(driver.state);
    expect(driver.departureReason).toBe('PUMP_BROKEN');
  });

  it('is how the service went, for a driver who paid', () => {
    const random = vi.spyOn(Math, 'random');
    const pay = (setup: (state: GameState, driver: VehicleEntity) => void) => {
      const state = station();
      const driver = car('paying', 'PAYMENT');
      driver.assignedActor = 'PLAYER';
      driver.request.dispensedLiters = driver.request.calculatedLiters;
      state.vehicles[driver.id] = driver;
      setup(state, driver);
      const { tip } = finalizeSale(state, driver, createEffects());
      return { reason: driver.departureReason, tip };
    };

    // A die that never comes up: no tip, and nobody strolls off to a shop.
    random.mockReturnValue(0.99);
    expect(pay(() => {}).reason).toBe('SERVED_GREAT');
    expect(pay((_, driver) => { driver.patience = driver.maxPatience * 0.5; }).reason).toBe('SERVED_OK');
    expect(pay((state, driver) => { driver.patience = 0; state.station.cleanliness = 0; }).reason).toBe('SERVED_POOR');

    // One that always does: the tip is what they remember.
    random.mockReturnValue(0);
    const tipped = pay(() => {});
    expect(tipped.tip).toBeGreaterThan(0);
    expect(tipped.reason).toBe('SERVED_TIP');
  });

  it('is the closed sign, or the player, when either sends them off', () => {
    const state = station();
    const block = blockLayout(state, 'near')!;
    const queued = car('queued', 'QUEUE', queueSlotPosition(state, 0, 'near'));
    const arriving = car('arriving', 'SPAWN', [block.roadStartX, 0, block.roadLaneZ]);
    state.vehicles.queued = queued;
    state.vehicles.arriving = arriving;

    closeForecourt(state);
    expect(queued.departureReason).toBe('CLOSED');
    expect(arriving.state).toBe('PASSING');
    expect(arriving.departureReason).toBe('CLOSED');

    const other = station();
    const dismissed = car('dismissed', 'AT_PUMP');
    other.vehicles.dismissed = dismissed;
    dismissVehicle(other, dismissed);
    expect(dismissed.departureReason).toBe('SENT_AWAY');
  });

  it('is never missing for a car that turned in and then went', () => {
    seeded(11);
    const state = createInitialGameState();
    state.player.level = 12;
    state.dayState.timeSpeed = 1;
    state.employees = {
      e1: {
        id: 'e1', name: 'Ahmet', role: 'PUMP_ATTENDANT', level: 3, wage: 1000,
        assignedPumpId: 'pump_1', state: 'IDLE', serviceCount: 0,
        currentVehicleId: null, actionTimerSeconds: 0, worldPosition: [8, 0, 7]
      }
    } as never;

    // Anyone seen off the road has stopped; from then on, PASSING is leaving.
    const stopped = new Set<string>();
    const left = new Set<string>();
    const silent = new Set<string>();

    for (let tick = 0; tick < 20000; tick++) {
      const effects = createEffects();
      runSimulationTick(state, 0.2, effects);
      if (effects.dayEnded || state.dayState.isDayEnding) break;

      for (const v of Object.values(state.vehicles)) {
        if (v.state !== 'PASSING' && v.state !== 'EXIT' && v.state !== 'DESPAWN') stopped.add(v.id);
        const leaving = v.state === 'EXIT' || (v.state === 'PASSING' && stopped.has(v.id));
        if (!leaving) continue;
        left.add(v.id);
        if (!v.departureReason) silent.add(`${v.id} (${v.archetype})`);
      }
    }

    expect(left.size).toBeGreaterThan(10);
    expect([...silent]).toEqual([]);
  });
});

describe('what the roof shows', () => {
  const none: Record<string, BuildingEntity> = {};

  it('says why on the way out, and nothing over through traffic', () => {
    const leaving = car('leaving', 'EXIT');
    leaving.departureReason = 'NO_FUEL';
    expect(vehicleMood(leaving, none)).toEqual({ kind: 'LEAVING', glyph: DEPARTURE_GLYPHS.NO_FUEL });

    const turnedAway = car('turned', 'PASSING');
    turnedAway.departureReason = 'FULL';
    expect(vehicleMood(turnedAway, none)).toEqual({ kind: 'LEAVING', glyph: DEPARTURE_GLYPHS.FULL });

    expect(vehicleMood(car('through', 'PASSING'), none)).toBeNull();
    expect(vehicleMood(car('coming', 'ROAD_APPROACH'), none)).toBeNull();
  });

  it('wears thinner the longer the driver waits', () => {
    const driver = car('waiting', 'QUEUE');
    const face = (share: number) => {
      driver.patience = driver.maxPatience * share;
      const mood = vehicleMood(driver, none);
      return mood?.kind === 'WAITING' ? mood.patience.emoji : null;
    };
    expect([1, 0.5, 0.25, 0.1, 0].map(face)).toEqual(['🙂', '😐', '😠', '😡', '😡']);
  });

  it('names what the driver came for', () => {
    const intent = (driver: VehicleEntity, buildings = none) => {
      const mood = vehicleMood(driver, buildings);
      return mood && mood.kind !== 'LEAVING' ? mood.intent : null;
    };

    const diesel = car('diesel', 'AT_PUMP');
    diesel.fuelType = 'diesel';
    expect(intent(diesel)).toEqual({ emoji: '⛽', label: GAME_CONFIG.fuels.diesel.shortName });

    const electric = car('electric', 'QUEUE');
    electric.archetype = 'ev';
    expect(intent(electric)?.emoji).toBe('⚡');

    const coffee = car('coffee', 'VISITING');
    coffee.visitBuildingId = 'cafe_1';
    const cafe = { id: 'cafe_1', type: 'cafe' } as BuildingEntity;
    expect(intent(coffee, { cafe_1: cafe })?.emoji).toBe('☕');
  });

  it('has a glyph for every building a driver can walk into', () => {
    const missing = Object.keys(GAME_CONFIG.facilities).filter((type) => !FACILITY_GLYPHS[type]);
    expect(missing).toEqual([]);
  });
});
