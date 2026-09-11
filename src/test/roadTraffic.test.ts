import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  blockLayout,
  createEffects,
  highwayLaneZ,
  runSimulationTick,
  LAYOUT
} from '../domain/services/simulationEngine';
import { CAMERA_VIEWS, groundCoverage, MIN_ZOOM } from '../rendering/cameraFrame';

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
  it(
    'flows on BOTH carriageways once the road is dual, with no far plot at all',
    () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    state.station.roadLevel = 2;
    // Karşıda arsa YOK — satın alınmamış, beton dökülmemiş. Kural tam bu.

    const effects = createEffects();
    const nearBlock = blockLayout(state, 'near')!;
    const nearRightZ = highwayLaneZ(nearBlock, 'right');
    const nearLeftZ = highwayLaneZ(nearBlock, 'left');
    const farRoad = {
      side: 'far' as const,
      roadLaneZ: FAR_ROAD_Z,
      roadHalfWidth: LAYOUT.roadHalfWidth
    };
    const farRightZ = highwayLaneZ(farRoad, 'right');
    const farLeftZ = highwayLaneZ(farRoad, 'left');
    const farTravel = new Map<string, { min: number; max: number }>();
    const passingLaneVisits = new Map<string, { right: boolean; left: boolean }>();
    let nearSeen = 0;
    let farOffRoad = 0;
    let approachInWrongLane = 0;

    for (let i = 0; i < 12000; i++) {
      state.dayState.gameTime = 12;
      runSimulationTick(state, 0.05, effects);

      for (const v of Object.values(state.vehicles)) {
        const [x, , z] = v.worldPosition;
        if (Math.abs(z - LAYOUT.roadZ) < LAYOUT.roadHalfWidth) {
          nearSeen++;
          if (
            (v.state === 'SPAWN' || v.state === 'ROAD_APPROACH') &&
            (nearBlock.entry.x - x) * Math.sign(nearBlock.roadEndX - nearBlock.roadStartX) > 1 &&
            Math.abs(z - nearRightZ) > 0.4
          ) {
            approachInWrongLane++;
          }
        }
        if (Math.abs(z - FAR_ROAD_Z) < LAYOUT.roadHalfWidth) {
          const t = farTravel.get(v.id) ?? { min: x, max: x };
          t.min = Math.min(t.min, x);
          t.max = Math.max(t.max, x);
          farTravel.set(v.id, t);
          // Karşıda duracak yer yok: karşı şeridin aracı yalnızca geçendir.
          if (v.state !== 'PASSING' && v.state !== 'DESPAWN') farOffRoad++;
        }

        if (v.state === 'PASSING') {
          const rightZ = z < (LAYOUT.roadZ + FAR_ROAD_Z) / 2 ? farRightZ : nearRightZ;
          const leftZ = z < (LAYOUT.roadZ + FAR_ROAD_Z) / 2 ? farLeftZ : nearLeftZ;
          const lanes = passingLaneVisits.get(v.id) ?? { right: false, left: false };
          if (Math.abs(z - rightZ) < 0.4) lanes.right = true;
          if (Math.abs(z - leftZ) < 0.4) lanes.left = true;
          passingLaneVisits.set(v.id, lanes);
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
    expect(approachInWrongLane).toBe(0);

    // Transit traffic lives in the overtaking lane, while a varied minority
    // arrives on the right and visibly moves left before passing the station.
    expect([...passingLaneVisits.values()].filter((lanes) => lanes.left).length).toBeGreaterThan(5);
    expect(
      [...passingLaneVisits.values()].filter((lanes) => lanes.right && lanes.left).length
    ).toBeGreaterThan(0);
    },
    // 12.000 tik'lik gerçek simülasyon: yüklü bir makinede 30 sn'lik
    // varsayılan bütçe ara sıra yetmiyordu ve test asılsız kırmızı yanıyordu.
    120_000
  );

  it('lets an impatient arrival abandon the right-lane queue and merge left', () => {
    const state = createInitialGameState();
    state.dayState.timeSpeed = 1;
    const block = blockLayout(state, 'near')!;
    const rightLaneZ = highwayLaneZ(block, 'right');
    const leftLaneZ = highwayLaneZ(block, 'left');
    const x = block.entry.x - 6;

    state.vehicles.impatient = {
      id: 'impatient', archetype: 'commuter', fuelType: 'gasoline',
      tankCapacity: 60, currentFuel: 20,
      request: { mode: 'FULL', targetValue: 0, calculatedLiters: 40, calculatedPrice: 0, dispensedLiters: 0, isFinished: false },
      patience: 0.01, maxPatience: 1, satisfaction: 100,
      state: 'ROAD_APPROACH', targetPumpId: null, assignedActor: null,
      worldPosition: [x, 0, rightLaneZ],
      targetWaypoint: [block.entry.x, 0, rightLaneZ],
      route: [[block.entry.x, 0, block.laneZ]], heading: Math.PI / 2,
      speed: 1, routeProgress: 0, waitingTimeSeconds: 0, shoppingIntent: false
    };
    state.vehicles.blocker = {
      ...state.vehicles.impatient,
      id: 'blocker',
      state: 'AT_PUMP',
      worldPosition: [x + 1.5, 0, rightLaneZ],
      targetWaypoint: null,
      route: [],
      patience: 1000,
      maxPatience: 1000
    };
    state.vehicles.left_flow = {
      ...state.vehicles.impatient,
      id: 'left_flow',
      state: 'PASSING',
      worldPosition: [x, 0, leftLaneZ],
      targetWaypoint: [block.roadEndX, 0, leftLaneZ],
      route: [],
      patience: 1000,
      maxPatience: 1000
    };

    runSimulationTick(state, 0.05, createEffects());

    const driver = state.vehicles.impatient;
    expect(driver.state).toBe('PASSING');
    expect([driver.targetWaypoint, ...driver.route].some((p) => p?.[2] === leftLaneZ)).toBe(true);
    expect(driver.worldPosition[2]).toBeCloseTo(rightLaneZ);
    expect(state.vehicles.left_flow.worldPosition[0]).toBeGreaterThan(x);
  });

  it('spawns and despawns beyond the camera reach, never mid-screen', () => {
    // Emre'nin 2026-09-05 şikâyeti: araçlar yolun ortasında beliriyor ve
    // yolun ortasında buharlaşıyordu — roadMargin (42) kameranın gerçek
    // menzilinin içindeydi. Bu çivi, marjı kamera matematiğinin kendisine
    // bağlar: en uzak zoom'da en geniş görüşün (kuşbakışı) yarı genişliği +
    // pan sınırının arsa kenarını aşabildiği pay. Yarın biri zoom'u ya da
    // pan'ı genişletirse bu test kırılır, araçlar yine ekranda doğmaz.
    const widestView = Math.max(...CAMERA_VIEWS.map((v) => v.radiusScale));
    const halfViewGrid = (groundCoverage(MIN_ZOOM) * widestView) / 2 / 2; // dünya→grid /2
    const panBeyondEdgeGrid = 24 / 2; // gameStore.panBounds margin, dünya birimi
    const cameraReachGrid = halfViewGrid + panBeyondEdgeGrid;

    expect(LAYOUT.roadMargin).toBeGreaterThan(cameraReachGrid);

    // Ve bloklar bu marjı gerçekten kullanıyor: doğum/siliniş noktaları arsa
    // kenarından tam roadMargin ötede.
    const state = createInitialGameState();
    const block = blockLayout(state, 'near')!;
    expect(block.roadStartX).toBe(block.minX - LAYOUT.roadMargin);
    expect(block.roadEndX).toBe(block.maxX + LAYOUT.roadMargin);
  });
});
