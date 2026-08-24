import { describe, it, expect } from 'vitest';
import {
  calculatePriceAttractiveness,
  calculateServiceScore,
  calculateRepairCost,
  calculateRefundAmount,
  calculateManagerAvailableBudget,
  calculateEndOfDayReputation
} from '../domain/formulas/economy';

describe('Economic and Simulation Formulas', () => {
  it('should clamp price attractiveness strictly within [0.55, 1.25]', () => {
    // Exact match
    const balanced = calculatePriceAttractiveness(44.90, 44.90);
    expect(balanced.attractiveness).toBe(1.25);

    // Very cheap
    const cheap = calculatePriceAttractiveness(30.00, 44.90);
    expect(cheap.attractiveness).toBeLessThanOrEqual(1.25);
    expect(cheap.attractiveness).toBeGreaterThanOrEqual(0.55);

    // Very expensive
    const expensive = calculatePriceAttractiveness(80.00, 44.90);
    expect(expensive.attractiveness).toBe(0.55);
  });

  it('should accurately calculate service score according to GDD Section 13.3 weights', () => {
    // 0.45 * 100 + 0.35 * 100 + 0.20 * 100 = 100
    const perfectScore = calculateServiceScore(100, 100, 100);
    expect(perfectScore).toBe(100);

    // 0.45 * 50 + 0.35 * 100 + 0.20 * 80 = 22.5 + 35 + 16 = 73.5 -> 74
    const midScore = calculateServiceScore(50, 100, 80);
    expect(midScore).toBe(74);
  });

  it('should compute repair cost with minimum 250 TL floor', () => {
    const repairCost = calculateRepairCost(18000, 50); // 50% health missing -> 18000 * 0.5 * 0.18 = 1620
    expect(repairCost).toBe(1620);

    const minFloorCost = calculateRepairCost(18000, 99.9); // Tiny damage -> hits 250 TL min
    expect(minFloorCost).toBe(250);
  });

  it('should calculate 55% refund on building sale', () => {
    const refund = calculateRefundAmount(10000, 5000); // 15000 * 0.55 = 8250
    expect(refund).toBe(8250);
  });

  it('should enforce manager kasa reserve bounds', () => {
    const budget = calculateManagerAvailableBudget(20000, 8000, 2000, 1000);
    expect(budget).toBe(9000);

    // If cash is below reserve, budget is 0
    const zeroBudget = calculateManagerAvailableBudget(5000, 8000, 0, 0);
    expect(zeroBudget).toBe(0);
  });

  it('should update reputation bounded between 1.00 and 5.00', () => {
    const rep = calculateEndOfDayReputation(3.00, 90, 0);
    expect(rep).toBeGreaterThanOrEqual(1.00);
    expect(rep).toBeLessThanOrEqual(5.00);
  });
});
