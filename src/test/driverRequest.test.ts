import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  createEffects,
  driverRequest,
  runSimulationTick,
  REQUEST_LIRA_STEP
} from '../domain/services/simulationEngine';
import { VehicleEntity } from '../domain/types/gameState';

/**
 * Müşteri isteği: ya "depoyu doldur" ya da yuvarlak bir tutar. ₺1.527,60
 * gibi küsuratlı bir istek hiçbir zaman gelmez.
 */
describe('driver request', () => {
  it('names a whole sum in lira steps that fits the space in the tank', () => {
    for (let i = 0; i < 500; i++) {
      const demand = 8 + Math.floor(Math.random() * 172);
      const price = 20 + Math.random() * 40;
      const req = driverRequest(demand, price, false);

      expect(req.mode).toBe('MONEY');
      expect(Number.isInteger(req.targetValue)).toBe(true);
      expect(req.targetValue % REQUEST_LIRA_STEP).toBe(0);
      expect(req.calculatedPrice).toBe(req.targetValue);
      // Adı konan para tam olarak o kadar litre eder; deponun boşluğunu aşmaz.
      expect(req.calculatedLiters * price).toBeCloseTo(req.targetValue, 6);
      expect(req.calculatedLiters).toBeLessThanOrEqual(demand + 1e-9);
      // Yuvarlama bir adımdan fazla eksiltmez.
      expect(demand * price - req.targetValue).toBeLessThan(REQUEST_LIRA_STEP);
    }
  });

  it('pins the sum to concrete figures', () => {
    // 34 L × ₺44,90 = ₺1.526,60 → müşteri ₺1.500 ister.
    expect(driverRequest(34, 44.9, false).targetValue).toBe(1500);
    // 8 L × ₺22 = ₺176 → ₺150.
    expect(driverRequest(8, 22, false).targetValue).toBe(150);
    // Bir adımın altına inmez.
    expect(driverRequest(1, 20, false).targetValue).toBe(REQUEST_LIRA_STEP);
  });

  it('keeps a full-tank request in litres', () => {
    const req = driverRequest(34, 44.9, true);
    expect(req.mode).toBe('FULL');
    expect(req.targetValue).toBe(34);
    expect(req.calculatedLiters).toBe(34);
  });

  it('spawns drivers who ask for either a full tank or a round sum, never kuruş', () => {
    const state = createInitialGameState();
    state.dayState.isDayActive = true;
    state.dayState.timeSpeed = 1;
    const effects = createEffects();

    const seen = new Map<string, VehicleEntity['request']>();
    for (let i = 0; i < 6000 && seen.size < 40; i++) {
      runSimulationTick(state, 0.5, effects);
      for (const v of Object.values(state.vehicles)) {
        if (v.state !== 'PASSING' && !seen.has(v.id)) {
          seen.set(v.id, { ...v.request });
        }
      }
    }
    expect(seen.size).toBeGreaterThan(10);

    const modes = new Set<string>();
    for (const req of seen.values()) {
      modes.add(req.mode);
      expect(['FULL', 'MONEY']).toContain(req.mode);
      expect(Number.isInteger(req.targetValue)).toBe(true);
      if (req.mode === 'MONEY') {
        expect(req.targetValue % REQUEST_LIRA_STEP).toBe(0);
        expect(req.calculatedPrice).toBe(req.targetValue);
      }
    }
    // İki tür müşteri de gelir: depo isteyen ve tutar söyleyen.
    expect(modes.has('FULL')).toBe(true);
    expect(modes.has('MONEY')).toBe(true);
  });
});
