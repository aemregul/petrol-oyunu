import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';
import { GAME_CONFIG } from '../config/gameConfig';

/**
 * Elektrikli müşteri şarj direğine gerçekten YANAŞIR — atanmakla kalmaz.
 *
 * Kota kurbanı bir denetçi ajanının yarım bıraktığı sondadan doğdu: bay
 * noktası park marjıyla (apron 2.5) betona kırpılınca, kenara yakın bir
 * direğin bay'i direğin dibine biniyordu; araç yanaşırken gövdesi direğe
 * girdiği için katı yapı kuralı her adımı geri aldı ve müşteri şarjın yarım
 * metre önünde sonsuza dek asılı kaldı (2000 oyun-saniyesinde 0 yanaşma,
 * 100+ sn solidStuck). Bay artık sürüş marjıyla (LANE_HALF_WIDTH) kırpılır.
 */
function seedRandom(seed = 5): () => void {
  let value = seed >>> 0;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  });
  return () => spy.mockRestore();
}

let restore: (() => void) | null = null;
beforeEach(() => {
  restore = seedRandom();
});
afterEach(() => {
  restore?.();
});

function probeCharger(size: [number, number], rotation: 0 | 90) {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.level = 12;

  // Direk bilerek sağ kenara yakın: [13,8] rot 0 → bay x 14.4, arsa kenarı
  // 16 — park marjı (13.5) bay'i direğe bindiriyordu, sürüş marjı (14.6)
  // bindirmez.
  state.buildings.dc = {
    id: 'dc', type: 'ev_charger_dc', level: 1, position: [13, 8], rotation,
    size, health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
  } as never;
  state.buildings.sub = {
    id: 'sub', type: 'ev_substation', level: 1, position: [13, 12], rotation: 0,
    size: [3, 3], health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
  } as never;

  const effects = createEffects();
  let assignedTicks = 0;
  let maxSolidStuck = 0;
  for (let i = 0; i < 40000; i++) {
    state.dayState.gameTime = 12;
    runSimulationTick(state, 0.05, effects);
    for (const v of Object.values(state.vehicles)) {
      if (v.chargingBuildingId !== 'dc') continue;
      assignedTicks++;
      maxSolidStuck = Math.max(maxSolidStuck, v.solidStuckSeconds ?? 0);
      if (v.state === 'AT_PUMP' || v.state === 'FUELING' || v.state === 'REQUEST') {
        return { assignedTicks, docked: true, maxSolidStuck };
      }
    }
  }
  return { assignedTicks, docked: false, maxSolidStuck };
}

describe('the electric customer docks at the post', () => {
  for (const [size, rotation] of [
    [[1, 2], 0],
    [GAME_CONFIG.buildings.ev_charger_dc.size, 0],
    [GAME_CONFIG.buildings.ev_charger_dc.size, 90]
  ] as Array<[[number, number], 0 | 90]>) {
    it(`docks and never wedges — size ${size} rot ${rotation}`, () => {
      const r = probeCharger(size, rotation);
      expect(r.assignedTicks).toBeGreaterThan(0);
      expect(r.docked).toBe(true);
      // Katı kurala anlık sürtünme olabilir; saplanma olamaz.
      expect(r.maxSolidStuck).toBeLessThan(5);
    });
  }
});
