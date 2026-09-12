import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { calculateReputationTrafficMultiplier } from '../domain/formulas/economy';
import {
  createEffects,
  runSimulationTick,
  beginFueling,
  dispenseStep,
  finalizeSale,
  placeFuelOrder,
  triggerEvent,
  getEventModifiers,
  generateDailyMissions,
  trackMissionMetric,
  announceMissionChain,
  dailyTemplatesFor,
  queueSlotPosition,
  getLayout,
  drivewayMouths,
  drivewayLaneX,
  pumpBayOffset,
  blockLayout,
  blockFacilities,
  chargingPoints,
  hourOfDay,
  isFuelDealOn,
  wholesaleNow,
  FUEL_DEAL_DISCOUNT,
  vehicleSide,
  stopChance,
  closeForecourt,
  finalizeCharge,
  dailyPriceReputationDelta,
  vehicleBodyHalfExtents,
  DRIVEWAY_Z,
  LAYOUT
} from '../domain/services/simulationEngine';
import { GAME_EVENTS } from '../config/eventConfig';
import { GameState, VehicleEntity, VehicleState } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import { MISSION_CHAIN, chainStatus } from '../domain/services/missionChain';

/**
 * Vehicle spawning is a per-tick dice roll, so tests that wait for a car to
 * appear would otherwise be flaky. Pinning Math.random to a fixed sequence
 * makes every run identical without changing the code under test.
 */
function seedRandom(seed = 12345): () => void {
  let value = seed;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  });
  return () => spy.mockRestore();
}

let restoreRandom: (() => void) | null = null;

beforeEach(() => {
  restoreRandom = seedRandom();
});

afterEach(() => {
  restoreRandom?.();
  restoreRandom = null;
});

function advance(state: GameState, seconds: number, stepSeconds = 0.05): void {
  const effects = createEffects();
  const steps = Math.round(seconds / stepSeconds);
  for (let i = 0; i < steps; i++) {
    runSimulationTick(state, stepSeconds, effects);
  }
}

/** Runs until the predicate holds, or gives up after `maxSeconds` of sim time. */
function advanceUntil(
  state: GameState,
  predicate: (s: GameState) => boolean,
  maxSeconds = 300
): boolean {
  const step = 0.05;
  const effects = createEffects();
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += step) {
    if (predicate(state)) return true;
    runSimulationTick(state, step, effects);
  }
  return predicate(state);
}

/** Exact overlap of two rendered, oriented vehicle bodies. */
function vehicleBodiesOverlap(a: VehicleEntity, b: VehicleEntity): boolean {
  const frame = (vehicle: VehicleEntity) => ({
    body: vehicleBodyHalfExtents(vehicle),
    ahead: { x: Math.sin(vehicle.heading), z: Math.cos(vehicle.heading) },
    across: { x: Math.cos(vehicle.heading), z: -Math.sin(vehicle.heading) }
  });
  const one = frame(a);
  const two = frame(b);
  const dx = b.worldPosition[0] - a.worldPosition[0];
  const dz = b.worldPosition[2] - a.worldPosition[2];
  const apart = (axis: { x: number; z: number }) => {
    const reach = (f: typeof one) =>
      Math.abs(f.ahead.x * axis.x + f.ahead.z * axis.z) * f.body.length +
      Math.abs(f.across.x * axis.x + f.across.z * axis.z) * f.body.width;
    return Math.abs(dx * axis.x + dz * axis.z) >= reach(one) + reach(two) - 0.04;
  };
  return !(apart(one.ahead) || apart(one.across) || apart(two.ahead) || apart(two.across));
}

