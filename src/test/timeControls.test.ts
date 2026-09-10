import { describe, expect, it } from 'vitest';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';
import { createInitialGameState } from '../domain/types/initialState';

function stateWithDelivery() {
  const state = createInitialGameState();
  state.station.open = false;
  state.fuelOrders.push({
    id: 'speed_order',
    fuelType: 'gasoline',
    liters: 500,
    pricePerLiter: 35,
    totalCost: 17500,
    state: 'TRAVELLING',
    remainingSeconds: 30,
    truck: null
  } as never);
  return state;
}

describe('simulation time controls', () => {
  it('freezes both the game clock and a travelling fuel order at pause', () => {
    const state = stateWithDelivery();
    state.dayState.timeSpeed = 0;
    const gameTime = state.dayState.gameTime;

    runSimulationTick(state, 5, createEffects());

    expect(state.dayState.gameTime).toBe(gameTime);
    expect(state.fuelOrders[0].remainingSeconds).toBe(30);
    expect(state.fuelOrders[0].truck).toBeNull();
  });

  it('advances the economy and delivery countdown at exactly half speed', () => {
    const relaxed = stateWithDelivery();
    const normal = stateWithDelivery();
    relaxed.dayState.timeSpeed = 0.5;
    normal.dayState.timeSpeed = 1;
    const relaxedStart = relaxed.dayState.gameTime;
    const normalStart = normal.dayState.gameTime;

    runSimulationTick(relaxed, 2, createEffects());
    runSimulationTick(normal, 2, createEffects());

    expect(30 - relaxed.fuelOrders[0].remainingSeconds).toBeCloseTo(1, 8);
    expect(30 - normal.fuelOrders[0].remainingSeconds).toBeCloseTo(2, 8);
    expect(relaxed.dayState.gameTime - relaxedStart).toBeCloseTo(
      (normal.dayState.gameTime - normalStart) / 2,
      8
    );
  });
});
