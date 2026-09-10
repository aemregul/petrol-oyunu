import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity, BuildingEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import {
  createEffects,
  runSimulationTick,
  beginFueling,
  dispenseStep,
  finalizeSale,
  finalizeCharge,
  blockFacilities,
  facilityOnlyShare,
  PUMP_WALK_SHARE
} from '../domain/services/simulationEngine';
import {
  parkingBay,
  parkingBayCount,
  parkingTypeFor,
  facilityDoor,
  facilityMoralPoints,
  facilitySpend,
  collectTill,
  collectAllTills
} from '../domain/services/facilities';
import { useGameStore } from '../store/gameStore';
import { evaluatePlacement, snapPlacement, getFootprint } from '../domain/services/placement';
import { stationBounds } from '../domain/services/land';
import { wallRects, inRects } from '../domain/services/pathfinding';

/**
 * The buildings people walk into: a car park that is actually used, a driver
 * who gets out and walks, a till that fills and has to be emptied, and a
 * manager who empties it on rounds. Every number the panel shows is pinned
 * here, so the card the player reads and the money they get agree.
 */

/**
 * Pins Math.random to one value, so every decision on the way is known. A
 * hair of drift is added per call: transaction ids are minted from the clock
 * and a random suffix, and two identical suffixes in one millisecond would
 * make the second transaction a duplicate of the first.
 */
let restoreRandom: (() => void) | null = null;
function pinRandom(value: number): void {
  restoreRandom?.();
  let calls = 0;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => value + (calls++ % 997) * 1e-7);
  restoreRandom = () => spy.mockRestore();
}

beforeEach(() => pinRandom(0.5));
afterEach(() => {
  restoreRandom?.();
  restoreRandom = null;
});

function advance(state: GameState, seconds: number, step = 0.05): void {
  const effects = createEffects();
  for (let i = 0; i < Math.round(seconds / step); i++) runSimulationTick(state, step, effects);
}

function advanceUntil(
  state: GameState,
  predicate: (s: GameState) => boolean,
  maxSeconds = 120
): boolean {
  const effects = createEffects();
  for (let t = 0; t < maxSeconds; t += 0.05) {
    if (predicate(state)) return true;
    runSimulationTick(state, 0.05, effects);
  }
  return predicate(state);
}

function building(
  id: string,
  type: string,
  position: [number, number],
  extra: Partial<BuildingEntity> = {}
): BuildingEntity {
  return {
    id,
    type,
    level: 1,
    position,
    rotation: 0,
    size: GAME_CONFIG.buildings[type].size,
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0,
    ...extra
  };
}

/**
 * The starting plot with a toilet by the road and, when asked, a four-bay
 * park behind the pump. The pump stands at [8.5, 7] facing the road, so its
 * bay is at z = 5.6; the park's bays face the pump and are entered from the
 * back of the plot.
 */
function forecourt(options: { park?: boolean; tariff?: number } = {}): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.level = 12;
  state.buildings.wc = building('wc', 'toilet', [1, 7], {
    till: 0,
    todayRevenue: 0,
    todayVisits: 0,
    tariff: options.tariff ?? 1
  });
  if (options.park) {
    state.buildings.park = building('park', 'car_park', [9.5, 10.5]);
  }
  return state;
}