describe('simulationEngine - vehicle lifecycle', () => {
  it('spawns vehicles that drive in and arrive at a pump', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;

    const arrived = advanceUntil(
      state,
      (s) => Object.values(s.vehicles).some((v) => v.state === 'AT_PUMP'),
      600
    );

    expect(arrived).toBe(true);
    const vehicle = Object.values(state.vehicles).find((v) => v.state === 'AT_PUMP')!;
    expect(vehicle.targetPumpId).toBe('pump_1');
    expect(state.pumps.pump_1.currentVehicleId).toBe(vehicle.id);
    expect(state.pumps.pump_1.state).toBe('REQUEST_READY');
  });

  // Emre'nin 2026-09-02 kararı: ön yüz OYUNCUNUN rotasyonundan gelir, motor
  // şeride bakıp karar vermez. Dört yönün dördü de sayıyla çivili.
  it('puts the serving bay on the face the player turned forward', () => {
    expect(pumpBayOffset({ rotation: 0 })).toEqual([1.4, 0]);
    expect(pumpBayOffset({ rotation: 90 })).toEqual([0, -1.4]);
    expect(pumpBayOffset({ rotation: 180 })).toEqual([-1.4, 0]);
    expect(pumpBayOffset({ rotation: 270 })).toEqual([0, 1.4]);
  });

  // Ve araçlar oyuncunun seçtiği yüze itaat eder: pompa arkaya çevrilirse
  // müşteri pompanın ARKASINDA (z = 7 + 1.4) durur — öne değil.
  it('parks the customer on whichever face the player chose', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.pumps.pump_1.rotation = 270;

    advanceUntil(state, (s) => Object.values(s.vehicles).some((v) => v.state === 'AT_PUMP'), 900);
    const vehicle = Object.values(state.vehicles).find((v) => v.state === 'AT_PUMP')!;

    expect(vehicle.worldPosition[0]).toBeCloseTo(8.5, 1);
    expect(vehicle.worldPosition[2]).toBeCloseTo(7 + 1.4, 1);
  });

  // Emre'nin 2026-09-02 kararı: yeni oyunun pompası yola dönük başlar —
  // çeyrek tur dönmüş, ortada ve yola yakın (z=7), araç ön şeritten gelip
  // TAM ÖNÜNDE durur. Sayılar çivili: pompa [8.5, 7] / 90°, aracın bekleme
  // yeri [8.5, 7 - 1.4].
  it('starts a new game with the pump turned to face the road', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;

    expect(state.pumps.pump_1.rotation).toBe(90);
    expect(state.pumps.pump_1.position).toEqual([8.5, 7]);

    advanceUntil(state, (s) => Object.values(s.vehicles).some((v) => v.state === 'AT_PUMP'), 600);
    const vehicle = Object.values(state.vehicles).find((v) => v.state === 'AT_PUMP')!;

    expect(vehicle.worldPosition[0]).toBeCloseTo(8.5, 1);
    expect(vehicle.worldPosition[2]).toBeCloseTo(7 - 1.4, 1);
  });

  // Emre'nin 2026-09-02 isteği: kuyruk, ilham alınan oyundaki gibi nizami —
  // bekleyen her araç aynı şerit çizgisinde (queueZ), burnu aynı yöne dönük,
  // aralıklar sabit. Çapraz gelip açılı duran araba kuyruğu kabul değil.
  it('queues cars in one straight file, all facing the same way', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    // Görevli yok, oyuncu da yakıt vermiyor: ilk müşteri pompayı tutar ve
    // arkası doğal olarak kuyruğa biner.

    const block = blockLayout(state, 'near')!;
    const laneHeading = Math.PI / 2;

    let sawTwoParked = false;
    advanceUntil(
      state,
      (s) => {
        const parked = Object.values(s.vehicles).filter(
          (v) => v.state === 'QUEUE' && !v.targetWaypoint
        );
        if (parked.length < 2) return false;
        sawTwoParked = true;

        for (const v of parked) {
          // Aynı çizgi üstünde…
          expect(Math.abs(v.worldPosition[2] - block.queueZ)).toBeLessThan(0.6);
          // …ve kuyruk yönüne dönük (düzelme payıyla).
          const turn =
            ((laneHeading - v.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          expect(Math.abs(turn)).toBeLessThan(0.6);
        }
        return true;
      },
      1200
    );

    expect(sawTwoParked).toBe(true);
  });

  it('walks a manual sale through REQUEST > FUELING > PAYMENT and pays out', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    advanceUntil(state, (s) => Object.values(s.vehicles).some((v) => v.state === 'AT_PUMP'), 600);

    const vehicle = Object.values(state.vehicles).find((v) => v.state === 'AT_PUMP')!;
    const effects = createEffects();
    const cashBefore = state.player.cash;
    const stockBefore = state.tanks.gasoline.stock;

    expect(beginFueling(state, vehicle, 'LITERS', 20, 'PLAYER', effects)).toBe(true);
    expect(vehicle.state).toBe('FUELING');
    expect(state.tanks.gasoline.reservedStock).toBeCloseTo(20, 1);

    let completed = false;
    for (let i = 0; i < 200 && !completed; i++) {
      completed = dispenseStep(state, vehicle, 0.1, effects);
    }

    expect(completed).toBe(true);
    expect(vehicle.state).toBe('PAYMENT');
    expect(vehicle.request.dispensedLiters).toBeCloseTo(20, 1);

    finalizeSale(state, vehicle, effects);

    expect(state.player.cash).toBeGreaterThan(cashBefore);
    expect(state.tanks.gasoline.stock).toBeCloseTo(stockBefore - 20, 1);
    expect(state.tanks.gasoline.reservedStock).toBeCloseTo(0, 1);
    expect(state.dayState.todayStats.customersServed).toBe(1);
    expect(state.pumps.pump_1.state).toBe('IDLE');
    expect(state.pumps.pump_1.currentVehicleId).toBeNull();
    expect(['OPTIONAL_SHOP', 'EXIT']).toContain(vehicle.state);
  });

  it('empties the forecourt the moment the station closes', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    advanceUntil(state, (s) => Object.values(s.vehicles).some((v) => v.state === 'AT_PUMP'), 600);

    const vehicle = Object.values(state.vehicles).find((v) => v.state === 'AT_PUMP')!;
    const effects = createEffects();
    const stockBefore = state.tanks.gasoline.stock;

    expect(beginFueling(state, vehicle, 'LITERS', 20, 'PLAYER', effects)).toBe(true);
    for (let i = 0; i < 40; i++) dispenseStep(state, vehicle, 0.1, effects);
    expect(vehicle.request.dispensedLiters).toBeGreaterThan(0);

    const onSite = Object.values(state.vehicles).filter((v) => {
      if (['SPAWN', 'PASSING', 'EXIT', 'DESPAWN'].includes(v.state)) return false;
      if (v.state !== 'ROAD_APPROACH') return true;
      const road = blockLayout(state, vehicleSide(v));
      return !road || Math.abs(v.worldPosition[2] - road.roadLaneZ) >= 1;
    }).length;

    const cleared = closeForecourt(state);

    // Everyone drops what they are doing, and the bay they held comes back.
    expect(cleared.left).toBe(onSite);
    expect(vehicle.state).toBe('EXIT');
    expect(state.pumps.pump_1.currentVehicleId).toBeNull();
    expect(state.pumps.pump_1.state).toBe('IDLE');

    // What was pumped is gone and unpaid; the rest of the hold is released, so
    // closing mid-serve never leaves stock locked away for good.
    expect(cleared.unpaidLiters).toBeGreaterThan(0);
    expect(state.tanks.gasoline.stock).toBeCloseTo(stockBefore - cleared.unpaidLiters, 1);
    expect(state.tanks.gasoline.reservedStock).toBeCloseTo(0, 1);
  });

  /**
   * A ROAD_APPROACH car is only a prospective customer while it is still on
   * the highway. Closing used to treat the state name as proof that the car
   * was already on site and hand it an exit route from the middle of the
   * carriageway. Reopening did not undo that EXIT state, so it cut across the
   * field, crossed the forecourt without buying fuel, and left by the exit.
   */
  it('keeps a road-side arrival on the highway through a quick close and reopen', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    const block = blockLayout(state, 'near')!;

    advanceUntil(
      state,
      (s) =>
        Object.values(s.vehicles).some(
          (v) =>
            v.state === 'ROAD_APPROACH' &&
            Math.abs(v.worldPosition[2] - block.roadLaneZ) < 0.1
        ),
      1000
    );
    const arrival = Object.values(state.vehicles).find(
      (v) =>
        v.state === 'ROAD_APPROACH' &&
        Math.abs(v.worldPosition[2] - block.roadLaneZ) < 0.1
    )!;
    expect(arrival).toBeDefined();

    state.station.open = false;
    const cleared = closeForecourt(state);
    state.station.open = true;

    // It saw the closed sign before leaving the road. It is through traffic
    // now; reopening a moment later must not turn it back into a customer.
    expect(cleared.left).toBe(0);
    expect(arrival.state).toBe('PASSING');
    expect(arrival.targetWaypoint).toEqual([block.roadEndX, 0, block.roadLaneZ]);

    let furthestFromRoad = 0;
    const servedBefore = state.dayState.todayStats.customersServed;
    const effects = createEffects();
    for (let i = 0; i < 2000 && state.vehicles[arrival.id]; i++) {
      runSimulationTick(state, 0.05, effects);
      furthestFromRoad = Math.max(
        furthestFromRoad,
        Math.abs(arrival.worldPosition[2] - block.roadLaneZ)
      );
    }

    expect(furthestFromRoad).toBeLessThan(0.1);
    expect(state.dayState.todayStats.customersServed).toBe(servedBefore);
  });

  it('does not turn a car that crossed the kerb into through traffic', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.station.open = false;
    const block = blockLayout(state, 'near')!;
    const entryX = drivewayLaneX(block.entry, 0);
    const car = {
      id: 'committed', archetype: 'commuter', modelVariant: 'sedan', fuelType: 'gasoline',
      tankCapacity: 60, currentFuel: 20,
      request: { mode: 'LITERS', targetValue: 20, calculatedLiters: 20,
        calculatedPrice: 0, dispensedLiters: 0, isFinished: false },
      patience: 120, maxPatience: 120, satisfaction: 100,
      state: 'ROAD_APPROACH', targetPumpId: null, assignedActor: null,
      worldPosition: [entryX, 0, block.minZ + 0.5],
      targetWaypoint: [entryX, 0, block.laneZ], route: [],
      heading: 0, speed: 1, routeProgress: 0, waitingTimeSeconds: 0,
      shoppingIntent: false, blockedSeconds: 21
    } as VehicleEntity;
    state.vehicles = { committed: car };
    const turnedAwayBefore = state.dayState.todayStats.customersTurnedAway ?? 0;

    runSimulationTick(state, 0.05, createEffects());

    expect(car.state).toBe('ROAD_APPROACH');
    expect(state.dayState.todayStats.customersTurnedAway ?? 0).toBe(turnedAwayBefore);
  });

  it('lets crossed forecourt routes clear after a short give-way', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.station.open = false;
    const crossingCar = (
      id: string,
      position: [number, number, number],
      target: [number, number, number]
    ): VehicleEntity => ({
      id, archetype: 'commuter', modelVariant: 'sedan', fuelType: 'gasoline',
      tankCapacity: 50, currentFuel: 40,
      request: {
        mode: 'LITERS', targetValue: 0, calculatedLiters: 0, calculatedPrice: 0,
        dispensedLiters: 0, isFinished: true
      },
      patience: 40, maxPatience: 40, satisfaction: 100,
      state: 'EXIT', targetPumpId: null, assignedActor: null,
      worldPosition: position, targetWaypoint: target, route: [],
      heading: 0, speed: 1, routeProgress: 0, waitingTimeSeconds: 0,
      shoppingIntent: false
    });
    const first = crossingCar('a_first', [3, 0, 12], [7, 0, 12]);
    const yielding = crossingCar('b_yielding', [5, 0, 10], [5, 0, 14]);
    yielding.state = 'ROAD_APPROACH';
    state.vehicles = { a_first: first, b_yielding: yielding };

    let worstWait = 0;
    for (let i = 0; i < 40; i++) {
      runSimulationTick(state, 0.05, createEffects());
      worstWait = Math.max(worstWait, yielding.blockedSeconds ?? 0);
    }

    expect(first.state).toBe('DESPAWN');
    expect(yielding.state).toBe('DESPAWN');
    expect(worstWait).toBeLessThan(1.1);
  });

  it('sends the earliest compatible fuel customer to an idle bay', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.station.open = false;
    const block = blockLayout(state, 'near')!;
    const queued = (id: string, fuelType: 'gasoline' | 'diesel', index: number): VehicleEntity => ({
      id, archetype: 'commuter', modelVariant: 'sedan', fuelType,
      tankCapacity: 60, currentFuel: 20,
      request: { mode: 'LITERS', targetValue: 20, calculatedLiters: 20,
        calculatedPrice: 0, dispensedLiters: 0, isFinished: false },
      patience: 120, maxPatience: 120, satisfaction: 100,
      state: 'QUEUE', targetPumpId: null, assignedActor: null,
      worldPosition: queueSlotPosition(state, index, 'near'),
      targetWaypoint: null, route: [], heading: Math.PI / 2, speed: 1,
      routeProgress: 0, waitingTimeSeconds: 20 - index, shoppingIntent: false
    });
    const dieselHead = queued('diesel_head', 'diesel', 0);
    const petrolBehind = queued('petrol_behind', 'gasoline', 1);
    state.vehicles = { diesel_head: dieselHead, petrol_behind: petrolBehind };

    runSimulationTick(state, 0.05, createEffects());

    expect(dieselHead.state).toBe('QUEUE');
    expect(petrolBehind.state).toBe('PUMP_RESERVED');
    expect(petrolBehind.targetPumpId).toBe('pump_1');
    expect(state.pumps.pump_1.currentVehicleId).toBe('petrol_behind');
    expect(block.queueZ).toBeDefined();
  });

  it('sends the customer away when the pump fails under them', () => {
    // Wiping the pump's currentVehicleId on breakdown left the car standing
    // at the bay for ever: no pump state advanced it, no attendant saw it,
    // and it still held the pump and its fuel reservation (Emre, 2026-09-07).
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    advanceUntil(state, (s) => Object.values(s.vehicles).some((v) => v.state === 'AT_PUMP'), 600);

    const vehicle = Object.values(state.vehicles).find((v) => v.state === 'AT_PUMP')!;
    const effects = createEffects();
    expect(beginFueling(state, vehicle, 'LITERS', 20, 'PLAYER', effects)).toBe(true);
    for (let i = 0; i < 10; i++) dispenseStep(state, vehicle, 0.1, effects);
    expect(vehicle.state).toBe('FUELING');
    const lost = state.dayState.todayStats.customersLost;

    state.pumps.pump_1.health = 0;
    advance(state, 1);

    expect(state.pumps.pump_1.state).toBe('BROKEN');
    expect(state.pumps.pump_1.currentVehicleId).toBeNull();
    // The driver leaves rather than waiting on a dead dispenser…
    expect(['EXIT', 'DESPAWN']).toContain(vehicle.state);
    expect(vehicle.targetPumpId).toBeNull();
    expect(vehicle.assignedActor).toBeNull();
    // …and takes their hold on the tank with them. Reputation pays for it.
    expect(state.tanks.gasoline.reservedStock).toBeCloseTo(0, 1);
    expect(state.dayState.todayStats.customersLost).toBe(lost + 1);

    // Nobody is left standing at the failed bay afterwards, either.
    advanceUntil(state, () => !state.vehicles[vehicle.id], 600);
    expect(state.vehicles[vehicle.id]).toBeUndefined();
  });

  it('never lets a vehicle reach an invalid state', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;

    const valid: VehicleState[] = [
      'SPAWN', 'PASSING', 'ROAD_APPROACH', 'QUEUE', 'PUMP_RESERVED', 'AT_PUMP',
      'REQUEST', 'FUELING', 'PAYMENT', 'OPTIONAL_SHOP', 'TO_PARK', 'VISITING', 'EXIT', 'DESPAWN'
    ];

    advance(state, 400);
    for (const vehicle of Object.values(state.vehicles)) {
      expect(valid).toContain(vehicle.state);
    }
  });

  it('queues vehicles once every pump is occupied', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.reputation = 5;
    state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.8;

    // One pump and a busy road: the second arrival has to wait its turn.
    const queued = advanceUntil(
      state,
      (s) => Object.values(s.vehicles).some((v) => v.state === 'QUEUE'),
      4000
    );

    expect(queued).toBe(true);
  });

  it('makes running dry and letting a pump fail cost the station its name', () => {
    const dry = createInitialGameState();
    dry.dayState.timeSpeed = 1;
    dry.tanks.gasoline.stock = 0;

    // A driver on the road cannot see an empty tank, so they still pull in —
    // and leave unserved. Neglect is meant to be felt, not quietly absorbed.
    expect(stopChance(dry)).toBeGreaterThan(0);
    advanceUntil(dry, (s) => s.dayState.todayStats.customersLost > 0, 6000);
    expect(dry.dayState.todayStats.customersLost).toBeGreaterThan(0);

    // The same when the only bay has worn out.
    const broken = createInitialGameState();
    broken.dayState.timeSpeed = 1;
    broken.pumps.pump_1.state = 'BROKEN';

    expect(stopChance(broken)).toBeGreaterThan(0);
    advanceUntil(broken, (s) => s.dayState.todayStats.customersLost > 0, 6000);
    expect(broken.dayState.todayStats.customersLost).toBeGreaterThan(0);

    // There is a way back, though: reputation has a floor and the road never
    // empties completely, so a neglected station can always be recovered.
    expect(calculateReputationTrafficMultiplier(1)).toBeGreaterThan(0.5);
  });

  it('moves an order through the full gate and unloading sequence', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.cash = 100000;
    const effects = createEffects();

    const stockBefore = state.tanks.gasoline.stock;
    expect(placeFuelOrder(state, 'gasoline', 500, effects)).toBe(true);

    const order = state.fuelOrders[0];
    expect(order.state).toBe('TRAVELLING');

    const seenStates = new Set<string>();
    for (let i = 0; i < 20000 && state.fuelOrders.length > 0; i++) {
      if (state.fuelOrders[0]) seenStates.add(state.fuelOrders[0].state);
      runSimulationTick(state, 0.05, effects);
    }

    expect(seenStates.has('TRAVELLING')).toBe(true);
    expect(seenStates.has('QUEUED_AT_GATE')).toBe(true);
    expect(seenStates.has('UNLOADING')).toBe(true);
    expect(state.fuelOrders).toHaveLength(0);
    expect(state.tanks.gasoline.stock).toBeCloseTo(stockBefore + 500, 0);
  });

  it('refuses an order that would overflow the tank', () => {
    const state = createInitialGameState();
    const effects = createEffects();
    const cashBefore = state.player.cash;

    expect(placeFuelOrder(state, 'gasoline', 5000, effects)).toBe(false);
    expect(state.player.cash).toBe(cashBefore);
    expect(state.fuelOrders).toHaveLength(0);
  });
});

