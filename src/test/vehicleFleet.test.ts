import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_CONFIG } from '../config/gameConfig';
import {
  createEffects,
  runSimulationTick,
  vehicleBodyHalfExtents
} from '../domain/services/simulationEngine';
import { createInitialGameState } from '../domain/types/initialState';
import { VehicleArchetype } from '../domain/types/gameState';
import { VEHICLE_MODELS } from '../rendering/models/vehicleModels';

let randomSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  let value = 20260902;
  randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  });
});

afterEach(() => {
  randomSpy?.mockRestore();
  randomSpy = null;
});

describe('mixed road fleet', () => {
  it('keeps every special vehicle visible in ordinary through traffic', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    const effects = createEffects();
    const seen = new Set<VehicleArchetype>();

    for (let tick = 0; tick < 36_000; tick++) {
      runSimulationTick(state, 0.05, effects);
      for (const vehicle of Object.values(state.vehicles)) {
        if (vehicle.state === 'PASSING') seen.add(vehicle.archetype);
      }
      if (state.dayState.isDayEnding) {
        state.dayState.gameTime = GAME_CONFIG.economy.dayStartHour;
        state.dayState.isDayEnding = false;
        effects.dayEnded = false;
      }
    }

    expect(seen.size).toBeGreaterThanOrEqual(10);
    for (const archetype of ['police', 'ambulance', 'firetruck', 'bus', 'monster'] as const) {
      expect(seen.has(archetype), `${archetype} never appeared on the highway`).toBe(true);
    }
  });

  it('makes emergency vehicles common enough on the road but unlikely to stop', () => {
    for (const archetype of ['police', 'ambulance', 'firetruck'] as const) {
      const config = GAME_CONFIG.customerTypes[archetype];
      expect(config.roadTrafficWeight).toBeGreaterThanOrEqual(0.8);
      expect(config.stationStopWeight).toBeLessThanOrEqual(0.12);
    }
  });

  it('gives heavy vehicles larger tanks, slower road pace and larger bodies', () => {
    const commuter = GAME_CONFIG.customerTypes.commuter;
    for (const archetype of ['truck', 'firetruck', 'bus'] as const) {
      const config = GAME_CONFIG.customerTypes[archetype];
      expect(config.minDemand).toBeGreaterThan(commuter.maxDemand);
      expect(config.roadSpeedMultiplier).toBeLessThan(1);
    }

    expect(vehicleBodyHalfExtents({ archetype: 'bus', modelVariant: 'bus' }).length)
      .toBeGreaterThan(vehicleBodyHalfExtents({ archetype: 'commuter', modelVariant: 'sedan' }).length);
    expect(
      vehicleBodyHalfExtents({ archetype: 'truck', modelVariant: 'truck-with-trailer' }).length
    ).toBeGreaterThan(2);
  });

  it('renders emergency vans at a clearly larger scale than passenger cars', () => {
    expect(VEHICLE_MODELS.ambulance.targetLength).toBeGreaterThan(
      VEHICLE_MODELS.sedan.targetLength * 1.4
    );
    expect(VEHICLE_MODELS.firetruck.targetLength).toBeGreaterThan(
      VEHICLE_MODELS.sedan.targetLength * 1.9
    );
  });

  it('gives heavy commercial vehicles a clearly larger road presence', () => {
    expect(VEHICLE_MODELS.truck.targetLength).toBeGreaterThan(
      VEHICLE_MODELS.sedan.targetLength * 1.4
    );
    expect(VEHICLE_MODELS['truck-with-trailer'].targetLength).toBeGreaterThan(
      VEHICLE_MODELS.sedan.targetLength * 2.6
    );
    expect(VEHICLE_MODELS.bus.targetLength).toBeGreaterThan(
      VEHICLE_MODELS.sedan.targetLength * 2.5
    );
  });

  it('maps every configured variant to a bundled model definition', () => {
    for (const config of Object.values(GAME_CONFIG.customerTypes)) {
      expect(config.vehicleModels.length).toBeGreaterThan(0);
      for (const variant of config.vehicleModels) expect(VEHICLE_MODELS[variant]).toBeDefined();
    }
  });
});
