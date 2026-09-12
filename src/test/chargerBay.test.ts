import { describe, it, expect } from 'vitest';
import {
  chargerBayDir,
  pumpBayOffset,
  serviceBayRect,
  CHARGER_BAY_OFFSET,
  PUMP_BAY_OFFSET
} from '../domain/services/simulationEngine';
import { GAME_CONFIG } from '../config/gameConfig';

/**
 * Emre, 2026-09-11: the post is at the head of a perpendicular parking bay.
 * The car reverses toward it and leaves nose-first, like a real EV stall.
 */
describe('the charging post and its bay', () => {
  it('is a slim pillar', () => {
    expect(GAME_CONFIG.buildings.ev_charger_ac.size).toEqual([1, 2]);
    expect(GAME_CONFIG.buildings.ev_charger_dc.size).toEqual([1, 2]);
  });

  it('puts the charging bay beyond the post and points it outwards', () => {
    expect(pumpBayOffset({ rotation: 0, type: 'ev_charger_dc' })).toEqual([CHARGER_BAY_OFFSET, 0]);
    expect(pumpBayOffset({ rotation: 0 })).toEqual([PUMP_BAY_OFFSET, 0]);
    expect(pumpBayOffset({ rotation: 90, type: 'ev_charger_ac' })).toEqual([0, -CHARGER_BAY_OFFSET]);
    expect(CHARGER_BAY_OFFSET).toBeGreaterThan(PUMP_BAY_OFFSET);
    expect(chargerBayDir({ rotation: 0 })).toEqual([1, 0]);
    expect(chargerBayDir({ rotation: 90 })).toEqual([0, -1]);
  });

  it('parks the car lengthwise against the post, never inside it', () => {
    // A hatchback's logical half-length is 0.9 grid. The post footprint ends
    // at 0.5, leaving five centimetres of grid clearance at the bay head.
    const [ox] = pumpBayOffset({ rotation: 0, type: 'ev_charger_dc' });
    const carNearEdge = ox - 0.9;
    expect(carNearEdge).toBeGreaterThan(0.5);
    expect(carNearEdge - 0.5).toBeLessThan(0.1);
    const rect = serviceBayRect([13, 8], 0, [1, 2], 'ev_charger_dc');
    expect(rect.minX).toBeCloseTo(13.5, 5);
    expect(rect.maxX).toBeCloseTo(13 + ox + 1 + 1, 5);
    expect(rect.maxZ - rect.minZ).toBeCloseTo(1.2, 5);
  });
});
