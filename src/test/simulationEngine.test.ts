import { describe, it, expect, vi } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
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
  queueSlotPosition
} from '../domain/services/simulationEngine';
import { GAME_EVENTS } from '../config/eventConfig';
import { GameState, VehicleState } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';

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
    state.dayState.timeSpeed = 4;

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
    state.dayState.timeSpeed = 4;
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

  it('never lets a vehicle reach an invalid state', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 4;

    const valid: VehicleState[] = [
      'SPAWN', 'ROAD_APPROACH', 'QUEUE', 'PUMP_RESERVED', 'AT_PUMP',
      'REQUEST', 'FUELING', 'PAYMENT', 'OPTIONAL_SHOP', 'EXIT', 'DESPAWN'
    ];

    advance(state, 400);
    for (const vehicle of Object.values(state.vehicles)) {
      expect(valid).toContain(vehicle.state);
    }
  });

  it('queues vehicles once every pump is occupied', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 4;
    // Block the only pump so arrivals have to queue.
    state.pumps.pump_1.state = 'BROKEN';

    const queued = advanceUntil(
      state,
      (s) => Object.values(s.vehicles).some((v) => v.state === 'QUEUE'),
      600
    );

    expect(queued).toBe(true);
  });
});

describe('simulationEngine - tanker orders', () => {
  it('moves an order through the full gate and unloading sequence', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 4;
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
    state.dayState.timeSpeed = 4;
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
      state.dayState.timeSpeed = 4;
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
  it('flags the end of the day at closing time', () => {
    const state = createInitialGameState();
    state.dayState.gameTime = GAME_CONFIG.economy.dayEndHour - 0.01;
    state.dayState.timeSpeed = 4;

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

    // Stay inside the outage: at 1x, one game hour is ~37s of sim time.
    advance(state, 25);
    expect(state.activeEvents).toHaveLength(1);

    // Cars still arrive, but none of them can be given a pump.
    for (const vehicle of Object.values(state.vehicles)) {
      expect(vehicle.state).not.toBe('AT_PUMP');
    }
    expect(state.pumps.pump_1.currentVehicleId).toBeNull();
  });

  it('expires timed events once their hours run out', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 4;
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
    state.dayState.timeSpeed = 4;
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
