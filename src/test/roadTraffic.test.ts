import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick, LAYOUT } from '../domain/services/simulationEngine';

/**
 * Yol, arsayı beklemez.
 *
 * Emre'nin 2026-09-05 kuralı: karayolu ikinci şeride çıkarıldığı an KARŞI
 * şeritte de trafik akar — karşıda tek karış beton olmasa bile. Eskiden karşı
 * şeridin araçları ancak karşı arsa kurulunca doğuyordu; çift şeritli yolun
 * bir tarafı bomboş akıyordu ve "yol" değil "dekor" gibi duruyordu. Beton
 * yoksa değişen tek şey: oradan kimse DURAMAZ, herkes yalnızca geçer.
 */
const FAR_ROAD_Z = LAYOUT.roadZ - 2 * LAYOUT.roadHalfWidth - LAYOUT.medianWidth;

function seedRandom(seed = 9): () => void {
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

describe('the highway lives on its own', () => {
  it('flows on BOTH carriageways once the road is dual, with no far plot at all', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.station.roadLevel = 2;
    // Karşıda arsa YOK — satın alınmamış, beton dökülmemiş. Kural tam bu.

    const effects = createEffects();
    const farTravel = new Map<string, { min: number; max: number }>();
    let nearSeen = 0;
    let farOffRoad = 0;

    for (let i = 0; i < 20000; i++) {
      state.dayState.gameTime = 12;
      runSimulationTick(state, 0.05, effects);

      for (const v of Object.values(state.vehicles)) {
        const [x, , z] = v.worldPosition;
        if (Math.abs(z - LAYOUT.roadZ) < 1) nearSeen++;
        if (Math.abs(z - FAR_ROAD_Z) < 1) {
          const t = farTravel.get(v.id) ?? { min: x, max: x };
          t.min = Math.min(t.min, x);
          t.max = Math.max(t.max, x);
          farTravel.set(v.id, t);
          // Karşıda duracak yer yok: karşı şeridin aracı yalnızca geçendir.
          if (v.state !== 'PASSING' && v.state !== 'DESPAWN') farOffRoad++;
        }
      }
    }

    // Karşı şeritte gerçek bir akış var: birden çok araç, yolun kayda değer
    // bir bölümünü katederek geçti — spawn olup yerinde silinen hayalet değil.
    const travellers = [...farTravel.values()].filter((t) => t.max - t.min > 30);
    expect(farTravel.size).toBeGreaterThan(3);
    expect(travellers.length).toBeGreaterThan(3);

    // Karşıya sapmaya çalışan olmadı; yakın şerit de akmaya devam etti.
    expect(farOffRoad).toBe(0);
    expect(nearSeen).toBeGreaterThan(0);
  });
});