describe('simulationEngine - attendants', () => {
  it('serves customers end to end without player input', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.tanks.gasoline.stock = 1500;

    state.employees.emp_test = {
      id: 'emp_test',
      name: 'Test Usta',
      role: 'PUMP_ATTENDANT',
      level: 3,
      wage: 1050,
      assignedPumpId: 'pump_1',
      state: 'IDLE',
      serviceCount: 0,
      currentVehicleId: null,
      actionTimerSeconds: 0,
      worldPosition: [12, 0, 10]
    };

    const cashBefore = state.player.cash;
    advance(state, 900);

    expect(state.dayState.todayStats.customersServed).toBeGreaterThan(0);
    expect(state.employees.emp_test.serviceCount).toBeGreaterThan(0);
    expect(state.player.cash).toBeGreaterThan(cashBefore);
    expect(state.tanks.gasoline.stock).toBeLessThan(1500);
  });

  /**
   * An island serves from its two long faces, and those faces turn with it.
   * The bay used to be pinned to world x however the pump was rotated, so a
   * pump turned to face the entrance still had cars pulling up against its
   * blank end.
   */
  it('parks a car against the face a turned pump presents', () => {
    const served = (rotation: 0 | 90) => {
      const state = createInitialGameState();
      state.dayState.timeSpeed = 1;
      state.tanks.gasoline.stock = 3000;
      state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.7;

      const pump = state.pumps.pump_1;
      pump.rotation = rotation;
      state.employees.emp_test = {
        id: 'emp_test',
        name: 'Test Usta',
        role: 'PUMP_ATTENDANT',
        level: 3,
        wage: 1050,
        assignedPumpId: 'pump_1',
        state: 'IDLE',
        serviceCount: 0,
        currentVehicleId: null,
        actionTimerSeconds: 0,
        worldPosition: [12, 0, 10]
      };

      const effects = createEffects();
      for (let i = 0; i < 20000; i++) {
        runSimulationTick(state, 0.05, effects);
        for (const v of Object.values(state.vehicles)) {
          if (v.state !== 'FUELING' && v.state !== 'REQUEST') continue;
          return {
            dx: v.worldPosition[0] - pump.position[0],
            dz: v.worldPosition[2] - pump.position[1],
            // heading is atan2(dx, dz), so a car facing along z has |cos| > |sin|.
            facesAlongZ: Math.abs(Math.cos(v.heading)) > Math.abs(Math.sin(v.heading))
          };
        }
      }
      return null;
    };

    const straight = served(0);
    expect(straight).not.toBeNull();
    // Unturned: beside the island on x, lying along the island's length in z.
    expect(Math.abs(straight!.dx)).toBeGreaterThan(Math.abs(straight!.dz));
    expect(straight!.facesAlongZ).toBe(true);

    const turned = served(90);
    expect(turned).not.toBeNull();
    // A quarter turn swaps both: the car stands off in z and lies along x.
    expect(Math.abs(turned!.dz)).toBeGreaterThan(Math.abs(turned!.dx));
    expect(turned!.facesAlongZ).toBe(false);
  });
});

describe('simulationEngine - missions', () => {
  it('meets the main goal that asks for a fuel order once one is placed', () => {
    const state = createInitialGameState();
    state.player.cash = 100000;
    state.missionChain.step = MISSION_CHAIN.findIndex((s) => s.id === 'order_fuel');
    const effects = createEffects();

    expect(chainStatus(state)?.complete).toBe(false);
    placeFuelOrder(state, 'gasoline', 500, effects);
    expect(chainStatus(state)?.complete).toBe(true);
  });

  it('announces a met main goal once, not on every tick', () => {
    const state = createInitialGameState();
    state.player.statistics.totalCustomersServed = 1;
    const effects = createEffects();

    announceMissionChain(state, effects);
    announceMissionChain(state, effects);
    expect(effects.notifications.filter((n) => n.title === 'Ana Görev Tamamlandı!')).toHaveLength(1);
    expect(state.missionChain.announced).toBe(true);
  });
});

