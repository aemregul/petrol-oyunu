import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity } from '../domain/types/gameState';
import { SQUEEGEE_SATISFACTION } from '../domain/services/simulationEngine';
import { useGameStore } from '../store/gameStore';

/**
 * Emre, 2026-09-12: "Camları Temizle" gave no sign it had done anything —
 * the button only greyed out, and it felt like clicking at nothing. The press
 * now says what it bought; the hand-over names the tip (saleReceipt.test).
 */

function atPump(state: GameState): VehicleEntity {
  const vehicle: VehicleEntity = {
    id: 'squeegee_car',
    archetype: 'family',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 60,
    currentFuel: 10,
    request: {
      mode: 'LITERS', targetValue: 20, calculatedLiters: 20, calculatedPrice: 0,
      dispensedLiters: 0, isFinished: false
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
  state.vehicles[vehicle.id] = vehicle;
  state.pumps.pump_1.currentVehicleId = vehicle.id;
  state.pumps.pump_1.state = 'REQUEST_READY';
  return vehicle;
}

describe("cleaning a driver's windows", () => {
  it('says what the press bought, and only once', () => {
    const state = createInitialGameState();
    const car = atPump(state);
    useGameStore.setState({ gameState: state });

    useGameStore.getState().cleanVehicleWindows(car.id);
    const after = useGameStore.getState().gameState;
    expect(after.vehicles[car.id].windowsCleaned).toBe(true);
    expect(after.notifications[0]).toMatchObject({ type: 'INFO', title: 'Camlar Temizlendi' });
    expect(after.notifications[0].message).toContain(`memnuniyeti +${SQUEEGEE_SATISFACTION}`);

    const logged = after.notifications.length;
    useGameStore.getState().cleanVehicleWindows(car.id);
    expect(useGameStore.getState().gameState.notifications).toHaveLength(logged);
  });
});
