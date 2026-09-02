import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  blockLayout,
  createEffects,
  drivewayLaneX,
  runSimulationTick
} from '../domain/services/simulationEngine';
import { GameState } from '../domain/types/gameState';

/**
 * Duvara takılan araç heykel olmaz: kendine boş bir yol bulup ÇIKAR.
 *
 * Emre'nin 2026-09-02 gözlemi: katı yapı kuralı araçları binaların içinden
 * geçirmemeyi öğrendi, ama rotasının üstüne sonradan bina konan araç "başka
 * yol bulmam gerekiyor" davranışı göstermiyordu — olduğu yerde donuyor,
 * arkadan gelenler üstüne yığılıp iç içe geçiyordu. Beklenen: takılan araç
 * kısa bir duraksamadan sonra engelin etrafından dolanan taze bir rota çizer
 * ve kendi tekerleğiyle yoldan çıkar; 20 saniyelik buharlaşma valfi yalnız
 * gerçekten yolu kalmayan araca kalır.
 */
function silenceTraffic(): () => void {
  // Spawn zarı hiç tutmaz: sahnede yalnız bizim araç kalır, test deterministik.
  const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  return () => spy.mockRestore();
}

let restore: (() => void) | null = null;
beforeEach(() => {
  restore = silenceTraffic();
});
afterEach(() => {
  restore?.();
});

describe('the walled-off leaver finds another way out', () => {
  it('reroutes around a building dropped on its exit lane and drives off the plot', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;

    // Başlangıç sahnesindeki ofis ve tank çiftliği bu senaryonun konusu değil
    // — ekran görüntüsündeki gibi açık bir önalan: yolun üstünde TEK yapı, iki
    // yanı boş. (Üçü birden kaldığında pompa adasıyla birlikte aracın etrafını
    // fiziksel olarak da mühürlüyorlar; o arsanın gerçekten yolu yok.)
    delete state.buildings.office_1;
    delete state.buildings.tank_1;

    const block = blockLayout(state, 'near')!;
    const exitX = drivewayLaneX(block.exit, 0);

    // Ayrılan araç dönüş şeridinde, rotası bina yokken çizilmiş: şerit
    // boyunca çıkış ağzına, oradan yola.
    const leaver = {
      id: 'leaver', archetype: 'commuter', fuelType: 'gasoline', tankCapacity: 60,
      currentFuel: 50,
      request: {
        mode: 'FULL', targetValue: 10, calculatedLiters: 10, calculatedPrice: 0,
        dispensedLiters: 0, isFinished: true
      },
      patience: 60, maxPatience: 60, satisfaction: 100, state: 'EXIT',
      targetPumpId: null, assignedActor: null,
      worldPosition: [3, 0, block.exitLaneZ] as [number, number, number],
      targetWaypoint: [exitX, 0, block.exitLaneZ] as [number, number, number],
      route: [
        [exitX, 0, block.roadLaneZ],
        [block.roadEndX, 0, block.roadLaneZ]
      ] as Array<[number, number, number]>,
      heading: Math.PI / 2, speed: 1, routeProgress: 0,
      waitingTimeSeconds: 0, shoppingIntent: false, chargingBuildingId: null,
      chargeSecondsLeft: 0
    } as GameState['vehicles'][string];
    state.vehicles.leaver = leaver;

    // Rota çizildikten SONRA şeridin ortasına kafe kondu — araçla çıkış
    // arasında, eski rotanın tam üstünde.
    state.buildings.cafe = {
      id: 'cafe', type: 'cafe', level: 1,
      position: [8, block.exitLaneZ], rotation: 0, size: [3, 3],
      health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    } as GameState['buildings'][string];
    const cafe = { minX: 6.5, maxX: 9.5, minZ: block.exitLaneZ - 1.5, maxZ: block.exitLaneZ + 1.5 };

    const effects = createEffects();
    let maxSolidStuck = 0;
    let lastSeen: [number, number, number] = [...leaver.worldPosition];
    let everInsideCafe = false;

    for (let i = 0; i < 4000; i++) {
      state.dayState.gameTime = 12;
      runSimulationTick(state, 0.05, effects);
      const alive = state.vehicles.leaver;
      if (!alive) break;
      maxSolidStuck = Math.max(maxSolidStuck, alive.solidStuckSeconds ?? 0);
      lastSeen = [...alive.worldPosition];
      const [x, , z] = alive.worldPosition;
      if (x > cafe.minX && x < cafe.maxX && z > cafe.minZ && z < cafe.maxZ) {
        everInsideCafe = true;
      }
    }

    // Gitti — ve buharlaşarak değil, kendi tekerleğiyle yoldan çıkarak.
    expect(state.vehicles.leaver).toBeUndefined();
    expect(lastSeen[2]).toBeLessThan(0);
    // Takılma anlık kaldı: 20 saniyelik valf hiç yaklaşılmadan yeni yol bulundu.
    expect(maxSolidStuck).toBeLessThan(5);
    // Yeni yol binanın İÇİNDEN geçmedi.
    expect(everInsideCafe).toBe(false);
  });
});