describe('simulationEngine - state machine integrity', () => {
  it('drives a busy station for a full day without one invalid transition', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const state = createInitialGameState();
      state.dayState.timeSpeed = 1;
      state.player.cash = 200000;
      state.tanks.gasoline.capacity = 6000;
      state.tanks.gasoline.stock = 6000;
      state.station.cleanliness = 100;

      // Two pumps and two attendants keep every subsystem busy at once.
      state.pumps.pump_2 = { ...state.pumps.pump_1, id: 'pump_2', position: [16, 10] };
      for (const [id, pumpId] of [['emp_a', 'pump_1'], ['emp_b', 'pump_2']] as const) {
        state.employees[id] = {
          id,
          name: id,
          role: 'PUMP_ATTENDANT',
          level: 2,
          wage: 800,
          assignedPumpId: pumpId,
          state: 'IDLE',
          serviceCount: 0,
          currentVehicleId: null,
          actionTimerSeconds: 0,
          worldPosition: [12, 0, 10]
        };
      }

      advance(state, 3000);

      const invalid = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('Geçersiz'));

      expect(invalid).toEqual([]);
      expect(state.dayState.todayStats.customersServed).toBeGreaterThan(3);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('simulationEngine - day boundary', () => {
  it('runs a full day from six to six at ten seconds an hour', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;

    const perHour = GAME_CONFIG.economy.realSecondsPerGameHour;
    let elapsed = 0;
    let ended = false;

    while (elapsed < 600 && !ended) {
      const effects = createEffects();
      runSimulationTick(state, 0.05, effects);
      elapsed += 0.05;
      ended = effects.dayEnded;

      // Six hours in should be sixty seconds in, and so on round the clock.
      if (Math.abs(elapsed - 6 * perHour) < 0.03) {
        expect(state.dayState.gameTime).toBeCloseTo(12, 1);
      }
      if (Math.abs(elapsed - 21 * perHour) < 0.03) {
        // Past midnight the clock keeps counting up rather than wrapping.
        expect(state.dayState.gameTime).toBeCloseTo(27, 1);
      }
    }

    expect(ended).toBe(true);
    expect(elapsed).toBeCloseTo(24 * perHour, 0);
    expect(state.dayState.gameTime).toBe(GAME_CONFIG.economy.dayEndHour);

    // And the clock reads as a time of day however far past midnight it runs.
    expect(hourOfDay(27)).toBe(3);
    expect(hourOfDay(GAME_CONFIG.economy.dayEndHour)).toBe(
      GAME_CONFIG.economy.dayStartHour
    );
  });

  it('opens one discounted fuel window a day, for a minute, at a fresh hour', () => {
    const hours: number[] = [];

    for (let day = 0; day < 5; day++) {
      const state = createInitialGameState();
      state.dayState.timeSpeed = 1;

      let openFor = 0;
      let opened = 0;
      let wasOpen = false;

      for (let i = 0; i < 30000; i++) {
        const effects = createEffects();
        runSimulationTick(state, 0.05, effects);

        const on = isFuelDealOn(state);
        if (on) {
          openFor += 0.05;
          if (!wasOpen) {
            opened++;
            hours.push(hourOfDay(state.dayState.gameTime));
            // While it is open the supplier's price really is cut.
            expect(wholesaleNow(state, 'gasoline')).toBeCloseTo(
              state.pricing.gasoline.todayWholesaleCost * (1 - FUEL_DEAL_DISCOUNT),
              1
            );
          }
        }
        wasOpen = on;
        if (effects.dayEnded) break;
      }

      // Once, and for a minute of the player's time — not the forecourt's.
      expect(opened).toBe(1);
      expect(openFor).toBeCloseTo(60, 0);
      expect(wholesaleNow(state, 'gasoline')).toBe(state.pricing.gasoline.todayWholesaleCost);
    }

    // And not at the same time every day, or there would be nothing to catch.
    expect(new Set(hours.map((h) => h.toFixed(1))).size).toBeGreaterThan(1);
  });

  it('discounts what the station buys, never what it sells', () => {
    const state = createInitialGameState();
    state.player.cash = 500000;

    const pumpPrice = state.pricing.gasoline.playerPrice;
    const listPrice = state.pricing.gasoline.todayWholesaleCost;

    state.dayState.fuelDealSecondsLeft = 60;
    placeFuelOrder(state, 'gasoline', 500, createEffects());

    // The tanker comes in cheaper...
    const order = state.fuelOrders[state.fuelOrders.length - 1];
    expect(order.unitCost).toBeCloseTo(listPrice * (1 - FUEL_DEAL_DISCOUNT), 1);

    // ...while the board out front, and what a customer pays at the pump, are
    // exactly as the player left them. This is a supply deal, not a sale.
    expect(state.pricing.gasoline.playerPrice).toBe(pumpPrice);
    expect(state.pricing.gasoline.todayWholesaleCost).toBe(listPrice);
  });

  it('ages a pump on the clock rather than on how much it has sold', () => {
    const busy = createInitialGameState();
    busy.dayState.timeSpeed = 1;
    const idle = createInitialGameState();
    idle.dayState.timeSpeed = 1;
    // Nothing to sell, so this one serves nobody all day.
    idle.tanks.gasoline.capacity = 0;

    advance(busy, 240);
    advance(idle, 240);

    // Hardware standing in the weather wears out either way, so the busiest
    // bay is not quietly punished for being the one that earns.
    expect(busy.pumps.pump_1.health).toBeLessThan(100);
    expect(idle.pumps.pump_1.health).toBeCloseTo(busy.pumps.pump_1.health, 0);
    // And slowly: a fortnight of trading before it needs attention.
    expect(100 - busy.pumps.pump_1.health).toBeLessThan(8);
  });

  it('slows a pump\u2019s wear while the station is shut, without stopping it', () => {
    // Emre, 2026-09-10: a station left closed for days came back to bays that
    // needed servicing without having served anybody. Shutting up shop must
    // still cost something — otherwise it is the cheap way to keep hardware
    // pristine — but most of what wears a pump is the pumping.
    const open = createInitialGameState();
    open.dayState.timeSpeed = 1;
    const shut = createInitialGameState();
    shut.dayState.timeSpeed = 1;
    shut.station.open = false;

    // A full trading day: 24 game hours at ten real seconds each.
    const day = 24 * GAME_CONFIG.economy.realSecondsPerGameHour;
    advance(open, day);
    advance(shut, day);

    const openWear = 100 - open.pumps.pump_1.health;
    const shutWear = 100 - shut.pumps.pump_1.health;

    // Still wearing: closing is not a way to freeze the hardware.
    expect(shutWear).toBeGreaterThan(0);
    // But markedly slower — a quarter of the rate a trading day charges.
    expect(shutWear).toBeLessThan(openWear / 2);
    expect(shutWear / openWear).toBeCloseTo(0.25, 2);
  });

  it('flags the end of the day at closing time', () => {
    const state = createInitialGameState();
    state.dayState.gameTime = GAME_CONFIG.economy.dayEndHour - 0.01;
    state.dayState.timeSpeed = 1;

    const effects = createEffects();
    for (let i = 0; i < 200 && !effects.dayEnded; i++) {
      runSimulationTick(state, 0.05, effects);
    }

    expect(effects.dayEnded).toBe(true);
    expect(state.dayState.isDayEnding).toBe(true);
    expect(state.dayState.gameTime).toBe(GAME_CONFIG.economy.dayEndHour);
  });
});

describe('simulationEngine - random events', () => {
  it('applies a traffic event as a spawn multiplier', () => {
    const state = createInitialGameState();
    const effects = createEffects();
    const config = GAME_EVENTS.find((e) => e.id === 'rush_hour')!;

    expect(getEventModifiers(state).traffic).toBe(1);
    triggerEvent(state, config, effects);

    expect(state.activeEvents).toHaveLength(1);
    expect(getEventModifiers(state).traffic).toBeCloseTo(1.6, 2);
  });

  it('applies one-shot incident effects immediately and does not linger', () => {
    const state = createInitialGameState();
    state.station.cleanliness = 90;
    const effects = createEffects();
    const config = GAME_EVENTS.find((e) => e.id === 'fuel_spill')!;
    const repBefore = state.player.reputation;

    triggerEvent(state, config, effects);

    expect(state.station.cleanliness).toBe(65);
    expect(state.player.reputation).toBeLessThan(repBefore);
    // durationHours is 0, so nothing stays active.
    expect(state.activeEvents).toHaveLength(0);
    expect(state.todayEventIds).toContain('fuel_spill');
  });

  it('resolves the inspection from how clean the station is', () => {
    const config = GAME_EVENTS.find((e) => e.id === 'health_inspection')!;

    const clean = createInitialGameState();
    clean.station.cleanliness = 90;
    const repBeforeClean = clean.player.reputation;
    triggerEvent(clean, config, createEffects());
    expect(clean.player.reputation).toBeGreaterThan(repBeforeClean);

    const filthy = createInitialGameState();
    filthy.station.cleanliness = 20;
    const cashBefore = filthy.player.cash;
    triggerEvent(filthy, config, createEffects());
    expect(filthy.player.cash).toBeLessThan(cashBefore);
  });

  it('stops pumps serving while a power outage runs', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    triggerEvent(state, GAME_EVENTS.find((e) => e.id === 'power_outage')!, createEffects());

    expect(getEventModifiers(state).pumpsDisabled).toBe(true);

    // Stay inside the outage: an hour on the forecourt is ten seconds.
    advance(state, 6);
    expect(state.activeEvents).toHaveLength(1);

    // Cars still arrive, but none of them can be given a pump.
    for (const vehicle of Object.values(state.vehicles)) {
      expect(vehicle.state).not.toBe('AT_PUMP');
    }
    expect(state.pumps.pump_1.currentVehicleId).toBeNull();
  });

  it('expires timed events once their hours run out', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    triggerEvent(state, GAME_EVENTS.find((e) => e.id === 'rush_hour')!, createEffects());

    expect(state.activeEvents).toHaveLength(1);
    // 2 game hours at 16h per 600s => 75s of sim time.
    advance(state, 400);
    expect(state.activeEvents).toHaveLength(0);
  });
});

describe('simulationEngine - daily missions', () => {
  it('issues a fresh set of daily goals with one headline mission', () => {
    const state = createInitialGameState();
    state.player.level = 8;
    state.dayState.currentDay = 3;

    generateDailyMissions(state);

    const dailies = state.missions;
    expect(dailies.length).toBeGreaterThan(0);
    expect(dailies.filter((m) => m.type === 'DAILY_MAIN')).toHaveLength(1);

    for (const mission of dailies) {
      expect(mission.target).toBeGreaterThan(0);
      expect(mission.description).not.toContain('{n}');
      expect(mission.issuedOnDay).toBe(3);
    }
  });

  it('advances every mission watching the same metric at once', () => {
    const state = createInitialGameState();
    const effects = createEffects();
    const goal = (id: string, target: number) => ({
      id,
      templateId: id,
      type: 'DAILY_NORMAL' as const,
      description: id,
      metric: 'CUSTOMERS_SERVED' as const,
      target,
      progress: 0,
      rewardCash: 100,
      rewardXp: 10,
      completed: false,
      claimed: false,
      issuedOnDay: 1
    });
    state.missions = [goal('one', 1), goal('three', 3)];

    trackMissionMetric(state, 'CUSTOMERS_SERVED', 1, effects);

    expect(state.missions[0].completed).toBe(true);
    expect(state.missions[1].progress).toBe(1);
    expect(state.missions[1].completed).toBe(false);
  });

  it('keeps unclaimed goals when the next day is generated', () => {
    const state = createInitialGameState();
    state.player.level = 8;
    generateDailyMissions(state);

    const earned = state.missions[0];
    earned.completed = true;
    earned.progress = earned.target;

    state.dayState.currentDay = 2;
    generateDailyMissions(state);

    expect(state.missions.some((m) => m.id === earned.id)).toBe(true);
  });

  // Emre, 2026-09-12: goals are picked by what the station has, not only its level.
  it('posts no market-sales goal on a station with no shop to sell from', () => {
    const state = createInitialGameState();
    state.player.level = 8;
    expect(dailyTemplatesFor(state).map((t) => t.id)).not.toContain('D_MARKET');

    state.buildings.shop = { ...Object.values(state.buildings)[0], id: 'shop', type: 'mini_market' };
    expect(dailyTemplatesFor(state).map((t) => t.id)).toContain('D_MARKET');
  });
});

