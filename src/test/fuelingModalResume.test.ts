import { beforeEach, describe, expect, it } from 'vitest';
import { canPlayerOpenVehicleService } from '../rendering/VehicleMesh';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';
import { VehicleEntity } from '../domain/types/gameState';

function customer(): VehicleEntity {
  return {
    id: 'manual_customer',
    archetype: 'family',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 50,
    currentFuel: 20,
    request: {
      mode: 'MONEY',
      targetValue: 250,
      calculatedLiters: 250 / 45,
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
    worldPosition: [8.5, 0, 5.6],
    targetWaypoint: null,
    route: [],
    heading: 0,
    speed: 0,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
}

describe('manual fueling modal can be resumed', () => {
  beforeEach(() => {
    const state = createInitialGameState();
    const vehicle = customer();
    state.tanks.gasoline.stock = 1500;
    state.pumps.pump_1.currentVehicleId = vehicle.id;
    state.pumps.pump_1.state = 'REQUEST_READY';
    state.vehicles[vehicle.id] = vehicle;
    useGameStore.setState({
      gameState: state,
      activeModal: 'NONE',
      selectedVehicleId: null
    });
  });

  it('reopens an interrupted pour after another menu replaces the fuel modal', () => {
    const store = useGameStore.getState();
    store.openFuelingPanelForVehicle('manual_customer');
    store.startVehicleFueling('manual_customer', 'MONEY', 250);

    let current = useGameStore.getState();
    expect(current.gameState.vehicles.manual_customer.state).toBe('FUELING');
    expect(current.gameState.vehicles.manual_customer.assignedActor).toBe('PLAYER');

    current.setActiveModal('FEEDBACK');
    current = useGameStore.getState();
    expect(current.activeModal).toBe('FEEDBACK');
    expect(canPlayerOpenVehicleService(current.gameState.vehicles.manual_customer, false)).toBe(true);

    current.openFuelingPanelForVehicle('manual_customer');
    expect(useGameStore.getState().activeModal).toBe('CUSTOMER_FUEL');
    expect(useGameStore.getState().selectedVehicleId).toBe('manual_customer');
  });

  it('keeps a completed manual sale clickable until the player hands it over', () => {
    const store = useGameStore.getState();
    store.openFuelingPanelForVehicle('manual_customer');
    store.startVehicleFueling('manual_customer', 'MONEY', 250);
    store.dispenseFuelStep('manual_customer', 10);

    let current = useGameStore.getState();
    expect(current.gameState.vehicles.manual_customer.state).toBe('PAYMENT');
    current.setActiveModal('SETTINGS');
    current = useGameStore.getState();
    expect(canPlayerOpenVehicleService(current.gameState.vehicles.manual_customer, false)).toBe(true);

    current.openFuelingPanelForVehicle('manual_customer');
    expect(useGameStore.getState().activeModal).toBe('CUSTOMER_FUEL');
  });

  it('does not offer an employee job or an active charging session to the player', () => {
    const employeeCustomer = customer();
    employeeCustomer.assignedActor = 'EMPLOYEE';
    employeeCustomer.state = 'FUELING';
    expect(canPlayerOpenVehicleService(employeeCustomer, true)).toBe(false);

    const ev = customer();
    ev.archetype = 'ev';
    ev.chargingBuildingId = 'charger_1';
    ev.assignedActor = 'PLAYER';
    ev.state = 'FUELING';
    expect(canPlayerOpenVehicleService(ev, false)).toBe(false);
  });
});
