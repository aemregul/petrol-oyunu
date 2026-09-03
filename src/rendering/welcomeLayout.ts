import { GAME_CONFIG } from '../config/gameConfig';
import { BuildingEntity, GameState, PumpEntity, VehicleEntity } from '../domain/types/gameState';
import { STARTING_PARCELS, stationBounds } from '../domain/services/land';
import { priceSignPosition } from '../domain/services/simulationEngine';

/**
 * Karşılama ekranındaki vitrin istasyonun yerleşimi — saf veri, çizim yok.
 *
 * Sahne oyuncunun kaydına değil buna bakar: kaydı bomboş olan yeni oyuncuda
 * da, üç parsel satın almış eski oyuncuda da giriş ekranı aynı açılır. Zemini
 * çizen katmanlar (GroundGrid, SceneryProps) da aynı veriden beslenir; yoksa
 * oyuncunun betonu üstünde bizim binalarımız dururdu.
 *
 * Yerleşim, oyunun kendi kurallarına uyar — evaluatePlacement her parçayı
 * kabul eder (welcomeLayout.test.ts). Vitrin, oyunda kurulamayacak bir şey
 * göstermez.
 *
 * Emre'nin yerleşim tarifi (2026-09-03), ızgara koordinatında (x 0..16 arsa,
 * z 1..14 beton; kamera güneyden bakar, yüksek x EKRANIN SOLUdur):
 *  - Yakıt tankı ofisin SOLUNDA (yüksek x), ofisin önünde değil.
 *  - Şarj direği SAĞ kaldırıma sıfır (x=0), hemen yanında hava-su ünitesi,
 *    o da kaldırıma sıfır.
 *  - Çöp kutusu ortada değil, kenarda.
 *  - Otopark ortada durmaz: fiyat tabelasının olduğu ön kaldırıma doğru,
 *    kurallar izin verdiği kadar önde ve sol kaldırıma yaslı.
 *  - İki pompa, arada boşluk — ortadaki kaldırıldı.
 *  - Sokak lambaları düzgün: cepheye eşit aralıklı bir sıra, kolları
 *    önalana dönük.
 */

const catalog = (type: string) => GAME_CONFIG.buildings[type];

export function welcomeBuilding(
  id: string,
  type: string,
  position: [number, number],
  rotation: 0 | 90 | 180 | 270 = 0,
  level = 1
): BuildingEntity {
  return {
    id,
    type,
    level,
    position,
    // Yerleşim elle kurulmuştur: oyunun altyapı yerleştiricisi (fiyat totemini
    // kendi hesapladığı noktaya taşıyan kural) devreye girmesin diye her şey
    // "oyuncu taşımış" sayılır.
    movedByPlayer: true,
    rotation,
    size: (catalog(type)?.size ?? [2, 2]) as [number, number],
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0
  } as BuildingEntity;
}

export function welcomePump(
  id: string,
  position: [number, number],
  rotation: 0 | 90 | 180 | 270,
  fuels: PumpEntity['supportedFuels'],
  hasCanopy = true
): PumpEntity {
  return {
    id,
    level: fuels.length,
    position,
    rotation,
    supportedFuels: fuels,
    state: 'IDLE',
    health: 100,
    employeeId: null,
    currentVehicleId: null,
    flowRateLps: 10,
    hasCanopy
  } as PumpEntity;
}

/** Duran araç: konumu grid'de, gövdesi VehicleMesh'in kendisi. */
export function welcomeCar(
  id: string,
  archetype: string,
  at: [number, number],
  heading: number
): VehicleEntity {
  return {
    id,
    archetype,
    fuelType: 'gasoline',
    tankCapacity: 60,
    currentFuel: 30,
    request: {
      mode: 'FULL',
      targetValue: 30,
      calculatedLiters: 30,
      calculatedPrice: 0,
      dispensedLiters: 0,
      isFinished: false
    },
    patience: 60,
    maxPatience: 60,
    satisfaction: 100,
    // QUEUE: VehicleMesh bu durumda litre balonu asmaz — balonlar belgenin
    // üstüne taşıyordu.
    state: 'QUEUE',
    targetPumpId: null,
    assignedActor: null,
    worldPosition: [at[0], 0, at[1]],
    targetWaypoint: null,
    route: [],
    heading,
    speed: 1,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  } as unknown as VehicleEntity;
}