describe('simulationEngine - forecourt boundary', () => {
  it('keeps every parked or queueing vehicle on the concrete', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.cash = 200000;
    state.tanks.gasoline.capacity = 6000;
    state.tanks.gasoline.stock = 6000;

    // Three pumps and two attendants keep the lot busy enough to fill the queue.
    state.pumps.pump_2 = { ...state.pumps.pump_1, id: 'pump_2', position: [18, 10] };
    state.pumps.pump_3 = { ...state.pumps.pump_1, id: 'pump_3', position: [24, 10] };

    const margin = 0.1; // allow for float drift only
    const { width, height } = state.station.plots;

    // States where the vehicle is on the forecourt rather than the highway.
    const onLot = ['QUEUE', 'AT_PUMP', 'REQUEST', 'FUELING', 'PAYMENT', 'OPTIONAL_SHOP'];
    const offences: string[] = [];

    const step = 0.05;
    const effects = createEffects();
    for (let i = 0; i < 12000; i++) {
      runSimulationTick(state, step, effects);

      for (const vehicle of Object.values(state.vehicles)) {
        if (!onLot.includes(vehicle.state)) continue;
        const [x, , z] = vehicle.worldPosition;
        if (x < -margin || x > width + margin || z < -margin || z > height + margin) {
          offences.push(`${vehicle.state} @ ${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
      if (offences.length > 0) break;
    }

    expect(offences).toEqual([]);
  });

  it('never places a queue slot off the plot', () => {
    const state = createInitialGameState();
    const { width } = state.station.plots;

    // Walk further back than the queue can ever get.
    for (let slot = 0; slot < 10; slot++) {
      const [x, , z] = queueSlotPosition(state, slot);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(width);
      expect(z).toBeGreaterThan(0);
    }
  });
});

describe('simulationEngine - highway lanes and driveways', () => {
  it('keeps the station carriageway put when the road is upgraded', () => {
    const single = getLayout(createInitialGameState());
    const dual = getLayout(createInitialGameState());

    // Upgrading mirrors the road rather than widening it, so the lane the
    // station's traffic uses must not move underneath it.
    expect(single.roadLaneZ).toBe(LAYOUT.roadZ);
    expect(dual.roadLaneZ).toBe(single.roadLaneZ);
  });

  it('separates the two carriageways with a landscaped median', () => {
    const layout = getLayout(createInitialGameState());

    // The opposite carriageway sits on the far side of the centre.
    expect(layout.farRoadLaneZ).toBeLessThan(layout.roadLaneZ);

    // Their inner kerbs are exactly a median apart.
    const nearInner = layout.roadLaneZ - layout.roadHalfWidth;
    const farInner = layout.farRoadLaneZ + layout.roadHalfWidth;
    expect(nearInner - farInner).toBeCloseTo(LAYOUT.medianWidth, 5);
  });

  it('brings vehicles in at the entry and sends them out at the exit', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    const layout = getLayout(state);

    // Entry is upstream of exit, so a car meets the entry mouth first.
    expect(layout.entryX).toBeLessThan(layout.exitX);

    advanceUntil(
      state,
      (s) => Object.values(s.vehicles).some((v) => v.state === 'ROAD_APPROACH'),
      600
    );
    const arriving = Object.values(state.vehicles).find(
      (v) => v.state === 'ROAD_APPROACH'
    )!;

    // It heads for the entry driveway, never the exit one.
    expect(arriving.targetWaypoint?.[0]).toBe(layout.entryX);
  });

  it('sends arrivals down both lanes of a widened entrance', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.buildings.ramp = {
      id: 'ramp',
      type: 'wide_entry',
      level: 1,
      position: [4, DRIVEWAY_Z],
      rotation: 0,
      size: [6, 2],
      health: 100,
      constructionState: 'ACTIVE',
      builtAtTimestamp: 0
    };

    const mouth = drivewayMouths(state).entry;
    const lanes = new Set<number>();

    advanceUntil(
      state,
      (s) => {
        for (const v of Object.values(s.vehicles)) {
          if (v.state === 'ROAD_APPROACH' && v.targetWaypoint) lanes.add(v.targetWaypoint[0]);
        }
        return lanes.size > 1;
      },
      3000
    );

    // Two entrances, not one queue drawn twice as wide: cars take both.
    expect([...lanes].sort()).toEqual([drivewayLaneX(mouth, 0), drivewayLaneX(mouth, 1)]);
  });

  /**
   * The exit mouth sits at the end of the frontage, so its outer lane is
   * inside the margin a *parked* car is held to. Keeping the leg on the apron
   * by that figure pulled the lane onto the ramp's centre line, and cars left
   * a two-lane ramp straight down the middle of it.
   */
  it('leaves by the lanes of a widened exit rather than down the middle', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.buildings.ramp = {
      id: 'ramp',
      type: 'wide_exit',
      level: 1,
      position: [getLayout(state).exitX, DRIVEWAY_Z],
      rotation: 0,
      size: [6, 2],
      health: 100,
      constructionState: 'ACTIVE',
      builtAtTimestamp: 0
    };

    const mouth = drivewayMouths(state).exit;
    const block = blockLayout(state, 'near')!;
    const approaches = new Set<number>();

    advanceUntil(
      state,
      (s) => {
        for (const v of Object.values(s.vehicles)) {
          if (v.state !== 'EXIT') continue;
          // The waypoint the car lines up on before turning down the mouth:
          // the last one on the plot, just ahead of the run out to the road.
          const points = [v.targetWaypoint, ...v.route].filter(Boolean) as Array<
            [number, number, number]
          >;
          const onRoad = points.findIndex((p) => Math.abs(p[2] - block.roadLaneZ) < 0.01);
          if (onRoad > 0) approaches.add(Math.round(points[onRoad - 1][0] * 100) / 100);
        }
        return approaches.size > 3;
      },
      3000
    );

    const lanes = [drivewayLaneX(mouth, 0), drivewayLaneX(mouth, 1)];
    expect(approaches.size).toBeGreaterThan(0);

    // Every one of them stands in a lane rather than between the two: the
    // ramp's centre line is the one place a car leaving may not line up on.
    for (const x of approaches) {
      expect(Math.min(...lanes.map((lane) => Math.abs(x - lane)))).toBeLessThan(0.01);
    }
  });

  it('runs the same game on the block across the highway', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.station.roadLevel = 2;
    const far = ['0,-1', '1,-1', '0,-2', '1,-2'];
    state.station.plots.ownedParcels.push(...far);
    state.station.plots.pavedParcels.push(...far);

    // Every pump is across the road, so every customer has to go there. It
    // faces ITS road: the starting pump's 90° puts the bay toward the near
    // carriageway, and across the median that same bay lies on the far side
    // is 270°. At 90° over there the bay pointed at the back fence and the
    // island lay across the front lane — a route the planner would hand out
    // and no car could drive, which the engine now refuses to hand out.
    const proto = Object.values(state.pumps)[0];
    state.pumps = {
      pf: { ...proto, id: 'pf', position: [8, -19], rotation: 270, currentVehicleId: null, employeeId: null }
    };

    const farBlock = blockLayout(state, 'far')!;
    expect(farBlock.roadLaneZ).toBe(getLayout(state).farRoadLaneZ);
    // Its cars come from the other end of the road and queue the other way.
    expect(farBlock.roadStartX).toBeGreaterThan(farBlock.roadEndX);
    expect(farBlock.queueStep).toBeGreaterThan(0);

    advanceUntil(
      state,
      (s) => Object.values(s.vehicles).some((v) => v.targetPumpId === 'pf'),
      4000
    );

    const customer = Object.values(state.vehicles).find((v) => v.targetPumpId === 'pf')!;
    expect(customer).toBeDefined();
    // It spawned on the far carriageway and stayed on that side of the median.
    expect(vehicleSide(customer)).toBe('far');
  });

  it('keeps the road busy even with nothing to stop for', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.pumps = {};

    advanceUntil(state, (s) => Object.keys(s.vehicles).length > 0, 900);

    // The highway does not care what the player owns...
    expect(Object.keys(state.vehicles).length).toBeGreaterThan(0);
    // ...but with nothing to serve them, every driver goes straight past.
    expect(stopChance(state)).toBe(0);
    for (const v of Object.values(state.vehicles)) {
      expect(['PASSING', 'DESPAWN']).toContain(v.state);
    }
  });

  it('shows electric cars in through traffic before a charger is built', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.pumps = {};
    state.buildings = {};

    const appeared = advanceUntil(
      state,
      (s) => Object.values(s.vehicles).some((vehicle) => vehicle.archetype === 'ev'),
      1800
    );

    expect(appeared).toBe(true);
    const electricCar = Object.values(state.vehicles).find((vehicle) => vehicle.archetype === 'ev');
    expect(electricCar?.state).toBe('PASSING');
    expect(electricCar?.chargingBuildingId).toBeFalsy();
  });

  it('turns drivers away as the price climbs, and back with a rush', () => {
    const state = createInitialGameState();
    const regional = state.pricing.gasoline.regionalAverage;

    state.pricing.gasoline.playerPrice = regional * 0.92;
    const cheap = stopChance(state);

    state.pricing.gasoline.playerPrice = regional * 1.35;
    const dear = stopChance(state);

    expect(dear).toBeLessThan(cheap * 0.7);
    expect(dear).toBeGreaterThan(0);

    // A burst of custom lifts the same forecourt back up.
    state.dayState.rushSecondsLeft = 90;
    expect(stopChance(state)).toBeGreaterThan(dear);

    // Nobody ever stops the whole road, however good the offer.
    state.pricing.gasoline.playerPrice = regional * 0.5;
    expect(stopChance(state)).toBeLessThan(1);
  });

  it('sends drivers to a block that has only a shop, and pays it once they can park', () => {
    const shopOnly = (park: boolean): GameState => {
      const state = createInitialGameState();
      state.dayState.timeSpeed = 1;
      state.player.level = 12;
      state.pumps = {};
      state.market.active = true;
      state.market.stock = 999;
      state.buildings.mk = {
        id: 'mk',
        type: 'mini_market',
        level: 1,
        position: [4, 8],
        rotation: 0,
        size: [5, 4],
        health: 100,
        constructionState: 'ACTIVE',
        builtAtTimestamp: 0,
        till: 0,
        todayRevenue: 0,
        todayVisits: 0
      };
      if (park) {
        state.buildings.park = {
          id: 'park',
          type: 'car_park',
          level: 1,
          position: [9.5, 10.5],
          rotation: 0,
          size: [5, 3],
          health: 100,
          constructionState: 'ACTIVE',
          builtAtTimestamp: 0
        };
      }
      return state;
    };

    // A forecourt with no pumps is still worth pulling into for the shop.
    expect(stopChance(shopOnly(false))).toBeGreaterThan(0);

    // But there is nowhere to leave the car. The drivers turn in, find no
    // bay, and go — exactly as they would at a full car park in life, and
    // the till stays shut (Emre, 2026-09-10). The old code paid the shop a
    // fraction "through the window" for a visit that never happened.
    const bare = shopOnly(false);
    advanceUntil(bare, (s) => s.dayState.todayStats.marketRevenue > 0, 4000);
    expect(bare.dayState.todayStats.marketRevenue).toBe(0);
    expect(bare.buildings.mk.todayVisits ?? 0).toBe(0);

    // A park is what turns those same drivers into customers.
    const parked = shopOnly(true);
    advanceUntil(parked, (s) => s.dayState.todayStats.marketRevenue > 0, 4000);
    expect(parked.dayState.todayStats.marketRevenue).toBeGreaterThan(0);
    expect(parked.buildings.mk.todayVisitsFromPark ?? 0).toBeGreaterThan(0);
  });

  it('keeps traffic bodies apart on the road and forecourt without gridlock', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.85;

    let pairs = 0;
    let touching = 0;
    let longestTransit = 0;
    const enteredTransit = new Map<string, number>();

    for (let tick = 0; tick < 3000 && !state.dayState.isDayEnding; tick++) {
      runSimulationTick(state, 0.2, createEffects());
      const vehicles = Object.values(state.vehicles);

      for (let a = 0; a < vehicles.length; a++) {
        for (let b = a + 1; b < vehicles.length; b++) {
          pairs++;
          if (vehicleBodiesOverlap(vehicles[a], vehicles[b])) touching++;
        }
      }

      // These states have nothing to wait for but the road ahead, so a car
      // that sits in one of them is a car the traffic rules have wedged.
      // Measured over EVERY vehicle, on and off the road.
      for (const vehicle of Object.values(state.vehicles)) {
        if (!['PASSING', 'ROAD_APPROACH', 'EXIT'].includes(vehicle.state)) {
          enteredTransit.delete(vehicle.id);
          continue;
        }
        if (!enteredTransit.has(vehicle.id)) enteredTransit.set(vehicle.id, tick);
        longestTransit = Math.max(longestTransit, (tick - enteredTransit.get(vehicle.id)!) * 0.2);
      }
    }

    expect(pairs).toBeGreaterThan(1000);
    expect(touching).toBe(0);
    expect(longestTransit).toBeLessThan(120);
  });

  it('makes the facilities on a block worth what they cost', () => {
    const state = createInitialGameState();
    const bare = stopChance(state);

    state.buildings.cw = {
      id: 'cw', type: 'car_wash', level: 1, position: [13, 4], rotation: 0,
      size: [5, 5], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    state.buildings.wc = {
      id: 'wc', type: 'toilet', level: 1, position: [13, 11], rotation: 0,
      size: [2, 2], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };

    const kitted = blockFacilities(state, 'near');
    // A wash and a toilet pull traffic in, hold it longer and sell it something.
    expect(kitted.appeal).toBeGreaterThan(0);
    expect(kitted.patience).toBeGreaterThan(0);
    expect(kitted.services.length).toBe(1);
    expect(stopChance(state)).toBeGreaterThan(bare);

    // Upgrading in place is worth more than the same building at level one.
    const atOne = blockFacilities(state, 'near').appeal;
    state.buildings.cw.level = 3;
    expect(blockFacilities(state, 'near').appeal).toBeGreaterThan(atOne);

    // Nothing on this side is credited to the block across the road.
    expect(blockFacilities(state, 'far').appeal).toBe(0);
  });

  it('opens the electric line only once there is somewhere to plug in', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.level = 12;

    // A charger with no substation behind it is a bollard.
    state.buildings.dc = {
      id: 'dc', type: 'ev_charger_dc', level: 1, position: [13, 8], rotation: 0,
      size: [1, 2], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    expect(chargingPoints(state, 'near')).toHaveLength(0);

    // Behind the bays rather than across the way in: a substation parked on
    // the driveway is a blocked driveway, and cars stay on the road.
    state.buildings.sub = {
      id: 'sub', type: 'ev_substation', level: 1, position: [13, 12], rotation: 0,
      size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    // Fed, but with nothing to draw from: still a bollard until a bank stands.
    expect(chargingPoints(state, 'near')).toHaveLength(0);
    state.buildings.bank = {
      id: 'bank', type: 'ev_storage', level: 1, position: [9.5, 12.5], rotation: 0,
      size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0, energyKwh: 200
    };
    expect(chargingPoints(state, 'near')).toHaveLength(1);

    // And now electric customers actually turn up and pay for a charge.
    advanceUntil(
      state,
      (s) => {
        // Elektrikli müşterinin gelişi zar işi; gün kapanırsa hiç gelemez.
        // Test şarj hattını sınıyor, gün uzunluğunu değil — öğlen sabit.
        s.dayState.gameTime = 12;
        return Object.values(s.vehicles).some((v) => v.chargingBuildingId === 'dc');
      },
      6000
    );
    expect(
      Object.values(state.vehicles).some((v) => v.chargingBuildingId === 'dc')
    ).toBe(true);
  });

  it('lays out every plot shape without falling over', () => {
    // The lane geometry is derived, and a derivation that throws takes the
    // whole tick with it — no traffic at all, on a plot that looks fine.
    for (const depth of [7, 14, 21, 28]) {
      for (const width of [8, 16, 32, 48]) {
        const state = createInitialGameState();
        state.station.roadLevel = 2;
        state.station.plots.width = width;
        state.station.plots.height = depth;
        state.station.plots.ownedParcels = ['0,0', '0,-1'];
        state.station.plots.pavedParcels = ['0,0', '0,-1'];

        for (const side of ['near', 'far'] as const) {
          const block = blockLayout(state, side);
          expect(block, `${side} block at ${width}x${depth}`).not.toBeNull();
          expect(Number.isFinite(block!.laneZ)).toBe(true);
          expect(Number.isFinite(block!.exitLaneZ)).toBe(true);
          expect(Number.isFinite(block!.queueZ)).toBe(true);
        }
      }
    }
  });

  it('steers round a building standing in the way instead of through it', () => {
    // The café is put where the lane runs and where the route to the pump
    // crosses, so a car that cannot steer round it has to drive through it.
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.reputation = 5;
    state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.75;
    state.station.plots.ownedParcels = ['0,0', '1,0', '0,1', '1,1'];
    state.station.plots.pavedParcels = ['0,0', '1,0', '0,1', '1,1'];
    state.pumps.pump_1.position = [12, 8];

    const cafe = { minX: 4.5, maxX: 9.5, minZ: 2, maxZ: 6 };
    state.buildings.blocker = {
      id: 'blocker', type: 'cafe', level: 1, position: [7, 4], size: [5, 4],
      health: 100, rotation: 0, constructionState: 'ACTIVE', builtAtTimestamp: 0
    } as GameState['buildings'][string];

    const effects = createEffects();
    const trespassers: string[] = [];
    let arrived = false;

    for (let i = 0; i < 12000; i++) {
      runSimulationTick(state, 0.05, effects);
      for (const v of Object.values(state.vehicles)) {
        const [x, , z] = v.worldPosition;
        if (v.state === 'AT_PUMP' || v.state === 'QUEUE') arrived = true;
        if (x > cafe.minX && x < cafe.maxX && z > cafe.minZ && z < cafe.maxZ) {
          trespassers.push(`${v.state} @ ${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
      if (trespassers.length > 0) break;
    }

    // Cars must still get in and be served — steering round it is the point,
    // not refusing to come.
    expect(arrived).toBe(true);
    expect(trespassers, 'kahvecinin içinden geçen araç').toEqual([]);
  });

  it('leaves the approach lane where it belongs when nothing is on it', () => {
    // The lane sits just inside the mouth. Everything downstream — the bays,
    // the lay-by, the tuning that stops the forecourt seizing up — is measured
    // from it, so it must not wander because something was built nearby.
    const state = createInitialGameState();
    expect(blockLayout(state, 'near')!.laneZ).toBe(4);
    expect(blockLayout(state, 'near')!.laneClear).toBeGreaterThan(0);
  });

  it('moves the approach lane off a building standing where it used to run', () => {
    // The lane used to be pinned four units in from the road whatever was
    // there, so a shop on that line meant cars driving through its walls.
    const state = createInitialGameState();
    state.buildings = {};
    state.pumps = {};

    expect(blockLayout(state, 'near')!.laneZ).toBe(4);

    state.buildings.blocker = {
      id: 'blocker', type: 'cafe', level: 1, position: [8, 4], size: [3, 3],
      health: 100, rotation: 0, constructionState: 'ACTIVE', builtAtTimestamp: 0
    } as GameState['buildings'][string];

    const after = blockLayout(state, 'near')!;

    // Clear of the café — which stands from z 2.5 to 5.5 — with room for the
    // width of a car, on the lane, the lay-by and the way back out.
    expect(after.laneClear).toBeGreaterThan(0);
    for (const [name, laneZ] of [
      ['giriş şeridi', after.laneZ],
      ['çıkış şeridi', after.exitLaneZ],
      ['kuyruk cebi', after.queueZ]
    ] as const) {
      const clear = laneZ < 2.5 ? 2.5 - laneZ : laneZ > 5.5 ? laneZ - 5.5 : -1;
      expect(clear, `${name} kahvecinin içinden geçiyor (z=${laneZ})`).toBeGreaterThan(0);
    }
  });

  it('keeps traffic coming on a plot only one row deep', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.station.roadLevel = 2;
    state.station.plots.ownedParcels = ['0,0', '1,0', '0,-1', '1,-1'];
    state.station.plots.pavedParcels = ['0,0', '1,0', '0,-1', '1,-1'];
    state.station.plots.height = 7;

    advanceUntil(state, (s) => Object.keys(s.vehicles).length > 0, 900);
    expect(Object.keys(state.vehicles).length).toBeGreaterThan(0);
  });

  it('never lets the forecourt seize up', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.reputation = 5;
    state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.75;

    const proto = Object.values(state.pumps)[0];
    state.pumps = {
      a: { ...proto, id: 'a', position: [6, 7], currentVehicleId: null, employeeId: null },
      b: { ...proto, id: 'b', position: [11, 7], currentVehicleId: null, employeeId: null }
    };

    // States with nothing to wait for but the road: a car in one of these is
    // either moving or the traffic rules have wedged it against another car.
    const rolling = ['PASSING', 'ROAD_APPROACH', 'EXIT', 'PUMP_RESERVED'];
    const lastMoved = new Map<string, { tick: number; x: number; z: number }>();
    let longestStill = 0;

    for (let tick = 0; tick < 6000 && !state.dayState.isDayEnding; tick++) {
      runSimulationTick(state, 0.2, createEffects());

      for (const vehicle of Object.values(state.vehicles)) {
        // Only while they are meant to be moving. A car parked at a pump is
        // supposed to sit still, and carrying its last position across that
        // stop would report the whole visit as a stall the moment it pulls
        // away again.
        if (!rolling.includes(vehicle.state)) {
          lastMoved.delete(vehicle.id);
          continue;
        }

        const [x, , z] = vehicle.worldPosition;
        const seen = lastMoved.get(vehicle.id);

        if (!seen || Math.hypot(x - seen.x, z - seen.z) > 0.05) {
          lastMoved.set(vehicle.id, { tick, x, z });
          continue;
        }
        longestStill = Math.max(longestStill, (tick - seen.tick) * 0.2);
      }
    }

    expect(longestStill).toBeLessThan(30);
    // And the plot has not silently filled with cars that can no longer leave.
    const leaving = Object.values(state.vehicles).filter((v) => v.state === 'EXIT');
    expect(leaving.length).toBeLessThan(8);
  });

  it('runs traffic the length of the road and around what is built on the plot', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.85;

    const office = state.buildings.office_1;
    let reach = 0;
    let insideBuilding = 0;

    for (let tick = 0; tick < 1500 && !state.dayState.isDayEnding; tick++) {
      runSimulationTick(state, 0.2, createEffects());

      for (const vehicle of Object.values(state.vehicles)) {
        const [x, , z] = vehicle.worldPosition;
        reach = Math.max(reach, Math.abs(x - state.station.plots.width / 2));

        if (
          Math.abs(x - office.position[0]) < office.size[0] / 2 &&
          Math.abs(z - office.position[1]) < office.size[1] / 2
        ) {
          insideBuilding++;
        }
      }
    }

    // Cars join and leave the highway well off the edge of the screen rather
    // than appearing halfway down a road the player is looking at.
    expect(reach).toBeGreaterThan(LAYOUT.roadMargin);
    // And the lanes route around the office instead of through its walls.
    expect(insideBuilding).toBe(0);
  });

  it('spawns vehicles on a driving lane', () => {
    const state = createInitialGameState();
    state.station.roadLevel = 2;
    state.dayState.timeSpeed = 1;

    advanceUntil(state, (s) => Object.keys(s.vehicles).length > 0, 600);
    const vehicle = Object.values(state.vehicles)[0];

    // Çift şeritli yolda araç iki şeridin BİRİNDE doğar — karşı arsa hiç
    // kurulmamışken bile: yol trafiği oyuncunun betonunu beklemez. Şerit
    // dışında (tarlada, önalanda) doğmak ise hâlâ yasak.
    const nearLaneZ = getLayout(state).roadLaneZ;
    const farLaneZ = LAYOUT.roadZ - 2 * LAYOUT.roadHalfWidth - LAYOUT.medianWidth;
    const z = vehicle.worldPosition[2];
    expect(Math.min(Math.abs(z - nearLaneZ), Math.abs(z - farLaneZ))).toBeLessThan(0.001);
  });
});