/** A customer standing at the pump's bay, ready to be served. */
function customerAtPump(state: GameState, id = 'car'): VehicleEntity {
  const pump = state.pumps.pump_1;
  const vehicle: VehicleEntity = {
    id,
    archetype: 'commuter',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 50,
    currentFuel: 20,
    request: {
      mode: 'LITERS',
      targetValue: 20,
      calculatedLiters: 20,
      calculatedPrice: 0,
      dispensedLiters: 0,
      isFinished: false
    },
    patience: 40,
    maxPatience: 40,
    satisfaction: 100,
    state: 'AT_PUMP',
    targetPumpId: pump.id,
    assignedActor: null,
    worldPosition: [8.5, 0, 5.6],
    targetWaypoint: null,
    route: [],
    heading: Math.PI / 2,
    speed: 1,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
  state.vehicles[id] = vehicle;
  pump.currentVehicleId = id;
  pump.state = 'REQUEST_READY';
  return vehicle;
}

/** Serves the customer through to the moment they have paid. */
function serve(state: GameState, vehicle: VehicleEntity): void {
  const effects = createEffects();
  expect(beginFueling(state, vehicle, 'LITERS', 20, 'PLAYER', effects)).toBe(true);
  for (let i = 0; i < 200 && vehicle.state === 'FUELING'; i++) {
    dispenseStep(state, vehicle, 0.5, effects);
  }
  expect(vehicle.state).toBe('PAYMENT');
  finalizeSale(state, vehicle, effects);
}

describe('facilities - geometry', () => {
  it('lays four car bays across a park, nosing at the kerb, entered from behind', () => {
    const park = building('p', 'car_park', [9.5, 10.5]);
    expect(parkingBayCount(park)).toBe(4);

    const body = { length: 0.9 };
    const first = parkingBay(park, 0, body);
    const last = parkingBay(park, 3, body);

    // Bays step across the park's five-unit width, 1.25 apart, inside it.
    expect(first.pose[0]).toBeCloseTo(9.5 - 2.5 + 0.625, 3);
    expect(last.pose[0]).toBeCloseTo(9.5 + 2.5 - 0.625, 3);
    // The car's nose is at the stop line on the -z edge; a 0.9 half-length
    // body stands 0.42 short of the park's centre line.
    expect(first.pose[2]).toBeCloseTo(10.5 - 0.44 * 3 + 0.9, 3);
    // Facing -z, which is heading π in this world.
    expect(Math.abs(Math.abs(first.heading) - Math.PI)).toBeLessThan(1e-6);
    // The run-up is behind the park, 1.6 past its +z edge.
    expect(first.runUp[2]).toBeCloseTo(10.5 + 1.5 + 1.6, 3);
    expect(first.runUp[0]).toBeCloseTo(first.pose[0], 3);
  });

  it('turns the bays with the park', () => {
    const park = building('p', 'car_park', [9.5, 10.5], { rotation: 90 });
    const bay = parkingBay(park, 0, { length: 0.9 });
    // A quarter turn puts the row of bays along z and the kerb on the -x side.
    expect(bay.pose[2]).toBeCloseTo(10.5 + 2.5 - 0.625, 3);
    expect(bay.pose[0]).toBeCloseTo(9.5 - 0.44 * 3 + 0.9, 3);
    expect(bay.runUp[0]).toBeCloseTo(9.5 + 1.5 + 1.6, 3);
    // Facing -x: heading -π/2.
    expect(bay.heading).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('sends the long bodies to the lorry park and everything else to the car park', () => {
    expect(parkingTypeFor({ archetype: 'firetruck', modelVariant: 'firetruck' })).toBe('truck_park');
    expect(parkingTypeFor({ archetype: 'truck', modelVariant: 'truck-with-trailer' })).toBe('truck_park');
    expect(parkingTypeFor({ archetype: 'bus', modelVariant: 'bus' })).toBe('truck_park');
    expect(parkingTypeFor({ archetype: 'commuter', modelVariant: 'sedan' })).toBe('car_park');
    expect(parkingTypeFor({ archetype: 'ambulance', modelVariant: 'ambulance' })).toBe('car_park');
  });

  it('puts the door on the road-facing side, a step outside the wall', () => {
    const wc = building('wc', 'toilet', [1, 7]);
    expect(facilityDoor(wc)).toEqual([1, 0, 7 - 1 - 0.35]);
    // The hand-built restaurant's glazed front is on its +z side.
    const diner = building('r', 'restaurant', [10, 10]);
    expect(facilityDoor(diner)[2]).toBeCloseTo(10 + 3 + 0.35, 6);
  });
});

describe('facilities - the card', () => {
  it('shows a fresh free toilet as +0.15 and a ten-lira one as +0.00', () => {
    expect(facilityMoralPoints(building('wc', 'toilet', [1, 7], { tariff: 0 }))).toBeCloseTo(0.15, 6);
    expect(facilityMoralPoints(building('wc', 'toilet', [1, 7], { tariff: 1 }))).toBeCloseTo(0.075, 6);
    expect(facilityMoralPoints(building('wc', 'toilet', [1, 7], { tariff: 2 }))).toBe(0);
  });

  it('feeds the price on the card into the goodwill the block earns', () => {
    // The starting office is worth two points on its own; the toilet's three
    // come on top of that when it is free, and not at all at ten lira.
    const office = blockFacilities(createInitialGameState(), 'near').satisfaction;
    const free = forecourt({ tariff: 0 });
    const dear = forecourt({ tariff: 2 });
    expect(blockFacilities(free, 'near').satisfaction).toBeCloseTo(office + 3, 6);
    expect(blockFacilities(dear, 'near').satisfaction).toBeCloseTo(office, 6);
  });

  it('grows income with level where the ladder says so', () => {
    expect(facilitySpend(building('c', 'cafe', [5, 5]), 'commuter')).toBe(200);
    expect(facilitySpend(building('c', 'cafe', [5, 5], { level: 3 }), 'commuter')).toBeCloseTo(200 * 1.55, 6);
    // The hotel charges the card price, lifted by the room upgrade.
    expect(facilitySpend(building('h', 'hotel', [5, 5], { tariff: 2, level: 2 }), 'family')).toBeCloseTo(4500 * 1.2, 6);
    // A shop's basket is the driver's own.
    expect(facilitySpend(building('m', 'mini_market', [5, 5]), 'family')).toBe(
      GAME_CONFIG.customerTypes.family.marketAvgBasket
    );
  });
});

describe('facilities - the visit', () => {
  it('parks, walks in, pays at the door, walks back and backs out', () => {
    const state = forecourt({ park: true, tariff: 1 });
    const car = customerAtPump(state);
    // Came for the toilet as well as fuel; with the die on 0.5 the driver
    // moves the car to the park rather than leaving it at the pump.
    car.facilityIntent = true;
    serve(state, car);

    expect(car.state).toBe('TO_PARK');
    expect(car.visitMode).toBe('PARK');
    expect(car.parkingBuildingId).toBe('park');
    expect(car.visitBuildingId).toBe('wc');
    // The pump is free the moment the car pulls away from it.
    expect(state.pumps.pump_1.currentVehicleId).toBeNull();
    expect(state.pumps.pump_1.state).toBe('IDLE');

    expect(advanceUntil(state, () => car.state === 'VISITING', 60)).toBe(true);
    const bay = parkingBay(state.buildings.park, car.parkingSlot!, { length: 0.9 });
    expect(car.worldPosition[0]).toBeCloseTo(bay.pose[0], 1);
    expect(car.worldPosition[2]).toBeCloseTo(bay.pose[2], 1);
    expect(car.visitor?.phase).toBe('TO_BUILDING');

    // Nothing is paid until the driver is through the door.
    expect(state.buildings.wc.till).toBe(0);
    expect(advanceUntil(state, () => car.visitor?.phase === 'INSIDE', 60)).toBe(true);
    expect(state.buildings.wc.till).toBe(15);
    expect(state.buildings.wc.todayRevenue).toBe(15);
    expect(state.buildings.wc.todayVisits).toBe(1);
    expect(state.dayState.todayStats.marketRevenue).toBe(15);
    // The station's own cash saw none of it.
    const cashBefore = state.player.cash;

    expect(advanceUntil(state, () => car.state === 'EXIT', 90)).toBe(true);
    expect(state.player.cash).toBe(cashBefore);
    expect(car.visitor).toBeUndefined();
    // Out of the bay backwards — straight back along its own line, to the
    // spot it turned in from (held onto the concrete: the park stands near
    // the back of the plot), then on.
    expect(car.reversing).toBe(true);
    expect(car.targetWaypoint?.[0]).toBeCloseTo(bay.pose[0], 3);
    expect(car.targetWaypoint?.[2]).toBeGreaterThan(bay.pose[2] + 1);
    expect(car.targetWaypoint?.[2]).toBeLessThanOrEqual(bay.runUp[2]);
    // The bay stays this car's until it is out: a car half-way out is still
    // in the park, and the park is a wall to everyone else.
    expect(car.parkingBuildingId).toBe('park');

    // The nose stays put while reversing — the car moves, the heading does
    // not — and the bay stays its own until the run-up, where the flag drops
    // and the bay is given up.
    const heading = car.heading;
    const from = [...car.worldPosition];
    advance(state, 0.15);
    expect(car.reversing).toBe(true);
    expect(car.parkingBuildingId).toBe('park');
    expect(car.worldPosition[2]).toBeGreaterThan(from[2]);
    expect(car.heading).toBeCloseTo(heading, 6);
    expect(advanceUntil(state, () => !car.reversing, 30)).toBe(true);
    expect(car.parkingBuildingId).toBeNull();

    // Then straight for the exit: the way out never goes deeper into the plot
    // than the run-up, and never back through the park (Emre, 2026-09-07).
    const deepest = Math.max(...[car.targetWaypoint!, ...car.route].map((p) => p[2]));
    expect(deepest).toBeLessThanOrEqual(bay.runUp[2] + 0.01);
    const park = getFootprint(state.buildings.park.position, state.buildings.park.size, 0);
    for (const p of [car.targetWaypoint!, ...car.route]) {
      expect(p[0] > park.minX && p[0] < park.maxX && p[2] > park.minZ && p[2] < park.maxZ).toBe(false);
    }
  });

  it('is a wall to every car but the one with a bay in it', () => {
    const state = forecourt({ park: true });
    const park = state.buildings.park;
    // On the route map the park is now something to steer round…
    expect(inRects(wallRects(state, 'near'), park.position[0], park.position[1])).toBe(true);
    // …unless it is the park you are heading for.
    expect(inRects(wallRects(state, 'near', undefined, 'park'), park.position[0], park.position[1])).toBe(false);
    // And a car parks in it without the solid-structure rule refusing the step.
    const car = customerAtPump(state);
    car.facilityIntent = true;
    serve(state, car);
    expect(car.state).toBe('TO_PARK');
    expect(advanceUntil(state, () => car.state === 'VISITING', 60)).toBe(true);
    expect(car.solidStuckSeconds ?? 0).toBe(0);
  });

  it('drives out instead of disappearing after giving up a blocked parking trip', () => {
    const state = forecourt({ park: true });
    const car = customerAtPump(state);
    car.facilityIntent = true;
    serve(state, car);
    expect(car.state).toBe('TO_PARK');

    // The parking target disappears after the trip has already accumulated a
    // full stuck timer. The old timer must not condemn the fresh exit route.
    car.blockedSeconds = 21;
    car.solidStuckSeconds = 21;
    delete state.buildings.park;
    const before = [...car.worldPosition];

    advance(state, 0.1, 0.05);

    expect(car.state).toBe('EXIT');
    expect(car.blockedSeconds ?? 0).toBeLessThan(1);
    expect(car.solidStuckSeconds ?? 0).toBe(0);
    expect(Math.hypot(car.worldPosition[0] - before[0], car.worldPosition[2] - before[2])).toBeGreaterThan(0);
  });

  it('lets a driver leave the car at the pump and hold the bay until they are back', () => {
    // The die on 0.1: under the toilet's odds, and under the share who walk
    // from the pump.
    pinRandom(0.1);
    expect(0.1).toBeLessThan(PUMP_WALK_SHARE);

    const state = forecourt({ tariff: 1 });
    const car = customerAtPump(state);
    serve(state, car);

    expect(car.state).toBe('VISITING');
    expect(car.visitMode).toBe('PUMP');
    expect(car.visitor?.phase).toBe('TO_BUILDING');
    // The bay is still theirs.
    expect(state.pumps.pump_1.currentVehicleId).toBe('car');
    expect(state.pumps.pump_1.state).not.toBe('IDLE');
    // The car has not moved.
    expect(car.worldPosition).toEqual([8.5, 0, 5.6]);

    expect(advanceUntil(state, () => car.state === 'EXIT' || car.state === 'DESPAWN', 60)).toBe(true);
    expect(state.buildings.wc.till).toBe(15);
    expect(state.pumps.pump_1.currentVehicleId).toBeNull();
    expect(state.pumps.pump_1.state).toBe('IDLE');
  });

  it('books a fraction of the visit when there is nowhere to park', () => {
    const state = forecourt({ tariff: 2 });
    state.buildings.cafe = building('cafe', 'cafe', [13, 8], { till: 0 });
    // A charged car is served where it stands; this one came for the café.
    const car = customerAtPump(state);
    car.archetype = 'ev';
    car.targetPumpId = null;
    car.facilityIntent = true;
    car.request.calculatedLiters = 30;
    state.pumps.pump_1.currentVehicleId = null;
    state.pumps.pump_1.state = 'IDLE';

    finalizeCharge(state, car, createEffects());

    expect(car.state).toBe('OPTIONAL_SHOP');
    expect(car.visitMode).toBe('VIRTUAL');
    expect(car.visitor).toBeUndefined();
    const visited = state.buildings[car.visitBuildingId!];
    const conf = GAME_CONFIG.facilities[visited.type];
    // Booked on the spot, at the virtual share of a full visit.
    expect(visited.till).toBeGreaterThan(0);
    expect(visited.till!).toBeLessThanOrEqual(Math.round(facilitySpend(visited, 'ev') * 1.2 * conf.virtualShare) + 1);
    expect(visited.todayVisits).toBe(1);

    // A few seconds' pause, then gone.
    advance(state, 7);
    expect(['EXIT', 'DESPAWN']).toContain(car.state);
  });

  it('charges nothing at a free toilet but still counts the visit', () => {
    pinRandom(0.1);
    const state = forecourt({ tariff: 0 });
    const car = customerAtPump(state);
    serve(state, car);
    expect(car.state).toBe('VISITING');

    expect(advanceUntil(state, () => car.state === 'EXIT' || car.state === 'DESPAWN', 60)).toBe(true);
    expect(state.buildings.wc.till).toBe(0);
    expect(state.buildings.wc.todayVisits).toBe(1);
  });

  it('never has two cars in one bay', () => {
    const state = forecourt({ park: true, tariff: 1 });
    const cars: VehicleEntity[] = [];
    for (let i = 0; i < 5; i++) {
      const car = customerAtPump(state, `car_${i}`);
      car.facilityIntent = true;
      serve(state, car);
      cars.push(car);
      // Free the pump for the next one; the served car is on its way.
      state.pumps.pump_1.currentVehicleId = null;
      state.pumps.pump_1.state = 'IDLE';
    }

    const parked = cars.filter((c) => c.state === 'TO_PARK');
    expect(parked).toHaveLength(4);
    expect(new Set(parked.map((c) => c.parkingSlot)).size).toBe(4);
    // The fifth found the park full and had the visit booked from the road.
    expect(cars.filter((c) => c.state === 'OPTIONAL_SHOP')).toHaveLength(1);
  });

  it('counts a driver who came for the buildings, and how many do', () => {
    // Nothing to walk into: nobody comes for it.
    expect(facilityOnlyShare(createInitialGameState(), 'near')).toBe(0);
    // Without pumps everyone who stops is here for the buildings.
    const shopOnly = forecourt({ tariff: 0 });
    shopOnly.pumps = {};
    expect(facilityOnlyShare(shopOnly, 'near')).toBe(1);
    // With pumps it follows the buildings' draw — and most of it needs a park.
    const withPark = facilityOnlyShare(forecourt({ park: true, tariff: 0 }), 'near');
    const noPark = facilityOnlyShare(forecourt({ tariff: 0 }), 'near');
    expect(withPark).toBeGreaterThan(0);
    expect(noPark).toBeCloseTo(withPark * 0.4, 6);
  });

  it('turns a hotel guest away when every room is taken', () => {
    const state = forecourt({ park: true });
    delete state.buildings.wc;
    state.buildings.hotel = building('hotel', 'hotel', [4, 4]);
    // Six rooms at level one, all spoken for.
    for (let i = 0; i < 6; i++) {
      const guest = customerAtPump(state, `guest_${i}`);
      guest.state = 'VISITING';
      guest.visitBuildingId = 'hotel';
      guest.targetPumpId = null;
    }
    state.pumps.pump_1.currentVehicleId = null;
    state.pumps.pump_1.state = 'IDLE';

    const late = customerAtPump(state, 'late');
    late.facilityIntent = true;
    serve(state, late);
    expect(late.visitBuildingId).toBeNull();
    expect(['EXIT', 'DESPAWN']).toContain(late.state);
  });
});

describe('facilities - the till', () => {
  it('moves the till into cash when collected, once', () => {
    const state = forecourt();
    state.buildings.wc.till = 450;
    const cash = state.player.cash;

    expect(collectTill(state, 'wc')).toBe(450);
    expect(state.player.cash).toBe(cash + 450);
    expect(state.buildings.wc.till).toBe(0);
    expect(collectTill(state, 'wc')).toBe(0);
    expect(state.player.cash).toBe(cash + 450);
    expect(state.transactionLog[0].type).toBe('FACILITY_INCOME');
  });

  it('lets the manager do the rounds every two hours, and only the manager', () => {
    const state = forecourt();
    state.buildings.wc.till = 300;
    state.buildings.cafe = building('cafe', 'cafe', [13, 8], { till: 200 });
    const cash = state.player.cash;

    // No manager: the money sits there.
    advance(state, 30);
    expect(state.buildings.wc.till).toBe(300);
    expect(state.player.cash).toBe(cash);

    state.station.managerId = 'manager_1';
    // The first tick starts the clock rather than emptying the tills.
    advance(state, 0.1);
    expect(state.buildings.wc.till).toBe(300);
    // Two game hours are twenty seconds; a little past that, the round is done.
    advance(state, 21);
    expect(state.buildings.wc.till).toBe(0);
    expect(state.buildings.cafe.till).toBe(0);
    expect(state.player.cash).toBe(cash + 500);
    expect(state.managerLogs.some((l) => l.category === 'FINANCE' && l.amount === 500)).toBe(true);

    // Switched off, the manager leaves the tills alone.
    state.managerSettings.autoCollectTills = false;
    state.buildings.wc.till = 100;
    advance(state, 25);
    expect(state.buildings.wc.till).toBe(100);
  });

  it('collects every till as one line in the books', () => {
    const state = forecourt();
    state.buildings.wc.till = 120;
    state.buildings.cafe = building('cafe', 'cafe', [13, 8], { till: 80 });
    const log = state.transactionLog.length;
    expect(collectAllTills(state)).toEqual({ total: 200, buildings: 2 });
    expect(state.transactionLog.length).toBe(log + 1);
    expect(state.transactionLog[0].amount).toBe(200);
  });
});

describe('facilities - the store', () => {
  function stubBrowser(): void {
    (globalThis as any).window = {};
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    };
  }

  function legalSpot(state: GameState, type: string): [number, number] {
    for (const z of [4, 6, 8, 10, 12]) {
      for (let x = 1; x <= 15; x += 1) {
        const at = snapPlacement(state, type, [x, z], 0);
        if (evaluatePlacement(state, type, at, 0).valid) return at;
      }
    }
    throw new Error(`${type} için yer yok`);
  }

  beforeEach(() => {
    stubBrowser();
    const state = createInitialGameState();
    state.player.cash = 1_000_000;
    state.player.level = 12;
    state.buildings.wc = building('wc', 'toilet', legalSpot(state, 'toilet'), {
      till: 250,
      todayRevenue: 400,
      todayVisits: 9,
      tariff: 0
    });
    useGameStore.setState({
      gameState: state,
      buildMode: { active: false, buildingType: null, pinned: false, position: [0, 0], pointer: [0, 0], rotation: 0, isValid: true },
      relocating: null,
      selectedBuildingId: null,
      editMode: false
    });
  });

  it('collects with a click', () => {
    const cash = useGameStore.getState().gameState.player.cash;
    expect(useGameStore.getState().collectTill('wc')).toBe(250);
    const after = useGameStore.getState().gameState;
    expect(after.player.cash).toBe(cash + 250);
    expect(after.buildings.wc.till).toBe(0);
  });

  it('walks the price card round: free, five, ten, free', () => {
    const labels = () =>
      GAME_CONFIG.facilities.toilet.tariffs![useGameStore.getState().gameState.buildings.wc.tariff ?? 0].label;
    expect(labels()).toBe('Ücretsiz');
    useGameStore.getState().cycleFacilityTariff('wc');
    expect(labels()).toBe('₺15');
    useGameStore.getState().cycleFacilityTariff('wc');
    expect(labels()).toBe('₺25');
    useGameStore.getState().cycleFacilityTariff('wc');
    expect(labels()).toBe('Ücretsiz');
    // A building with no card has nothing to cycle.
    expect(useGameStore.getState().cycleFacilityTariff('office_1')).toBe(false);
  });

  it('turns a building a quarter turn in place', () => {
    expect(useGameStore.getState().rotateBuilding('wc')).toBe(true);
    expect(useGameStore.getState().gameState.buildings.wc.rotation).toBe(90);
    // The till and the card come through the turn untouched.
    expect(useGameStore.getState().gameState.buildings.wc.till).toBe(250);
    // Infrastructure does not turn.
    expect(useGameStore.getState().rotateBuilding('price_sign_1')).toBe(false);
  });

  it('pays the till out with the building when it is sold', () => {
    const value = useGameStore.getState().structureValue('wc');
    const cash = useGameStore.getState().gameState.player.cash;
    expect(useGameStore.getState().sellStructure('wc')).toBe(true);
    expect(useGameStore.getState().gameState.player.cash).toBe(cash + value + 250);
  });

  it('carries the till and the card through a move, and through backing out of one', () => {
    useGameStore.getState().cycleFacilityTariff('wc');
    expect(useGameStore.getState().relocateStructure('wc')).toBe(true);
    expect(useGameStore.getState().relocating?.facility?.till).toBe(250);
    expect(useGameStore.getState().relocating?.facility?.tariff).toBe(1);

    // Backing out puts it back with everything it had.
    useGameStore.getState().exitBuildMode();
    const back = Object.values(useGameStore.getState().gameState.buildings).find((b) => b.type === 'toilet')!;
    expect(back.till).toBe(250);
    expect(back.tariff).toBe(1);
    expect(back.todayRevenue).toBe(400);
  });

  it('starts a new building with an empty till and its default price', () => {
    const state = useGameStore.getState().gameState;
    const spot = legalSpot(state, 'cafe');
    useGameStore.getState().enterBuildMode('cafe');
    useGameStore.getState().pinBuildPreviewAt(spot);
    expect(useGameStore.getState().confirmBuildPlacement()).toBe(true);
    const cafe = Object.values(useGameStore.getState().gameState.buildings).find((b) => b.type === 'cafe')!;
    expect(cafe.till).toBe(0);
    expect(cafe.todayVisits).toBe(0);

    // A hotel needs more land than the starting plot has to spare.
    const wide = JSON.parse(JSON.stringify(useGameStore.getState().gameState)) as GameState;
    for (let col = 0; col <= 3; col++) {
      for (let row = 0; row <= 3; row++) {
        const key = `${col},${row}`;
        if (!wide.station.plots.ownedParcels.includes(key)) wide.station.plots.ownedParcels.push(key);
        if (!wide.station.plots.pavedParcels.includes(key)) wide.station.plots.pavedParcels.push(key);
      }
    }
    const bounds = stationBounds(wide.station.plots.ownedParcels);
    wide.station.plots.width = bounds.width;
    wide.station.plots.height = bounds.height;
    useGameStore.setState({ gameState: wide });

    useGameStore.getState().enterBuildMode('hotel');
    const hotelSpot = (() => {
      for (let z = 4; z <= 26; z += 1) {
        for (let x = 1; x <= 30; x += 1) {
          const at = snapPlacement(wide, 'hotel', [x, z], 0);
          if (evaluatePlacement(wide, 'hotel', at, 0).valid) return at;
        }
      }
      throw new Error('hotel için yer yok');
    })();
    useGameStore.getState().pinBuildPreviewAt(hotelSpot);
    expect(useGameStore.getState().confirmBuildPlacement()).toBe(true);
    const hotel = Object.values(useGameStore.getState().gameState.buildings).find((b) => b.type === 'hotel')!;
    expect(hotel.tariff).toBe(GAME_CONFIG.facilities.hotel.defaultTariff);
  });

  it("resets the day's takings at dawn but leaves the till alone", () => {
    useGameStore.getState().endDayAndShowReport();
    const wc = useGameStore.getState().gameState.buildings.wc;
    expect(wc.todayRevenue).toBe(0);
    expect(wc.todayVisits).toBe(0);
    expect(wc.till).toBe(250);
  });
});
