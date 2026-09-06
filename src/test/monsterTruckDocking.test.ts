import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  createEffects,
  queueSlotPosition,
  runSimulationTick
} from '../domain/services/simulationEngine';
import { VehicleEntity } from '../domain/types/gameState';

describe('monster truck pump docking', () => {
  it('clears the island and reaches the reserved pump bay', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    const at = queueSlotPosition(state, 0);
    const monster: VehicleEntity = {
      id: 'monster_docking_probe',
      archetype: 'monster',
      modelVariant: 'monster-truck',
      fuelType: 'gasoline',
      tankCapacity: 120,
      currentFuel: 40,
      request: {
        mode: 'FULL',
        targetValue: 80,
        calculatedLiters: 80,
        calculatedPrice: 80 * state.pricing.gasoline.playerPrice,
        dispensedLiters: 0,
        isFinished: false
      },
      patience: 120,
      maxPatience: 120,
      satisfaction: 100,
      state: 'QUEUE',
      targetPumpId: null,
      assignedActor: null,
      worldPosition: at,
      targetWaypoint: null,
      route: [],
      heading: Math.PI / 2,
      speed: 0.9,
      routeProgress: 0,
      waitingTimeSeconds: 30,
      shoppingIntent: false
    };
    state.vehicles[monster.id] = monster;

    const effects = createEffects();
    let maxSolidStuck = 0;
    for (let tick = 0; tick < 4000 && monster.state !== 'AT_PUMP'; tick++) {
      runSimulationTick(state, 0.05, effects);
      maxSolidStuck = Math.max(maxSolidStuck, monster.solidStuckSeconds ?? 0);
    }

    expect(monster.state).toBe('AT_PUMP');
    expect(monster.targetPumpId).toBe('pump_1');
    expect(maxSolidStuck).toBeLessThan(2);
  });
});
