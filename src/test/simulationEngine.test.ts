import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  queueSlotPosition,
  getLayout,
  drivewayMouths,
  drivewayLaneX,
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
  DRIVEWAY_Z,
  LAYOUT
} from '../domain/services/simulationEngine';
import { GAME_EVENTS } from '../config/eventConfig';
import { GameState, VehicleState } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';

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

    const onSite = Object.values(state.vehicles).filter(
      (v) => !['SPAWN', 'PASSING', 'EXIT', 'DESPAWN'].includes(v.state)
    ).length;

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

  it('never lets a vehicle reach an invalid state', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;

    const valid: VehicleState[] = [
      'SPAWN', 'PASSING', 'ROAD_APPROACH', 'QUEUE', 'PUMP_RESERVED', 'AT_PUMP',
      'REQUEST', 'FUELING', 'PAYMENT', 'OPTIONAL_SHOP', 'EXIT', 'DESPAWN'
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
});

describe('simulationEngine - missions', () => {
  it('advances the supply-order mission when fuel is ordered', () => {
    const state = createInitialGameState();
    state.player.cash = 100000;
    const effects = createEffects();

    const mission = state.missions.find((m) => m.templateId === 'T3')!;
    expect(mission.progress).toBe(0);

    placeFuelOrder(state, 'gasoline', 500, effects);
    expect(mission.progress).toBe(1);
    expect(mission.completed).toBe(true);
  });

  it('takes three served customers to finish the T2 mission', () => {
    const state = createInitialGameState();
    const mission = state.missions.find((m) => m.templateId === 'T2')!;
    expect(mission.target).toBe(3);
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

    const dailies = state.missions.filter((m) => m.type !== 'TUTORIAL');
    expect(dailies.length).toBeGreaterThan(0);
    expect(dailies.filter((m) => m.type === 'DAILY_MAIN')).toHaveLength(1);
    expect(state.missions.filter((m) => m.type === 'TUTORIAL')).toHaveLength(6);

    for (const mission of dailies) {
      expect(mission.target).toBeGreaterThan(0);
      expect(mission.description).not.toContain('{n}');
      expect(mission.issuedOnDay).toBe(3);
    }
  });

  it('advances every mission watching the same metric at once', () => {
    const state = createInitialGameState();
    const effects = createEffects();

    trackMissionMetric(state, 'CUSTOMERS_SERVED', 1, effects);

    const t1 = state.missions.find((m) => m.templateId === 'T1')!;
    const t2 = state.missions.find((m) => m.templateId === 'T2')!;
    expect(t1.completed).toBe(true);
    expect(t2.progress).toBe(1);
    expect(t2.completed).toBe(false);
  });

  it('keeps unclaimed goals when the next day is generated', () => {
    const state = createInitialGameState();
    state.player.level = 8;
    generateDailyMissions(state);

    const earned = state.missions.find((m) => m.type !== 'TUTORIAL')!;
    earned.completed = true;
    earned.progress = earned.target;

    state.dayState.currentDay = 2;
    generateDailyMissions(state);

    expect(state.missions.some((m) => m.id === earned.id)).toBe(true);
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

  it('runs the same game on the block across the highway', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.station.roadLevel = 2;
    const far = ['0,-1', '1,-1', '0,-2', '1,-2'];
    state.station.plots.ownedParcels.push(...far);
    state.station.plots.pavedParcels.push(...far);

    // Every pump is across the road, so every customer has to go there.
    const proto = Object.values(state.pumps)[0];
    state.pumps = {
      pf: { ...proto, id: 'pf', position: [8, -19], currentVehicleId: null, employeeId: null }
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

  it('sends drivers to a block that has only a shop', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.pumps = {};
    state.market.active = true;
    state.market.stock = 999;
    state.buildings.mk = {
      id: 'mk',
      type: 'mini_market',
      level: 1,
      position: [8, 8],
      rotation: 0,
      size: [4, 4],
      health: 100,
      constructionState: 'ACTIVE',
      builtAtTimestamp: 0
    };

    // A forecourt with no pumps is still worth pulling into for the shop, and
    // the visit has to earn something rather than stranding the driver.
    expect(stopChance(state)).toBeGreaterThan(0);
    advanceUntil(state, (s) => s.dayState.todayStats.marketRevenue > 0, 4000);
    expect(state.dayState.todayStats.marketRevenue).toBeGreaterThan(0);
  });

  it('keeps vehicles out of one another and never gridlocks', () => {
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
          const gap = Math.hypot(
            vehicles[a].worldPosition[0] - vehicles[b].worldPosition[0],
            vehicles[a].worldPosition[2] - vehicles[b].worldPosition[2]
          );
          pairs++;
          // A vehicle is about 1.35 grid units wide, so anything under this is
          // two cars sharing the same tarmac rather than passing beside it.
          if (gap < 1.2) touching++;
        }
      }

      // These states have nothing to wait for but the road ahead, so a car
      // that sits in one of them is a car the traffic rules have wedged.
      for (const vehicle of vehicles) {
        if (!['PASSING', 'ROAD_APPROACH', 'EXIT'].includes(vehicle.state)) {
          enteredTransit.delete(vehicle.id);
          continue;
        }
        if (!enteredTransit.has(vehicle.id)) enteredTransit.set(vehicle.id, tick);
        longestTransit = Math.max(longestTransit, (tick - enteredTransit.get(vehicle.id)!) * 0.2);
      }
    }

    expect(pairs).toBeGreaterThan(1000);
    expect(touching / pairs).toBeLessThan(0.01);
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

    state.buildings.sub = {
      id: 'sub', type: 'ev_substation', level: 1, position: [13, 3], rotation: 0,
      size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    };
    expect(chargingPoints(state, 'near')).toHaveLength(1);

    // And now electric customers actually turn up and pay for a charge.
    advanceUntil(
      state,
      (s) => Object.values(s.vehicles).some((v) => v.chargingBuildingId === 'dc'),
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

  it('spawns vehicles on the driving lane', () => {
    const state = createInitialGameState();
    state.station.roadLevel = 2;
    state.dayState.timeSpeed = 1;

    advanceUntil(state, (s) => Object.keys(s.vehicles).length > 0, 600);
    const vehicle = Object.values(state.vehicles)[0];

    expect(vehicle.worldPosition[2]).toBeCloseTo(getLayout(state).roadLaneZ, 3);
  });
});
