import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { runSimulationTick, createEffects } from '../domain/services/simulationEngine';
import { VehicleEntity } from '../domain/types/gameState';

describe('Pump Attendant (Pompacı) System', () => {
  beforeEach(() => {
    const s = createInitialGameState();
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
});