describe('the delivery lorry', () => {
  it('drives in, docks at its own fuel’s tank, unloads and leaves', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.level = 12;
    state.player.cash = 500_000;

    const effects = createEffects();
    expect(placeFuelOrder(state, 'diesel', 800, effects)).toBe(true);
    const order = state.fuelOrders[0];
    order.remainingSeconds = 0.1;

    // The supplier timer runs out; the lorry turns off the highway.
    advanceUntil(state, (s) => !!s.fuelOrders[0]?.truck, 30);
    expect(order.truck).toBeTruthy();
    expect(order.truck!.tankBuildingId).toBe('tank_1');

    // It reaches the bay beside the diesel tank and starts pumping.
    const unloading = advanceUntil(state, (s) => s.fuelOrders[0]?.state === 'UNLOADING', 600);
    expect(unloading).toBe(true);
    // The farm stands at [14,12]; the diesel berth is on its road side.
    const [tx, , tz] = order.truck!.worldPosition;
    expect(Math.hypot(tx - 14, tz - 12)).toBeLessThan(4.5);

    // The fuel lands in the diesel tank, and the lorry pulls out and is gone.
    const stockBefore = state.tanks.diesel.stock;
    advanceUntil(state, (s) => s.fuelOrders.length === 0, 900);
    expect(state.fuelOrders).toHaveLength(0);
    expect(state.tanks.diesel.stock).toBeGreaterThan(stockBefore);
  });
});

