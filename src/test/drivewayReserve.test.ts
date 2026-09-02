import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { evaluatePlacement } from '../domain/services/placement';
import { blockLayout, drivewayReserveRects } from '../domain/services/simulationEngine';
import { GameState } from '../domain/types/gameState';

/**
 * Araç yolu güvencesi — Emre'nin önerisi (2026-09-02, ilham alınan oyundaki
 * kırmızı taralı alan): araçların kaçacak yolu HER ZAMAN kalmalı.
 *
 * İki katman: kapı koridorları (giriş/çıkış ağzından ön şeride inen şeritler)
 * inşaata kapalı bir rezervdir; ve koridora hiç dokunmayan bir yerleşim bile
 * girişten çıkışa sürülebilir yol bırakmıyorsa reddedilir. Böylece dünkü
 * "takılan araç yeni yol bulur" düzeltmesinin çaresiz kaldığı tek durum —
 * fiziksel olarak mühürlenmiş arsa — daha kurulamadan engellenir.
 */
function openPlot(): GameState {
  const state = createInitialGameState();
  state.player.level = 99;
  return state;
}

describe('the driveway reserve', () => {
  it('is a U: both mouths down to the lane, and the strip joining them', () => {
    const state = openPlot();
    const block = blockLayout(state, 'near')!;
    const rects = drivewayReserveRects(state, 'near');

    expect(rects).toHaveLength(3);
    for (const [i, mouth] of [block.entry, block.exit].entries()) {
      expect(rects[i].kind).toBe('mouth');
      expect(rects[i].minX).toBeCloseTo(mouth.x - mouth.width / 2);
      expect(rects[i].maxX).toBeCloseTo(mouth.x + mouth.width / 2);
      expect(rects[i].minZ).toBe(block.minZ);
      expect(rects[i].maxZ).toBeGreaterThan(block.laneZ);
    }

    // Bağlantı şeridi ağızdan ağıza uzanır ve ön şeridi içine alır.
    const lane = rects[2];
    expect(lane.kind).toBe('lane');
    expect(lane.minX).toBeCloseTo(rects[0].minX);
    expect(lane.maxX).toBeCloseTo(rects[1].maxX);
    expect(lane.minZ).toBeLessThan(block.laneZ);
    expect(lane.maxZ).toBeGreaterThan(block.laneZ);
  });

  it('refuses a solid building on the entry corridor', () => {
    const result = evaluatePlacement(openPlot(), 'cafe', [3, 4], 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/rezerv/i);
  });

  it('refuses a solid building on the connecting strip between the mouths', () => {
    const result = evaluatePlacement(openPlot(), 'cafe', [8, 4], 0);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/rezerv/i);
  });

  it('still allows ground paint on the corridor — a marked-out park is not a wall', () => {
    expect(evaluatePlacement(openPlot(), 'car_park', [3, 4], 0).valid).toBe(true);
  });

  it('lets a road-facing pump lean its bay onto the strip, but not into a mouth', () => {
    const state = openPlot();
    // Başlangıç pompasının kendisiyle çakışmasın: saha boş.
    state.pumps = {};

    // Varsayılan yerleşim: yola dönük pompa, duruş alanı z 4.6..6 ile şeride
    // değiyor — bu, önalanın olağan hali ve serbest kalmak zorunda.
    expect(evaluatePlacement(state, 'pump_standard', [8.5, 7], 90).valid).toBe(true);

    // Ağız koridoruna sarkan duruş alanı ise kapıda park eden araç demek:
    // ayak izi tamamen rezerv dışında olsa bile red.
    const throat = evaluatePlacement(state, 'pump_standard', [13, 7], 90);
    expect(throat.valid).toBe(false);
    expect(throat.reason).toMatch(/rezerv/i);
  });

  it('allows the same building anywhere off the reserve', () => {
    expect(evaluatePlacement(openPlot(), 'cafe', [8, 12.5], 0).valid).toBe(true);
  });
});

describe('the entry-to-exit passage', () => {
  /**
   * x=8 sütununda betonun önünden arkaya doğru örülen duvar. Parçalar teker
   * teker meşru: hiçbiri koridora değmiyor, hiçbiri tek başına yolu kesmiyor.
   * Mühürleyen yalnız SON parçadır ve reddedilmesi gereken de odur.
   */
  function wallPiece(state: GameState, id: string, z: number): void {
    state.buildings[id] = {
      id, type: 'cafe', level: 1, position: [8, z], rotation: 0, size: [3, 3],
      health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
    } as GameState['buildings'][string];
  }

  it('refuses only the wall piece that seals the forecourt', () => {
    const state = openPlot();
    state.buildings = {};
    state.pumps = {};

    wallPiece(state, 'w1', 2.5);
    wallPiece(state, 'w2', 5.5);

    // Duvar z 1–7'yi kapatıyor; z 7–14 hâlâ açık — bu parça meşru.
    expect(evaluatePlacement(state, 'cafe', [8, 11.5], 0).valid).toBe(true);

    // Üçüncü parça araları z 10'a kadar doldurdu; artık aynı parça arsayı
    // mühürlüyor (kalan z 13–14 aralığından araç geçemez) ve reddedilir.
    wallPiece(state, 'w3', 8.5);
    const sealing = evaluatePlacement(state, 'cafe', [8, 11.5], 0);
    expect(sealing.valid).toBe(false);
    expect(sealing.reason).toMatch(/kapatıyor/);

    // Mühürlemeyen bir konum aynı anda serbest kalır: red, konuma özgüdür.
    expect(evaluatePlacement(state, 'cafe', [4.5, 7.5], 0).valid).toBe(true);
  });

  it('refuses the building that would strand a car already on the plot', () => {
    // Girişten çıkışa yol açık kalsa bile: varsayılan sahada (ofis + ada +
    // tank) arka şeritteki bir aracın üstüne kafe inince araç ofis-ada-kafe
    // cebinde fiziksel olarak mühürlenir ve 20 sn valfiyle buharlaşırdı —
    // Emre'nin "sıkışan sıkışıyor ve siliniyor, kötü izlenim" şikâyeti.
    // Yerleşim, sahadaki aracı hapsedecekse daha kurulamadan reddedilir.
    const state = openPlot();
    state.vehicles.onPlot = {
      id: 'onPlot', archetype: 'commuter', fuelType: 'gasoline', tankCapacity: 60,
      currentFuel: 50,
      request: {
        mode: 'FULL', targetValue: 10, calculatedLiters: 10, calculatedPrice: 0,
        dispensedLiters: 0, isFinished: true
      },
      patience: 60, maxPatience: 60, satisfaction: 100, state: 'EXIT',
      targetPumpId: null, assignedActor: null,
      worldPosition: [7, 0, 11], targetWaypoint: null, route: [],
      heading: Math.PI / 2, speed: 1, routeProgress: 0,
      waitingTimeSeconds: 0, shoppingIntent: false, chargingBuildingId: null,
      chargeSecondsLeft: 0
    } as GameState['vehicles'][string];

    const trapping = evaluatePlacement(state, 'cafe', [10, 11], 0);
    expect(trapping.valid).toBe(false);
    expect(trapping.reason).toMatch(/aracın çıkış yolunu/);

    // Araç gidince aynı kare serbesttir: red, yapıya değil âna aittir.
    delete state.vehicles.onPlot;
    expect(evaluatePlacement(state, 'cafe', [10, 11], 0).valid).toBe(true);
  });
});
