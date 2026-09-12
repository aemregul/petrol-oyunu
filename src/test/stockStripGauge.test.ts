import { describe, it, expect } from 'vitest';
import { tankGauge } from '../ui/StockStrip';

/**
 * Emre, 2026-09-12: the tank card on the HUD must fall live while a pour
 * runs. It reads the litres in the tank — which now drop as fuel goes down
 * the hose — and the hover says how much a pour in progress still holds.
 */
describe('the tank card on the HUD', () => {
  it('reads what is in the tank, and names the part a pour in progress still holds', () => {
    const pouring = tankGauge({ stock: 680, reservedStock: 12, capacity: 1500 });
    expect(pouring.value).toBe('680L');
    expect(pouring.share).toBeCloseTo(680 / 1500, 5);
    expect(pouring.hint).toContain('12 L devam eden doluma ayrıldı');
    expect(pouring.hint).toContain('668 L satılabilir');

    expect(tankGauge({ stock: 680, reservedStock: 0, capacity: 1500 }).hint).toBe('680 L depoda');
  });
});