describe('the lorry shares the forecourt', () => {
  it('never lets a lorry and a car occupy the same ground', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.level = 12;
    state.player.cash = 500_000;

    const effects = createEffects();
    expect(placeFuelOrder(state, 'gasoline', 800, effects)).toBe(true);
    state.fuelOrders[0].remainingSeconds = 0.1;

    const overlaps: string[] = [];
    for (let i = 0; i < 6000; i++) {
      runSimulationTick(state, 0.2, effects);
      for (const order of state.fuelOrders) {
        const truck = order.truck;
        if (!truck) continue;
        // The lorry is three car-lengths of steel: nose, middle and tail all
        // have to stay clear of every car.
        const dx = Math.sin(truck.heading);
        const dz = Math.cos(truck.heading);
        for (const along of [-1.1, 0, 1.1]) {
          const bx = truck.worldPosition[0] + dx * along;
          const bz = truck.worldPosition[2] + dz * along;
          const body = {
            archetype: 'commuter', modelVariant: 'sedan', heading: truck.heading,
            worldPosition: [bx, 0, bz]
          } as VehicleEntity;
          for (const vehicle of Object.values(state.vehicles)) {
            if (vehicleBodiesOverlap(vehicle, body)) {
              overlaps.push(
                `${order.state}/${truck.phase} segment=${along} car=${vehicle.state} ` +
                `truck=${truck.worldPosition[0].toFixed(2)},${truck.worldPosition[2].toFixed(2)} ` +
                `car=${vehicle.worldPosition[0].toFixed(2)},${vehicle.worldPosition[2].toFixed(2)} ` +
                `heads=${truck.heading.toFixed(2)}/${vehicle.heading.toFixed(2)}`
              );
            }
          }
        }
      }
      if (state.fuelOrders.length === 0) break;
    }

    expect(overlaps).toEqual([]);
  });

  // Emre'nin 2026-09-02 kararı: tankerler birbirini BEKLEMEZ — hepsi aynı
  // anda girer ve boşaltır, boşaltırken üst üste gelmeleri kabul edilir.
  // Bu test eskiden tam tersini (bir tanker diğerini beklesin) çiviliyordu.
  it('unloads two lorries at the same time instead of queueing them', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.level = 12;
    state.player.cash = 500_000;
    state.pumps.pump_1.supportedFuels.push('diesel');

    const effects = createEffects();
    placeFuelOrder(state, 'gasoline', 800, effects);
    placeFuelOrder(state, 'diesel', 800, effects);
    for (const order of state.fuelOrders) order.remainingSeconds = 0.1;

    let bothHosesRan = false;
    for (let i = 0; i < 6000; i++) {
      runSimulationTick(state, 0.2, effects);
      if (state.fuelOrders.filter((o) => o.state === 'UNLOADING').length === 2) {
        bothHosesRan = true;
      }
      if (state.fuelOrders.length === 0) break;
    }

    expect(bothHosesRan).toBe(true);
    expect(state.tanks.gasoline.stock).toBeGreaterThan(0);
    expect(state.tanks.diesel.stock).toBeGreaterThan(0);
  });
});

describe('the day rolls over without stopping', () => {
  it('carries the forecourt straight into the next morning', () => {
    // The store is UI code: it saves and plays sounds through the browser.
    (globalThis as any).window = {};
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    };

    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.level = 12;
    state.player.cash = 200_000;

    // Run to closing time with the station busy.
    const effects = createEffects();
    let ended = false;
    for (let i = 0; i < 30000; i++) {
      runSimulationTick(state, 0.5, effects);
      if (effects.dayEnded) { ended = true; break; }
    }
    expect(ended).toBe(true);
    const onPlot = Object.keys(state.vehicles).length;

    useGameStore.setState({ gameState: state });
    useGameStore.getState().endDayAndShowReport();

    const after = useGameStore.getState().gameState;
    // A new day, already running — and the cars that were here are still here.
    expect(after.dayState.currentDay).toBe(2);
    expect(after.dayState.isDayActive).toBe(true);
    expect(after.dayState.timeSpeed).toBe(1);
    expect(Object.keys(after.vehicles).length).toBe(onPlot);
    // Yesterday's till is closed off, not carried forward.
    expect(after.dayState.todayStats.fuelRevenue).toBe(0);
  });
});