/** Oyunun açılış arsası: yola yaslı 2x2 parsel, 16x14, betonu dökülmüş. */
export const WELCOME_PLOT: GameState['station']['plots'] = {
  width: stationBounds(STARTING_PARCELS).width,
  height: stationBounds(STARTING_PARCELS).height,
  ownedParcels: [...STARTING_PARCELS],
  pavedParcels: [...STARTING_PARCELS]
};

export const WELCOME_ROAD_LEVEL = 1;

/**
 * Pompalar: ikisi de yola dönük (90°), aralarında boşluk, SUNDURMASIZ —
 * kanopi arkadaki yapıları ve tabelalarını örtüyordu (Emre, 2026-09-03).
 * Ortadaki üçüncü pompa kaldırıldı; totem iki ada arasındaki boşluktan
 * görünür.
 */
export const WELCOME_PUMPS: PumpEntity[] = [
  welcomePump('wp_a', [5.5, 7], 90, ['gasoline', 'diesel'], false),
  welcomePump('wp_b', [11.5, 7], 90, ['gasoline', 'diesel', 'lpg'], false)
];

/**
 * Sokak lambaları: cephe boyunca 5 hücre arayla dört direk (0.5, 5.5, 10.5,
 * 15.5), hepsi z=1.5'te — beton çizgisiyle araç bandı arasındaki 1 hücrelik
 * lamba payında. 270° ile kol +z'ye, yani önalana uzanır; ağız koridorlarına
 * (x 1..5 ve 11..15) hiçbiri girmez.
 */
export const WELCOME_LAMPS: BuildingEntity[] = [0.5, 5.5, 10.5, 15.5].map((x, i) =>
  welcomeBuilding(`wb_lamp_${i}`, 'light_pole', [x, 1.5], 270)
);

/** Sahnede BuildingMesh ile çizilen yapılar (lambalar ayrı çizilir). */
export const WELCOME_STRUCTURES: BuildingEntity[] = [
  // Arka sıra, cepheleri z=9'da tek çizgide: tank | ofis | kafe | market.
  welcomeBuilding('wb_tank', 'tank_farm', [14.5, 10.5]),
  welcomeBuilding('wb_office', 'office', [10.5, 11.5], 0, 2),
  welcomeBuilding('wb_cafe', 'cafe', [6.5, 10.5], 0, 2),
  welcomeBuilding('wb_market', 'mini_market', [2.5, 11.5], 0, 2),

  // Sol kaldırım (yüksek x): çıkış koridorunun hemen ardında otopark,
  // 270° ile bay başları kaldırıma dönük; önünde çöp kutusu.
  welcomeBuilding('wb_park', 'car_park', [14.5, 6.5], 270),
  welcomeBuilding('wb_trash', 'trash_can', [15.5, 3.5]),

  // Sağ kaldırım (x=0): şarj direği kaldırıma sıfır, bay'i içe (+x) bakar;
  // arkasında hava-su, o da kaldırıma sıfır.
  welcomeBuilding('wb_charger', 'ev_charger_dc', [1, 5.5], 0),
  welcomeBuilding('wb_air', 'air_water', [0.5, 8], 0)
];

/**
 * Fiyat totemi zemin katmanı için yerleşimdedir (banket çiçeklikleri ona göre
 * ikiye ayrılır) ama BuildingMesh ile ÇİZİLMEZ: adı sabit "HIGHWAY" olacağı
 * için totemi sahne kendi çizer. Konumu oyunun kuralından: iki ağzın ortası.
 */
export const WELCOME_SIGN: BuildingEntity = {
  ...welcomeBuilding(
    'wb_sign',
    'price_sign',
    priceSignPosition({
      station: { plots: WELCOME_PLOT, roadLevel: WELCOME_ROAD_LEVEL },
      buildings: {}
    }),
    0,
    3
  ),
  movedByPlayer: false
};

