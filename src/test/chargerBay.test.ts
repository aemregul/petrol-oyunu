import { describe, it, expect } from 'vitest';
import { pumpBayOffset, serviceBayRect, CHARGER_BAY_OFFSET, PUMP_BAY_OFFSET } from '../domain/services/simulationEngine';
import { GAME_CONFIG } from '../config/gameConfig';

/**
 * Emre, 2026-09-07: the car does not park next to the charger on a pad of
 * its own; it pulls up on the post's slab, right beside the post, the way
 * the reference game has it. The post is slim (1×2) and its bay is close.
 */
describe('the charging post and its bay', () => {
  it('is a slim pillar', () => {
    expect(GAME_CONFIG.buildings.ev_charger_ac.size).toEqual([1, 2]);
    expect(GAME_CONFIG.buildings.ev_charger_dc.size).toEqual([1, 2]);
  });

  it('keeps the car closer to a post than to a pump', () => {
    expect(pumpBayOffset({ rotation: 0, type: 'ev_charger_dc' })).toEqual([CHARGER_BAY_OFFSET, 0]);
    expect(pumpBayOffset({ rotation: 0 })).toEqual([PUMP_BAY_OFFSET, 0]);
    expect(pumpBayOffset({ rotation: 90, type: 'ev_charger_ac' })).toEqual([0, -CHARGER_BAY_OFFSET]);
    expect(CHARGER_BAY_OFFSET).toBeLessThan(PUMP_BAY_OFFSET);
  });

  it('parks the car on the slab against the post, never inside it', () => {
    // A hatchback is 1.7 world units (0.85 grid) wide, so its near side is
    // 0.425 from its centre; the post's footprint ends at 0.5. Beside it,
    // not in it, and no daylight to speak of.
    const [ox] = pumpBayOffset({ rotation: 0, type: 'ev_charger_dc' });
    const carNearEdge = ox - 0.425;
    expect(carNearEdge).toBeGreaterThan(0.5 - 0.15);
    expect(carNearEdge - 0.5).toBeLessThan(0.1);
    const rect = serviceBayRect([13, 8], 0, [1, 2], 'ev_charger_dc');
    expect(rect.minX).toBeCloseTo(13.5, 5);
    expect(rect.maxX).toBeCloseTo(13 + ox + 0.6, 5);
  });
});