describe('price, demand and reputation', () => {
  it('lets a gouged diesel board turn traffic away, not just petrol', () => {
    // Demand used to read the petrol price alone: diesel and LPG could be
    // priced at anything without a single driver noticing.
    const base = createInitialGameState();
    base.pumps.pump_1.supportedFuels.push('diesel');

    const gouged = createInitialGameState();
    gouged.pumps.pump_1.supportedFuels.push('diesel');
    gouged.pricing.diesel.playerPrice = gouged.pricing.diesel.regionalAverage * 1.25;

    expect(stopChance(gouged)).toBeLessThan(stopChance(base));
  });

  it('lets a day of undercutting the region lift reputation', () => {
    const cheap = createInitialGameState();
    cheap.pricing.gasoline.playerPrice = cheap.pricing.gasoline.regionalAverage * 0.9;
    expect(dailyPriceReputationDelta(cheap)).toBeGreaterThan(0);

    const dear = createInitialGameState();
    dear.pricing.gasoline.playerPrice = dear.pricing.gasoline.regionalAverage * 1.2;
    expect(dailyPriceReputationDelta(dear)).toBeLessThan(0);
  });

  it('sells a charging customer a forecourt service, but never a walk-in visit', () => {
    const state = createInitialGameState();
    state.player.level = 12;
    // Two kinds of building, and the difference between them is the point.
    // The wash sells to the car, at the pump, on the way out. The café sells
    // to a person who walks through its door — and a driver whose battery is
    // full is finished here, so nobody walks anywhere.
    state.buildings.wash = {
      id: 'wash', type: 'car_wash', level: 1, position: [4, 11], rotation: 0,
      size: [4, 4], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    state.buildings.cafe = {
      id: 'cafe', type: 'cafe', level: 1, position: [12, 11], rotation: 0,
      size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0,
      till: 0, todayRevenue: 0, todayVisits: 0
    };

    const effects = createEffects();
    for (let i = 0; i < 50; i++) {
      const id = `ev_${i}`;
      state.vehicles[id] = {
        id, archetype: 'ev', fuelType: 'gasoline', tankCapacity: 60, currentFuel: 20,
        request: {
          mode: 'FULL', targetValue: 40, calculatedLiters: 40, calculatedPrice: 0,
          dispensedLiters: 0, isFinished: false
        },
        patience: 30, maxPatience: 60, satisfaction: 100, state: 'AT_PUMP',
        targetPumpId: null, assignedActor: null, worldPosition: [10, 0, 8],
        targetWaypoint: null, route: [], heading: 0, speed: 1, routeProgress: 0,
        waitingTimeSeconds: 0, shoppingIntent: false, chargingBuildingId: null,
        chargeSecondsLeft: 0
      } as GameState['vehicles'][string];
      finalizeCharge(state, state.vehicles[id], effects);
    }

    // Fifty customers past a wash with a 25% catch rate: the till has rung.
    // "Uses the facilities while waiting" was flavour text before that.
    expect(state.dayState.todayStats.marketRevenue).toBeGreaterThan(0);
    expect(state.dayState.todayStats.customersServed).toBe(50);

    // The café takes nothing, and that is correct rather than a shortfall.
    // Money it had not earned used to be credited here on the grounds that
    // the driver "might" have popped in; the player could see the figure and
    // never the customer (Emre, 2026-09-10). A café is paid at its own door.
    expect(state.buildings.cafe.till ?? 0).toBe(0);
    expect(state.buildings.cafe.todayVisits ?? 0).toBe(0);

    // And the money is a till roll, not a second trip: a charged car leaves
    // rather than setting off across the apron for a park.
    expect(
      Object.values(state.vehicles).every((v) => v.state === 'EXIT' || v.state === 'DESPAWN')
    ).toBe(true);
  });
});

describe('withdrawing a service mid-visit', () => {
  // Selling or carting off the hardware somebody is being served by is the
  // player's own way of losing a customer. The car must leave at once — not
  // wait out a patience timer at a post that no longer exists — and it must
  // cost the station its name the way any lost customer does.

  /**
   * A shop-only forecourt with somewhere to leave the car: no pumps, one
   * shop, one four-bay park behind it. The drivers who stop are there for the
   * shop and nothing else, and the park is what lets them get to its door —
   * without it they find no bay and drive straight out again.
   */
  function shopWithPark(): GameState {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.level = 12;
    state.pumps = {};
    state.market.active = true;
    state.market.stock = 999;
    state.buildings.mk = {
      id: 'mk', type: 'mini_market', level: 1, position: [4, 8], rotation: 0,
      size: [5, 4], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    state.buildings.park = {
      id: 'park', type: 'car_park', level: 1, position: [9.5, 10.5], rotation: 0,
      size: [5, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    return state;
  }

  it('sends a charging customer away, at a price, when their post is removed', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.level = 12;

    state.buildings.dc = {
      id: 'dc', type: 'ev_charger_dc', level: 1, position: [13, 8], rotation: 0,
      size: [1, 2], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    state.buildings.sub = {
      id: 'sub', type: 'ev_substation', level: 1, position: [13, 12], rotation: 0,
      size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    state.buildings.bank = {
      id: 'bank', type: 'ev_storage', level: 1, position: [9.5, 12.5], rotation: 0,
      size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0, energyKwh: 200
    };

    advanceUntil(
      state,
      (s) => {
        // Elektrikli müşterinin gelişi zar işi; gün kapanırsa hiç gelemez.
        // Test şarj hattını sınıyor, gün uzunluğunu değil — öğlen sabit.
        s.dayState.gameTime = 12;
        return Object.values(s.vehicles).some((v) => v.chargingBuildingId === 'dc');
      },
      6000
    );
    const car = Object.values(state.vehicles).find((v) => v.chargingBuildingId === 'dc')!;
    const reputation = state.player.reputation;
    const lost = state.dayState.todayStats.customersLost;

    delete state.buildings.dc;
    advance(state, 1);

    expect(car.chargingBuildingId).toBeNull();
    expect(['EXIT', 'DESPAWN']).toContain(car.state);
    expect(state.player.reputation).toBeLessThan(reputation);
    expect(state.dayState.todayStats.customersLost).toBe(lost + 1);
  });

  it('cuts off a plugged-in charge when the substation is sold, not just the queue', () => {
    // The guard used to check only that the charger building still existed, so
    // selling the substation left customers charging at dead hardware — and
    // paying for it.
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.level = 12;

    state.buildings.dc = {
      id: 'dc', type: 'ev_charger_dc', level: 1, position: [13, 8], rotation: 0,
      size: [1, 2], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    state.buildings.sub = {
      id: 'sub', type: 'ev_substation', level: 1, position: [13, 12], rotation: 0,
      size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    state.buildings.bank = {
      id: 'bank', type: 'ev_storage', level: 1, position: [9.5, 12.5], rotation: 0,
      size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0, energyKwh: 200
    };

    advanceUntil(
      state,
      (s) => {
        // Elektrikli müşterinin gelişi zar işi; gün kapanırsa hiç gelemez.
        // Test şarj hattını sınıyor, gün uzunluğunu değil — öğlen sabit.
        s.dayState.gameTime = 12;
        return Object.values(s.vehicles).some((v) => v.chargingBuildingId === 'dc');
      },
      6000
    );
    const car = Object.values(state.vehicles).find((v) => v.chargingBuildingId === 'dc')!;
    const served = state.dayState.todayStats.customersServed;

    delete state.buildings.sub;
    advance(state, 1);

    expect(car.chargingBuildingId).toBeNull();
    expect(['EXIT', 'DESPAWN']).toContain(car.state);
    // And they were not billed for electricity that never flowed.
    expect(state.dayState.todayStats.customersServed).toBe(served);
  });

  it('never releases a reservation the evicted customer did not hold', () => {
    // A reservation is made in beginFueling and nowhere else. Clearing a
    // queue used to release each queued car's *intended* litres, which ate
    // the live hold of the customer actually at the pump.
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.reputation = 5;
    state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.8;

    advanceUntil(
      state,
      (s) =>
        Object.values(s.vehicles).some((v) => v.state === 'AT_PUMP') &&
        Object.values(s.vehicles).some((v) => v.state === 'QUEUE'),
      4000
    );
    const atPump = Object.values(state.vehicles).find((v) => v.state === 'AT_PUMP')!;
    const effects = createEffects();
    expect(beginFueling(state, atPump, 'LITERS', 20, 'PLAYER', effects)).toBe(true);
    expect(state.tanks.gasoline.reservedStock).toBeCloseTo(20, 1);

    // Selling the pumps clears the queue — but only the queue's own holds,
    // of which there are none.
    state.pumps = {};
    advance(state, 1);

    expect(
      Object.values(state.vehicles).filter((v) => v.state === 'QUEUE')
    ).toHaveLength(0);
    expect(state.tanks.gasoline.reservedStock).toBeCloseTo(20, 1);
  });

  it('loses the visitor inside a facility that is sold, unless an upgrade absorbed it', () => {
    const state = shopWithPark();

    advanceUntil(
      state,
      (s) => Object.values(s.vehicles).some((v) => v.state === 'VISITING'),
      6000
    );
    const shopper = Object.values(state.vehicles).find((v) => v.state === 'VISITING')!;
    expect(shopper.visitBuildingId).toBe('mk');

    const lost = state.dayState.todayStats.customersLost;
    const reputation = state.player.reputation;
    delete state.buildings.mk;
    advance(state, 1);

    expect(['EXIT', 'DESPAWN']).toContain(shopper.state);
    expect(state.dayState.todayStats.customersLost).toBe(lost + 1);
    expect(state.player.reputation).toBeLessThan(reputation);
  });

  it('moves a visit into the rest complex that absorbed its shop', () => {
    const state = shopWithPark();

    advanceUntil(
      state,
      (s) => Object.values(s.vehicles).some((v) => v.state === 'VISITING'),
      6000
    );
    const shopper = Object.values(state.vehicles).find((v) => v.state === 'VISITING')!;

    // The shop is built over, not torn down: its customer keeps shopping.
    delete state.buildings.mk;
    state.buildings.rc = {
      id: 'rc', type: 'rest_complex', level: 1, position: [4, 8], rotation: 0,
      size: [12, 6], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    const lost = state.dayState.todayStats.customersLost;
    advance(state, 0.5);

    expect(shopper.visitBuildingId).toBe('rc');
    expect(state.dayState.todayStats.customersLost).toBe(lost);
  });

  it('clears the queue at once when the last pump on the block is sold', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.player.reputation = 5;
    state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.8;

    advanceUntil(
      state,
      (s) => Object.values(s.vehicles).some((v) => v.state === 'QUEUE'),
      4000
    );
    const queued = Object.values(state.vehicles).find((v) => v.state === 'QUEUE')!;
    const lost = state.dayState.todayStats.customersLost;

    state.pumps = {};
    advance(state, 1);

    // Gone immediately — a full patience bar is no reason to keep a driver
    // waiting for a pump that has been carted off in front of them.
    expect(['EXIT', 'DESPAWN']).toContain(queued.state);
    expect(state.dayState.todayStats.customersLost).toBeGreaterThan(lost);
    expect(state.player.reputation).toBeLessThan(5);
  });
});

describe('the manager', () => {
  // Emre, 2026-09-07: the manager comes in grades and works in rounds. Each
  // grade adds duties and looks more often; every duty is a toggle the
  // player can take away, but a duty the grade has not unlocked is not done
  // however the toggle reads.
  function withManager(level: number): GameState {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.station.open = false;
    state.player.cash = 300000;
    state.player.level = 12;
    state.station.managerId = 'mgr';
    state.station.managerLevel = level;
    return state;
  }

  it('services a worn bay at the first grade, but repairs a failed one only from the second', () => {
    const state = withManager(1);
    state.pumps.pump_1.health = 30;
    const cash = state.player.cash;
    advance(state, 1);
    expect(state.pumps.pump_1.health).toBeCloseTo(100, 0);
    expect(state.player.cash).toBeLessThan(cash);

    state.pumps.pump_1.health = 0;
    state.pumps.pump_1.state = 'BROKEN';
    advance(state, 120);
    expect(state.pumps.pump_1.state).toBe('BROKEN');

    state.station.managerLevel = 2;
    advance(state, 60);
    expect(state.pumps.pump_1.state).toBe('IDLE');
    // Repaired to full, then worn a touch by the rest of the minute.
    expect(state.pumps.pump_1.health).toBeGreaterThan(95);
  });

  it('leaves alone a duty the player has switched off', () => {
    const state = withManager(2);
    state.managerSettings.autoRepair = false;
    state.pumps.pump_1.health = 0;
    state.pumps.pump_1.state = 'BROKEN';
    advance(state, 90);
    expect(state.pumps.pump_1.state).toBe('BROKEN');
  });

  it('sweeps the forecourt from the second grade', () => {
    const junior = withManager(1);
    junior.station.cleanliness = 30;
    advance(junior, 1);
    expect(junior.station.cleanliness).toBeLessThan(31);

    const senior = withManager(2);
    senior.station.cleanliness = 30;
    advance(senior, 1);
    expect(senior.station.cleanliness).toBeGreaterThan(50);
    expect(senior.player.cash).toBe(300000 - GAME_CONFIG.economy.siteCleanCost);
  });

  it('fills the tanks when the supplier discount opens, at the top grade only', () => {
    const half = (s: GameState) => {
      s.tanks.gasoline.stock = s.tanks.gasoline.capacity * 0.5;
      s.tanks.gasoline.reservedStock = 0;
    };
    const junior = withManager(2);
    half(junior);
    junior.dayState.fuelDealSecondsLeft = 60;
    advance(junior, 40);
    expect(junior.fuelOrders).toHaveLength(0);

    const senior = withManager(3);
    half(senior);
    senior.dayState.fuelDealSecondsLeft = 60;
    advance(senior, 40);
    const order = senior.fuelOrders.find((o) => o.fuelType === 'gasoline');
    expect(order).toBeDefined();
    // Right up to the brim, at the discounted price.
    const room = senior.tanks.gasoline.capacity * 0.5;
    expect(order!.liters).toBe(Math.floor(room / GAME_CONFIG.fuels.gasoline.orderStepLiters) * GAME_CONFIG.fuels.gasoline.orderStepLiters);
    expect(order!.unitCost).toBeLessThan(senior.pricing.gasoline.todayWholesaleCost);
  });

  it('works in rounds: a tank that runs down between looks waits for the next one', () => {
    const state = withManager(1);
    state.managerSettings.autoFuelOrder = true;
    state.managerSettings.orderThresholdPercent = 20;
    advance(state, 1);
    state.tanks.gasoline.stock = state.tanks.gasoline.capacity * 0.1;
    state.tanks.gasoline.reservedStock = 0;
    advance(state, 20);
    expect(state.fuelOrders).toHaveLength(0);
    advance(state, 30);
    expect(state.fuelOrders.some((o) => o.fuelType === 'gasoline')).toBe(true);
  });
});