/** Zemini çizen katmanların baktığı dünya: arsa, yol, yapılar, pompalar. */
export const WELCOME_GROUND = {
  plots: WELCOME_PLOT,
  roadLevel: WELCOME_ROAD_LEVEL,
  buildings: Object.fromEntries(
    [...WELCOME_STRUCTURES, ...WELCOME_LAMPS, WELCOME_SIGN].map((b) => [b.id, b])
  ) as Record<string, BuildingEntity>,
  pumps: Object.fromEntries(WELCOME_PUMPS.map((p) => [p.id, p])) as Record<string, PumpEntity>,
  weather: 'SUNNY' as const,
  cleanliness: 95
};

/**
 * Otoparkın bay merkezleri: 10 dünya birimlik kenar 4 baya bölünür (2.5'er),
 * 270° dönmüş otoparkta baylar z boyunca dizilir.
 */
const PARK_BAYS_Z = [-1.875, -0.625, 0.625, 1.875].map((dz) => 6.5 + dz);

export const WELCOME_CARS: VehicleEntity[] = [
  // İki pompada da müşteri: gece bile işleyen bir istasyon.
  welcomeCar('wc_pump_a', 'sedan', [5.5, 5.6], Math.PI / 2),
  welcomeCar('wc_pump_b', 'suv', [11.5, 5.6], Math.PI / 2),
  // Şarjda bekleyen elektrikli: direğin bay'inde (x = 1 + 1.4), z boyunca.
  welcomeCar('wc_ev', 'ev', [2.4, 5.5], 0),
  // Otoparkta iki araç, baylara oturmuş, burunları kaldırıma dönük.
  welcomeCar('wc_park_1', 'hatchback', [14.5, PARK_BAYS_Z[1]], Math.PI / 2),
  welcomeCar('wc_park_2', 'sedan', [14.5, PARK_BAYS_Z[3]], Math.PI / 2)
];

/**
 * Lamba kolunun dünya doğrultusu. LightPole'un kolu yerel +x'e uzanır;
 * BuildingMesh yapıyı +y ekseninde `rotation` derece döndürür.
 */
export function lampArmDirection(rotation: number): [number, number] {
  const theta = (rotation * Math.PI) / 180;
  // `|| 0` düzeltmesi: Math.round(-0.0…) eksi sıfır verir, [0, 1] ile eşleşmez.
  return [Math.round(Math.cos(theta)) || 0, Math.round(-Math.sin(theta)) || 0];
}

/**
 * Belgenin sol kenarı, ekran genişliğinin oranı olarak. WelcomeGate'teki
 * sınıflarla birebir: lg (>=1024px) ekranda belge `max-w-sm` (384px) ve
 * `lg:pr-[7%]` ile sağa yaslıdır; daha dar ekranda ortadadır ve sahne yalnız
 * fondur (belge onun üstüne biner). Kamera, istasyonu bu kenarın soluna
 * sığdırır — hangi ekran oranında olursa olsun giriş rampası belgenin
 * altında kalmaz (Emre, 2026-09-03: "giriş rampası hiç gözükmüyor").
 */
export const CARD_MAX_WIDTH_PX = 384;
export const CARD_RIGHT_MARGIN = 0.07;
export const CARD_SIDE_BREAKPOINT_PX = 1024;

export function cardLeftFraction(viewportWidthPx: number): number | null {
  if (viewportWidthPx < CARD_SIDE_BREAKPOINT_PX) return null;
  return 1 - CARD_RIGHT_MARGIN - CARD_MAX_WIDTH_PX / viewportWidthPx;
}

/**
 * İstasyonun ekranda kaplayacağı yatay bant, [sol, sağ] oran olarak.
 * Belge yandaysa: %5'ten belgenin 3 puan soluna. Belge ortadaysa: sahne fon,
 * arsa ekranı biraz taşarak doldurur.
 */
export function stationScreenBand(viewportWidthPx: number): [number, number] {
  const cardLeft = cardLeftFraction(viewportWidthPx);
  if (cardLeft === null) return [-0.08, 1.08];
  return [0.05, cardLeft - 0.03];
}
