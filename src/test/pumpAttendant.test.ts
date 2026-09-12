import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { runSimulationTick, createEffects } from '../domain/services/simulationEngine';
import { VehicleEntity } from '../domain/types/gameState';
import { canPlayerOpenVehicleService } from '../rendering/VehicleMesh';

function customerAtPump(id: string, state: ReturnType<typeof createInitialGameState>): VehicleEntity {
  const pump = state.pumps.pump_1;
  return {
    id,
    archetype: 'family',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 50,
    currentFuel: 10,
    request: {
      mode: 'MONEY',
      targetValue: 500,
      calculatedLiters: 500 / state.pricing.gasoline.playerPrice,
      calculatedPrice: 500,
      dispensedLiters: 0,
      isFinished: false
    },
    patience: 100,
    maxPatience: 100,
    satisfaction: 100,
    state: 'AT_PUMP',
    targetPumpId: pump.id,
    assignedActor: null,
    worldPosition: [pump.position[0] * 2, 0, pump.position[1] * 2],
    targetWaypoint: null,
    route: [],
    routeProgress: 0,
    speed: 0,
    heading: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
}

describe('Pump Attendant (Pompacı) System', () => {
  beforeEach(() => {
    const s = createInitialGameState();
    // Hiring opens at level 3 (attendantHireLevel.test); these are about what
    // an attendant does once hired.
    s.player.level = 3;
    s.player.cash = 100_000;
    s.tanks.gasoline.stock = 1500;
    s.tanks.gasoline.capacity = 1500;
    s.dayState.isDayActive = true;
    s.dayState.timeSpeed = 1;
    useGameStore.setState({ gameState: s, selectedPumpId: 'pump_1' });
  });

  it('hires an attendant for a specific pump', () => {
    const { hirePumpAttendant } = useGameStore.getState();
    const success = hirePumpAttendant('pump_1');
    expect(success).toBe(true);

    const state = useGameStore.getState().gameState;
    const attendant = Object.values(state.employees).find(
      (e) => e.assignedPumpId === 'pump_1' && e.role === 'PUMP_ATTENDANT'
    );
    expect(attendant).toBeDefined();
    expect(attendant?.name).toContain('Usta');
    expect(state.pumps['pump_1'].employeeId).toBe(attendant?.id);
  });

  it('prevents hiring duplicate attendants on the same pump', () => {
    const { hirePumpAttendant } = useGameStore.getState();
    expect(hirePumpAttendant('pump_1')).toBe(true);
    expect(hirePumpAttendant('pump_1')).toBe(false);
  });

  it('fires an attendant and clears pump assignment', () => {
    const { hirePumpAttendant, fireAttendant } = useGameStore.getState();
    hirePumpAttendant('pump_1');

    let state = useGameStore.getState().gameState;
    const attendant = Object.values(state.employees).find(
      (e) => e.assignedPumpId === 'pump_1'
    )!;
    expect(attendant).toBeDefined();

    fireAttendant(attendant.id);

    state = useGameStore.getState().gameState;
    expect(state.employees[attendant.id]).toBeUndefined();
    expect(state.pumps['pump_1'].employeeId).toBeNull();
  });

  it('rotates a pump in 90 degree increments', () => {
    const { rotatePump } = useGameStore.getState();
    const initialRot = useGameStore.getState().gameState.pumps['pump_1'].rotation || 0;

    rotatePump('pump_1');
    expect(useGameStore.getState().gameState.pumps['pump_1'].rotation).toBe((initialRot + 90) % 360);

    rotatePump('pump_1');
    expect(useGameStore.getState().gameState.pumps['pump_1'].rotation).toBe((initialRot + 180) % 360);
  });

  it('automatically fuels a car when an attendant is assigned to the pump', () => {
    const { hirePumpAttendant } = useGameStore.getState();
    hirePumpAttendant('pump_1');

    const state = useGameStore.getState().gameState;
    const pump = state.pumps['pump_1'];

    // Place a car directly at the pump
    const vehicleId = 'veh_test_1';
    const vehicle: VehicleEntity = {
      id: vehicleId,
      archetype: 'family',
      fuelType: 'gasoline',
      tankCapacity: 50,
      currentFuel: 10,
      request: {
        mode: 'FULL',
        targetValue: 40,
        calculatedLiters: 40,
        calculatedPrice: 40 * 10,
        dispensedLiters: 0,
        isFinished: false
      },
      patience: 100,
      maxPatience: 100,
      satisfaction: 100,
      state: 'AT_PUMP',
      targetPumpId: 'pump_1',
      assignedActor: null,
      worldPosition: [pump.position[0] * 2, 0, pump.position[1] * 2],
      targetWaypoint: null,
      route: [],
      routeProgress: 0,
      speed: 0,
      heading: 0,
      waitingTimeSeconds: 0,
      shoppingIntent: false
    };

    pump.currentVehicleId = vehicleId;
    state.vehicles[vehicleId] = vehicle;

    // Tick simulation to allow attendant to take the job (PREPARE)
    const effects = createEffects();
    runSimulationTick(state, 0.5, effects);

    const attendant = Object.values(state.employees).find(
      (e) => e.assignedPumpId === 'pump_1'
    )!;
    expect(attendant.currentVehicleId).toBe(vehicleId);
    expect(vehicle.assignedActor).toBe('EMPLOYEE');

    // Run ticks until greeting timer finishes and fueling begins
    for (let i = 0; i < 10; i++) {
      runSimulationTick(state, 0.5, effects);
      if (vehicle.state === 'FUELING') break;
    }
    expect(vehicle.state).toBe('FUELING');
    expect(attendant.state).toBe('FUELING');

    // Run ticks until automatic dispensing finishes
    const initialCash = state.player.cash;
    for (let i = 0; i < 50; i++) {
      runSimulationTick(state, 0.5, effects);
      if (vehicle.request.isFinished) break;
    }

    expect(vehicle.request.dispensedLiters).toBeGreaterThanOrEqual(39.9);
    // Continue tick for payment / finalization
    for (let i = 0; i < 10; i++) {
      runSimulationTick(state, 0.5, effects);
      if (state.player.cash > initialCash) break;
    }

    // Cash earned from fuel sale automatically!
    expect(state.player.cash).toBeGreaterThan(initialCash);
  });

  it('pours the sum the driver named instead of filling the tank', () => {
    const { hirePumpAttendant } = useGameStore.getState();
    hirePumpAttendant('pump_1');

    const state = useGameStore.getState().gameState;
    const pump = state.pumps['pump_1'];
    const unitPrice = state.pricing.gasoline.playerPrice;

    // Depoda 40 L boşluk var ama sürücü ₺250'lik istiyor.
    const vehicleId = 'veh_money';
    const vehicle: VehicleEntity = {
      id: vehicleId,
      archetype: 'family',
      fuelType: 'gasoline',
      tankCapacity: 50,
      currentFuel: 10,
      request: {
        mode: 'MONEY',
        targetValue: 250,
        calculatedLiters: 250 / unitPrice,
        calculatedPrice: 250,
        dispensedLiters: 0,
        isFinished: false
      },
      patience: 100,
      maxPatience: 100,
      satisfaction: 100,
      state: 'AT_PUMP',
      targetPumpId: 'pump_1',
      assignedActor: null,
      worldPosition: [pump.position[0] * 2, 0, pump.position[1] * 2],
      targetWaypoint: null,
      route: [],
      routeProgress: 0,
      speed: 0,
      heading: 0,
      waitingTimeSeconds: 0,
      shoppingIntent: false
    };
    pump.currentVehicleId = vehicleId;
    state.vehicles[vehicleId] = vehicle;

    const effects = createEffects();
    const initialCash = state.player.cash;
    for (let i = 0; i < 60; i++) {
      runSimulationTick(state, 0.5, effects);
      if (vehicle.request.isFinished) break;
    }

    expect(vehicle.request.isFinished).toBe(true);
    expect(vehicle.request.mode).toBe('MONEY');
    // Tam ₺250'lik yakıt — depoyu fullemez.
    expect(vehicle.request.dispensedLiters * unitPrice).toBeCloseTo(250, 2);
    expect(vehicle.request.dispensedLiters).toBeLessThan(40);

    for (let i = 0; i < 10; i++) {
      runSimulationTick(state, 0.5, effects);
      if (state.player.cash > initialCash) break;
    }
    // Kasaya ₺250 girer (üstüne bahşiş gelebilir); depo parası girmez.
    expect(state.player.cash - initialCash).toBeGreaterThanOrEqual(250);
    expect(state.player.cash - initialCash).toBeLessThan(250 + 100);
  });

  it('hands an orphaned employee claim back to the player', () => {
    const state = useGameStore.getState().gameState;
    const vehicle = customerAtPump('veh_orphaned_claim', state);
    vehicle.assignedActor = 'EMPLOYEE';
    state.pumps.pump_1.currentVehicleId = vehicle.id;
    state.pumps.pump_1.state = 'REQUEST_READY';
    state.vehicles[vehicle.id] = vehicle;

    runSimulationTick(state, 0.1, createEffects());

    expect(vehicle.assignedActor).toBeNull();
    expect(canPlayerOpenVehicleService(vehicle, false)).toBe(true);
  });

  it('keeps a live reservation and makes the car player-serviceable if its attendant is fired', () => {
    useGameStore.getState().hirePumpAttendant('pump_1');
    const state = useGameStore.getState().gameState;
    const employee = Object.values(state.employees).find((e) => e.assignedPumpId === 'pump_1')!;
    const vehicle = customerAtPump('veh_fired_attendant', state);
    vehicle.state = 'FUELING';
    vehicle.assignedActor = 'EMPLOYEE';
    vehicle.request.reservedLiters = vehicle.request.calculatedLiters;
    state.tanks.gasoline.reservedStock = vehicle.request.calculatedLiters;
    state.pumps.pump_1.currentVehicleId = vehicle.id;
    state.pumps.pump_1.state = 'FUELING';
    state.vehicles[vehicle.id] = vehicle;
    employee.currentVehicleId = vehicle.id;
    employee.state = 'FUELING';
    useGameStore.setState({ gameState: state });

    useGameStore.getState().fireAttendant(employee.id);
    const after = useGameStore.getState().gameState;
    const rescued = after.vehicles[vehicle.id];

    expect(after.employees[employee.id]).toBeUndefined();
    expect(rescued.assignedActor).toBe('PLAYER');
    expect(rescued.request.reservedLiters).toBe(vehicle.request.calculatedLiters);
    expect(after.tanks.gasoline.reservedStock).toBe(vehicle.request.calculatedLiters);
    expect(canPlayerOpenVehicleService(rescued, false)).toBe(true);

    useGameStore.getState().simulationTick(0.5);
    expect(useGameStore.getState().gameState.vehicles[vehicle.id].request.dispensedLiters).toBeGreaterThan(0);
  });

  it('releases the current customer immediately when an attendant is moved off the pump', () => {
    useGameStore.getState().hirePumpAttendant('pump_1');
    const state = useGameStore.getState().gameState;
    const employee = Object.values(state.employees).find((e) => e.assignedPumpId === 'pump_1')!;
    const vehicle = customerAtPump('veh_moved_attendant', state);
    vehicle.state = 'FUELING';
    vehicle.assignedActor = 'EMPLOYEE';
    vehicle.request.reservedLiters = vehicle.request.calculatedLiters;
    state.tanks.gasoline.reservedStock = vehicle.request.calculatedLiters;
    state.pumps.pump_1.currentVehicleId = vehicle.id;
    state.pumps.pump_1.state = 'FUELING';
    state.vehicles[vehicle.id] = vehicle;
    employee.currentVehicleId = vehicle.id;
    employee.state = 'FUELING';
    useGameStore.setState({ gameState: state });

    useGameStore.getState().assignAttendantToPump(employee.id, null);
    const after = useGameStore.getState().gameState;

    expect(after.employees[employee.id].assignedPumpId).toBeNull();
    expect(after.employees[employee.id].currentVehicleId).toBeNull();
    expect(after.pumps.pump_1.employeeId).toBeNull();
    expect(after.vehicles[vehicle.id].assignedActor).toBe('PLAYER');
    expect(after.tanks.gasoline.reservedStock).toBe(vehicle.request.calculatedLiters);
    expect(canPlayerOpenVehicleService(after.vehicles[vehicle.id], false)).toBe(true);
  });

  it('repairs a mismatched attendant state and lets the attendant reclaim the customer', () => {
    useGameStore.getState().hirePumpAttendant('pump_1');
    const state = useGameStore.getState().gameState;
    const employee = Object.values(state.employees).find((e) => e.assignedPumpId === 'pump_1')!;
    const vehicle = customerAtPump('veh_bad_employee_state', state);
    vehicle.assignedActor = 'EMPLOYEE';
    state.pumps.pump_1.currentVehicleId = vehicle.id;
    state.pumps.pump_1.state = 'REQUEST_READY';
    state.vehicles[vehicle.id] = vehicle;
    employee.currentVehicleId = vehicle.id;
    employee.state = 'FUELING';

    runSimulationTick(state, 0.1, createEffects());

    expect(employee.state).toBe('PREPARE');
    expect(employee.currentVehicleId).toBe(vehicle.id);
    expect(vehicle.assignedActor).toBe('EMPLOYEE');

    for (let i = 0; i < 20 && vehicle.state !== 'FUELING'; i++) {
      runSimulationTick(state, 0.25, createEffects());
    }
    expect(vehicle.state).toBe('FUELING');
  });

  it('starts service when an older save has no attendant preparation timer', () => {
    useGameStore.getState().hirePumpAttendant('pump_1');
    const state = useGameStore.getState().gameState;
    const employee = Object.values(state.employees).find((e) => e.assignedPumpId === 'pump_1')!;
    const vehicle = customerAtPump('veh_missing_timer', state);
    vehicle.assignedActor = 'EMPLOYEE';
    state.pumps.pump_1.currentVehicleId = vehicle.id;
    state.pumps.pump_1.state = 'REQUEST_READY';
    state.vehicles[vehicle.id] = vehicle;
    employee.currentVehicleId = vehicle.id;
    employee.state = 'PREPARE';
    (employee as { actionTimerSeconds?: number }).actionTimerSeconds = undefined;

    runSimulationTick(state, 0.1, createEffects());

    expect(Number.isFinite(employee.actionTimerSeconds)).toBe(true);
    expect(employee.state).toBe('FUELING');
    expect(vehicle.state).toBe('FUELING');
  });
});
