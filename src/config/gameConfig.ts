import { MissionMetric } from '../domain/types/gameState';

/**
 * Project Highway - Master Versioned Game Configuration (v1.0.0)
 * Sourced directly from Master GDD (Bölüm 10, 11, 15, 16, 18, 19, 20, 21, 22, Ek A, Ek B)
 */

export interface FuelConfig {
  id: 'gasoline' | 'diesel' | 'lpg';
  name: string;
  shortName: string;
  color: string;
  baseWholesale: number; // TL/L
  regionalRetail: number; // TL/L
  targetMargin: number; // TL/L
  avgFillLiters: number; // L
  orderMinLiters: number; // 500 L
  orderStepLiters: number; // 100 L
  deliveryFee: number; // 450 TL
  dailyVolatility: number; // 0.03
  unlockLevel: number;
}

export interface BuildingCatalogItem {
  type: string;
  name: string;
  category: 'pump' | 'tank' | 'structure' | 'service' | 'energy';
  price: number;
  dailyUpkeep: number;
  size: [number, number]; // Grid cells (width, depth)
  unlockLevel: number;
  description: string;
  icon?: string;
  isUnderground?: boolean;
  /** Comes with the station and cannot be bought, moved or sold. */
  fixed?: boolean;
}

export interface BuildingUpgradeConfig {
  type: string;
  level: number;
  cost: number;
  effectsDescription: string;
  flowRateLps?: number; // Litres per second for pumps
  capacityLiters?: number; // For tanks
  bonusCleanliness?: number;
  bonusSpeed?: number;
}

export interface CustomerTypeConfig {
  type: 'commuter' | 'family' | 'taxi' | 'courier' | 'commercial' | 'truck' | 'luxury' | 'ev';
  name: string;
  vehicleModel: string;
  minDemand: number;
  maxDemand: number;
  basePatienceSeconds: number;
  priceSensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
  preferredFuel: 'gasoline' | 'diesel' | 'lpg' | 'any';
  marketBaseProbability: number;
  marketAvgBasket: number;
  tipChanceModifier: number;
  specialBehavior: string;
  /** Needs a charging unit rather than a fuel pump. */
  requiresCharger?: boolean;
}

export interface EmployeeConfig {
  role: 'PUMP_ATTENDANT' | 'MANAGER';
  tierLevels: Array<{
    level: number;
    hireCost: number;
    dailyWage: number;
    speedMultiplier: number;
    actionDelaySeconds: number;
    maxConcurrentPumps: number;
    unlockRequirement: string;
    requiredServices?: number;
  }>;
}

export interface LoanProductConfig {
  id: string;
  name: string;
  principal: number;
  totalCostRatio: number; // %10 -> 0.10
  termDays: number;
  dailyPayment: number;
  minLevel: number;
  minReputation: number;
  requiredExpansion?: 'A' | 'B';
}

export interface LevelThresholdConfig {
  level: number;
  requiredTotalXp: number;
  rewardCash: number;
  unlockedFeatures: string;
}

export interface GameConfig {
  version: '1.0.0';
  fuels: Record<'gasoline' | 'diesel' | 'lpg', FuelConfig>;
  buildings: Record<string, BuildingCatalogItem>;
  buildingEffects: Record<
    string,
    {
      appeal?: number;
      patience?: number;
      satisfaction?: number;
      service?: { chance: number; avgSpend: number };
    }
  >;
  buildingUpgrades: Record<string, Record<number, BuildingUpgradeConfig>>;
  customerTypes: Record<string, CustomerTypeConfig>;
  employees: {
    pumpAttendant: EmployeeConfig;
    manager: {
      minLevel: number;
      minOfficeLevel: number;
      minReputation: number;
      minActiveAttendants: number;
      minProfitableDaysInLast3: number;
      hireCost: number;
      dailyWage: number;
      defaultKasaReserve: number;
    };
  };
  loans: LoanProductConfig[];
  levels: LevelThresholdConfig[];
  economy: {
    initialCash: number;
    initialReputation: number;
    dayStartHour: number; // 06:00
    dayEndHour: number; // 30 = 06:00 the next morning
    realSecondsPerGameHour: number;
    minRepairCost: number;
    siteCleanCost: number;
    cleanDurationSeconds: number;
    refundRatio: number; // 0.55
    moveFeeRatio: number; // 0.02
    tankerSpeedSecondsMin: number;
    tankerSpeedSecondsMax: number;
    tankerUnloadSpeedLps: number;
    tankerCancelRefundRatio: number;
    overdraftLimit: number; // -5000 TL
    defaultAutonomyBudgetReserve: number; // 8000 TL
  };
  /** What it takes to turn the single lane into a dual carriageway. */
  ev: {
    acPricePerKwh: number;
    dcPricePerKwh: number;
    acChargeSeconds: number;
    dcChargeSeconds: number;
  };
  roadUpgrade: {
    price: number;
    minLevel: number;
    minReputation: number;
  };
  grid: {
    initialWidth: number;
    initialHeight: number;
    /** Expansion A widens the plot along the road. */
    expansionAWidth: number;
    /** Expansion B pushes the back boundary away from the road. */
    expansionBDepth: number;
    cellSizeMeters: number; // 2.0
  };
  tutorialTasks: Array<{
    id: string;
    description: string;
    metric: MissionMetric;
    target: number;
    rewardCash: number;
    rewardXp: number;
  }>;
}

/**
 * The upgrade table key for a structure type.
 *
 * Tanks are one entry per fuel in the catalogue but share one upgrade ladder,
 * and looking the ladder up under the concrete type is how tank upgrades were
 * unreachable for as long as they existed.
 */
export function upgradePathFor(type: string): string {
  return type.startsWith('tank_') ? 'tank' : type;
}

/** What one tank package holds at each level, in litres. */
export const TANK_PACKAGE_LITERS: Record<number, number> = { 1: 1500, 2: 3000, 3: 6000 };

export const GAME_CONFIG: GameConfig = {
  version: '1.0.0',
  fuels: {
    gasoline: {
      id: 'gasoline',
      name: 'Kurşunsuz Benzin 95',
      shortName: 'Benzin',
      color: '#22c55e',
      baseWholesale: 36.40,
      regionalRetail: 44.90,
      targetMargin: 8.50,
      avgFillLiters: 24,
      orderMinLiters: 500,
      orderStepLiters: 100,
      deliveryFee: 450,
      dailyVolatility: 0.03,
      unlockLevel: 1,
    },
    diesel: {
      id: 'diesel',
      name: 'Ultra EuroDizel',
      shortName: 'Dizel',
      color: '#f97316',
      baseWholesale: 35.60,
      regionalRetail: 43.50,
      targetMargin: 7.90,
      avgFillLiters: 31,
      orderMinLiters: 500,
      orderStepLiters: 100,
      deliveryFee: 450,
      dailyVolatility: 0.03,
      unlockLevel: 2,
    },
    lpg: {
      id: 'lpg',
      name: 'Otogaz LPG',
      shortName: 'LPG',
      color: '#3b82f6',
      baseWholesale: 18.30,
      regionalRetail: 24.90,
      targetMargin: 6.60,
      avgFillLiters: 22,
      orderMinLiters: 500,
      orderStepLiters: 100,
      deliveryFee: 450,
      dailyVolatility: 0.03,
      unlockLevel: 4,
    }
  },
  buildings: {
    pump_standard: {
      type: 'pump_standard',
      name: 'Standart Akaryakıt Pompası',
      category: 'pump',
      price: 18000,
      dailyUpkeep: 110,
      size: [2, 3],
      unlockLevel: 1,
      description: '1 araç kapasiteli, 8 L/sn dolum hızında akaryakıt pompası.',
      icon: 'Fuel'
    },
    tank_gasoline: {
      type: 'tank_gasoline',
      name: 'Benzin Tank Paketi',
      category: 'tank',
      price: 11000,
      dailyUpkeep: 80,
      size: [3, 3],
      unlockLevel: 1,
      description: 'Benzin depolama kapasitesine 1.500 L ekler.',
      isUnderground: true,
      icon: 'Database'
    },
    tank_diesel: {
      type: 'tank_diesel',
      name: 'Dizel Tank Paketi',
      category: 'tank',
      price: 12000,
      dailyUpkeep: 80,
      size: [3, 3],
      unlockLevel: 2,
      description: '1.500 L dizel yakıt depolama kapasitesi ekler.',
      isUnderground: true,
      icon: 'Database'
    },
    tank_lpg: {
      type: 'tank_lpg',
      name: 'LPG Tank Paketi',
      category: 'tank',
      price: 16000,
      dailyUpkeep: 90,
      size: [3, 3],
      unlockLevel: 4,
      description: '1.500 L LPG otogaz depolama kapasitesi ekler.',
      isUnderground: true,
      icon: 'Flame'
    },
    price_sign: {
      /**
       * Station infrastructure rather than a purchase: every forecourt has one,
       * it stands where the layout says it stands — between the two mouths,
       * facing the road — and the player upgrades it in place rather than
       * choosing where to put it.
       */
      fixed: true,
      type: 'price_sign',
      name: 'Fiyat Totem Tabelası',
      category: 'structure',
      price: 4000,
      dailyUpkeep: 20,
      size: [1, 1],
      unlockLevel: 1,
      description: 'Ana yol sürücülerine güncel yakıt fiyatlarını gösterir.',
      icon: 'Tag'
    },
    pylon_sign: {
      type: 'pylon_sign',
      name: 'Reklam Kulesi',
      category: 'structure',
      price: 60000,
      dailyUpkeep: 260,
      size: [2, 2],
      unlockLevel: 5,
      description:
        'Yol boyunca kilometrelerce öteden görünen yüksek kule; istasyon adını ve açık/kapalı durumunu duyurur. Arsanın 2 birim dışına kadar kurulabilir.',
      icon: 'Megaphone'
    },
    canopy: {
      type: 'canopy',
      name: 'Ada Sundurması (Canopy)',
      category: 'structure',
      price: 9000,
      dailyUpkeep: 50,
      size: [3, 5],
      unlockLevel: 5,
      description: 'Altındaki pompalarda +%5 dolum hızı ve temizlik koruması sağlar.',
      icon: 'Umbrella'
    },
    office: {
      type: 'office',
      name: 'Yönetim Ofisi',
      category: 'structure',
      price: 18000,
      dailyUpkeep: 120,
      size: [5, 5],
      unlockLevel: 5,
      description: 'Gelişmiş finansal raporlama ve istasyon müdürü çalışma alanı.',
      icon: 'Building2'
    },
    mini_market: {
      type: 'mini_market',
      name: 'Mini Market',
      category: 'service',
      price: 28000,
      dailyUpkeep: 180,
      size: [5, 5],
      unlockLevel: 6,
      description: 'Yakıt alan müşterilere sepet satışı yaparak yan gelir üretir.',
      icon: 'ShoppingBag'
    },
    toilet: {
      type: 'toilet',
      name: 'Müşteri WC / Lavabo',
      category: 'service',
      price: 8000,
      dailyUpkeep: 100,
      size: [2, 2],
      unlockLevel: 6,
      description: 'Aile ve uzun yol müşterilerinin memnuniyetini +%8 artırır.',
      icon: 'Bath'
    },
    light_pole: {
      type: 'light_pole',
      name: 'Aydınlatma Direği',
      category: 'structure',
      price: 1500,
      dailyUpkeep: 25,
      size: [1, 1],
      unlockLevel: 3,
      description: 'Gece saatlerinde istasyon görüşünü ve güvenlik hissini artırır.',
      icon: 'Lightbulb'
    },
    trash_can: {
      type: 'trash_can',
      name: 'Çöp Kutusu',
      category: 'structure',
      price: 600,
      dailyUpkeep: 0,
      size: [1, 1],
      unlockLevel: 2,
      description: 'Çevredeki kirlenme hızını %30 azaltır.',
      icon: 'Trash2'
    },
    air_water: {
      type: 'air_water',
      name: 'Hava & Su Ünitesi',
      category: 'service',
      price: 6000,
      dailyUpkeep: 40,
      size: [1, 2],
      unlockLevel: 3,
      description: 'Lastik havası ve su ikmali; kısa duraklamalarda memnuniyeti artırır.',
      icon: 'Wind'
    },
    car_park: {
      type: 'car_park',
      name: 'Otopark (4 Araçlık)',
      category: 'service',
      price: 9000,
      dailyUpkeep: 30,
      size: [5, 3],
      unlockLevel: 4,
      description: 'Dört araçlık park alanı. Birden fazla alan kurarak kapasiteyi artırabilirsiniz.',
      icon: 'SquareParking'
    },
    truck_park: {
      type: 'truck_park',
      name: 'TIR Parkı (3 Araçlık)',
      category: 'service',
      price: 20000,
      dailyUpkeep: 60,
      size: [6, 4],
      unlockLevel: 7,
      description: 'Üç ağır vasıta kapasiteli park alanı. Uzun yol şoförlerini istasyona çeker.',
      icon: 'Truck'
    },
    car_wash: {
      type: 'car_wash',
      name: 'Oto Yıkama',
      category: 'service',
      price: 32000,
      dailyUpkeep: 200,
      size: [2, 3],
      unlockLevel: 6,
      description: 'Tünel tipi otomatik yıkama hattı.',
      icon: 'Droplets'
    },
    oil_change: {
      type: 'oil_change',
      name: 'Yağ Değişim İstasyonu',
      category: 'service',
      price: 26000,
      dailyUpkeep: 160,
      size: [3, 3],
      unlockLevel: 6,
      description: 'Çift kanallı yağ ve filtre değişim servisi.',
      icon: 'Wrench'
    },
    tyre_service: {
      type: 'tyre_service',
      name: 'Lastik Servisi',
      category: 'service',
      price: 24000,
      dailyUpkeep: 150,
      size: [3, 3],
      unlockLevel: 5,
      description: 'Lastik değişimi, balans ve rot ayarı yapılan servis birimi.',
      icon: 'CircleDot'
    },
    cafe: {
      type: 'cafe',
      name: 'Kahveci',
      category: 'service',
      price: 22000,
      dailyUpkeep: 140,
      size: [3, 3],
      unlockLevel: 5,
      description: 'Yol kahvesi ve atıştırmalık satan küçük büfe.',
      icon: 'Coffee'
    },
    restaurant: {
      type: 'restaurant',
      name: 'Restoran',
      category: 'service',
      price: 45000,
      dailyUpkeep: 320,
      size: [6, 6],
      unlockLevel: 8,
      description: 'Oturmalı yol restoranı; uzun yol yolcularını uzun süre tutar.',
      icon: 'UtensilsCrossed'
    },
    rest_complex: {
      type: 'rest_complex',
      name: 'Dinlenme Tesisi',
      category: 'service',
      price: 150000,
      dailyUpkeep: 900,
      size: [12, 6],
      unlockLevel: 10,
      description: 'Market, restoran, kahveci ve WC birimlerini tek çatı altında toplayan büyük tesis.',
      icon: 'Building'
    },
    decoration: {
      type: 'decoration',
      name: 'Peyzaj & Dekorasyon',
      category: 'structure',
      price: 5000,
      dailyUpkeep: 20,
      size: [2, 2],
      unlockLevel: 3,
      description: 'Yeşil alan, saksı ve bank düzenlemesi; sahanın görünümünü iyileştirir.',
      icon: 'Trees'
    },
    wide_entry: {
      type: 'wide_entry',
      name: 'Geniş Giriş Rampası',
      category: 'structure',
      price: 18000,
      dailyUpkeep: 30,
      // Twice the width of a default mouth — two full lanes, not one lane
      // with a broader apron — and two grid rows deep: exactly the verge it
      // bridges, plus enough overlap that both ends read as joined.
      size: [6, 2],
      unlockLevel: 6,
      description: 'Çift şeritli giriş rampası; araçlar kuyruk oluşturmadan ikişerli girer.',
      icon: 'ArrowRight'
    },
    wide_exit: {
      type: 'wide_exit',
      name: 'Geniş Çıkış Rampası',
      category: 'structure',
      price: 18000,
      dailyUpkeep: 30,
      size: [6, 2],
      unlockLevel: 6,
      description: 'Çift şeritli çıkış rampası; ayrılan araçlar birbirini beklemez.',
      icon: 'ArrowLeft'
    },
    hotel: {
      type: 'hotel',
      name: 'Yol Oteli',
      category: 'service',
      price: 95000,
      dailyUpkeep: 600,
      size: [6, 7],
      unlockLevel: 9,
      description: 'Uzun yol yolcuları için konaklama; geceleyen müşteri akışı yaratır.',
      icon: 'BedDouble'
    },
    ev_substation: {
      type: 'ev_substation',
      name: 'Elektrik Altyapısı',
      category: 'energy',
      price: 40000,
      dailyUpkeep: 250,
      size: [2, 2],
      unlockLevel: 7,
      description: 'Trafo ve dağıtım panosu. Şarj ünitesi kurabilmenin ön koşuludur.',
      icon: 'Zap'
    },
    ev_storage: {
      type: 'ev_storage',
      name: 'Enerji Depolama',
      category: 'energy',
      price: 35000,
      dailyUpkeep: 180,
      size: [3, 3],
      unlockLevel: 8,
      description: 'Batarya bankası; yoğun saatlerde şarj kapasitesini destekler.',
      icon: 'BatteryCharging'
    },
    ev_charger_ac: {
      type: 'ev_charger_ac',
      name: 'AC Şarj Ünitesi',
      category: 'energy',
      price: 18000,
      dailyUpkeep: 90,
      size: [2, 3],
      unlockLevel: 7,
      description: 'Yavaş şarj ünitesi. Altyapı kapasitesinden pay tüketir.',
      icon: 'Plug'
    },
    ev_charger_dc: {
      type: 'ev_charger_dc',
      name: 'DC Hızlı Şarj',
      category: 'energy',
      price: 45000,
      dailyUpkeep: 220,
      size: [2, 3],
      unlockLevel: 9,
      description: 'Yüksek güçlü hızlı şarj ünitesi. Altyapıdan yüksek pay tüketir.',
      icon: 'Zap'
    },
  },
  /**
   * What each facility actually does for the station.
   *
   * Every building in the catalogue used to charge a price and a daily upkeep
   * and then do nothing at all — the simulation only ever looked at three of
   * them. Rather than scatter a special case per type through the engine, the
   * effects live here as data and the engine reads the table:
   *
   *  - `appeal`      raises the share of passing traffic that turns in
   *  - `patience`    buys the driver more time before they give up
   *  - `satisfaction` lifts the service score, and with it reputation and tips
   *  - `service`     a side sale on the way out: how often, and how much
   *
   * A building only counts on the block it stands on, so the land across the
   * road has to earn its own custom.
   */
  buildingEffects: {
    toilet:       { appeal: 0.05, patience: 0.08, satisfaction: 3 },
    air_water:    { appeal: 0.03, satisfaction: 3, service: { chance: 0.14, avgSpend: 40 } },
    car_park:     { appeal: 0.04, patience: 0.10 },
    truck_park:   { appeal: 0.06, patience: 0.14 },
    decoration:   { appeal: 0.02, satisfaction: 4 },
    light_pole:   { appeal: 0.02, satisfaction: 1 },
    canopy:       { appeal: 0.04, satisfaction: 3 },
    price_sign:   { appeal: 0.06 },
    pylon_sign:   { appeal: 0.16 },
    office:       { satisfaction: 2 },
    mini_market:  { appeal: 0.06 },
    cafe:         { appeal: 0.07, satisfaction: 3, service: { chance: 0.26, avgSpend: 95 } },
    restaurant:   { appeal: 0.12, patience: 0.10, satisfaction: 5, service: { chance: 0.30, avgSpend: 240 } },
    car_wash:     { appeal: 0.10, satisfaction: 4, service: { chance: 0.20, avgSpend: 320 } },
    oil_change:   { appeal: 0.08, service: { chance: 0.12, avgSpend: 620 } },
    tyre_service: { appeal: 0.08, service: { chance: 0.10, avgSpend: 780 } },
    hotel:        { appeal: 0.14, satisfaction: 4, service: { chance: 0.08, avgSpend: 1650 } },
    rest_complex: { appeal: 0.26, patience: 0.20, satisfaction: 9, service: { chance: 0.45, avgSpend: 430 } }
  },

  buildingUpgrades: {
    pump_standard: {
      2: {
        type: 'pump_standard',
        level: 2,
        cost: 10000,
        flowRateLps: 10,
        bonusSpeed: 0.10,
        effectsDescription: '10 L/sn dolum hızı, -%10 servis gecikmesi, dijital sayaç ekranı.'
      },
      3: {
        type: 'pump_standard',
        level: 3,
        cost: 22000,
        flowRateLps: 13,
        bonusSpeed: 0.25,
        effectsDescription: '13 L/sn ultra hızlı dolum, arıza riski -%25, premium gövde tasarımı.'
      }
    },
    tank: {
      2: {
        type: 'tank',
        level: 2,
        cost: 20000,
        capacityLiters: 3000,
        effectsDescription: 'Depolama kapasitesini 3.000 L seviyesine çıkarır.'
      },
      3: {
        type: 'tank',
        level: 3,
        cost: 45000,
        capacityLiters: 6000,
        effectsDescription: 'Büyük Tank: Depolama kapasitesini 6.000 L seviyesine çıkarır.'
      }
    },
    office: {
      2: {
        type: 'office',
        level: 2,
        cost: 18000,
        effectsDescription: 'Gelişmiş günlük faaliyet raporu ve İstasyon Müdürü çalışma alanı.'
      },
      3: {
        type: 'office',
        level: 3,
        cost: 40000,
        effectsDescription: 'Modern kurumsal bina, personel eğitim merkezi altyapısı.'
      }
    },
    mini_market: {
      2: {
        type: 'mini_market',
        level: 2,
        cost: 22000,
        effectsDescription: 'Müşteri sepet tutarı +%20 artar, vitrin ve iç aydınlatma büyür.'
      },
      3: {
        type: 'mini_market',
        level: 3,
        cost: 50000,
        effectsDescription: 'Süpermarket raf düzeni, sepet harcama çarpanı +%45 artar.'
      }
    },
    price_sign: {
      2: {
        type: 'price_sign',
        level: 2,
        cost: 7000,
        effectsDescription: 'LED Dijital Fiyat Paneli; uzaktan talep çekiciliği +%5 artar.'
      },
      3: {
        type: 'price_sign',
        level: 3,
        cost: 15000,
        effectsDescription: 'Büyük Dijital Pylon; promosyon ışıklandırması ve yüksek görünürlük.'
      }
    }
  },
  customerTypes: {
    commuter: {
      type: 'commuter',
      name: 'İşe Giden',
      vehicleModel: 'sedan_standard',
      minDemand: 18,
      maxDemand: 35,
      basePatienceSeconds: 36,
      priceSensitivity: 'MEDIUM',
      preferredFuel: 'gasoline',
      marketBaseProbability: 0.18,
      marketAvgBasket: 110,
      tipChanceModifier: 1.0,
      specialBehavior: 'Hızlı hizmet bekler.'
    },
    family: {
      type: 'family',
      name: 'Aile',
      vehicleModel: 'suv_standard',
      minDemand: 25,
      maxDemand: 50,
      basePatienceSeconds: 48,
      priceSensitivity: 'MEDIUM',
      preferredFuel: 'gasoline',
      marketBaseProbability: 0.42,
      marketAvgBasket: 180,
      tipChanceModifier: 1.0,
      specialBehavior: 'Markete ve tuvalete girme olasılığı yüksektir.'
    },
    taxi: {
      type: 'taxi',
      name: 'Taksi',
      vehicleModel: 'sedan_taxi',
      minDemand: 15,
      maxDemand: 40,
      basePatienceSeconds: 26,
      priceSensitivity: 'HIGH',
      preferredFuel: 'lpg',
      marketBaseProbability: 0.10,
      marketAvgBasket: 90,
      tipChanceModifier: 0.8,
      specialBehavior: 'Kısa kuyruk arar, sabırsızdır.'
    },
    courier: {
      type: 'courier',
      name: 'Kurye / Motosiklet',
      vehicleModel: 'courier_van',
      minDemand: 8,
      maxDemand: 28,
      basePatienceSeconds: 22,
      priceSensitivity: 'HIGH',
      preferredFuel: 'gasoline',
      marketBaseProbability: 0.08,
      marketAvgBasket: 80,
      tipChanceModifier: 1.2,
      specialBehavior: 'Hızlı hizmette ekstra hız bonusu bahşişi bırakır.'
    },
    commercial: {
      type: 'commercial',
      name: 'Ticari Van / Minibüs',
      vehicleModel: 'van_cargo',
      minDemand: 35,
      maxDemand: 75,
      basePatienceSeconds: 44,
      priceSensitivity: 'LOW',
      preferredFuel: 'diesel',
      marketBaseProbability: 0.22,
      marketAvgBasket: 150,
      tipChanceModifier: 1.0,
      specialBehavior: 'Dizel ağırlıklıdır, yüksek hacimli yakıt alır.'
    },
    truck: {
      type: 'truck',
      name: 'Ağır Kamyon',
      vehicleModel: 'truck_heavy',
      minDemand: 80,
      maxDemand: 180,
      basePatienceSeconds: 60,
      priceSensitivity: 'LOW',
      preferredFuel: 'diesel',
      marketBaseProbability: 0.35,
      marketAvgBasket: 200,
      tipChanceModifier: 1.1,
      specialBehavior: 'Büyük dolum yapar, sabrı uzundur.'
    },
    ev: {
      type: 'ev',
      name: 'Elektrikli Araç',
      vehicleModel: 'hatchback_ev',
      minDemand: 20,
      maxDemand: 55,
      basePatienceSeconds: 52,
      priceSensitivity: 'MEDIUM',
      preferredFuel: 'any',
      marketBaseProbability: 0.38,
      marketAvgBasket: 190,
      tipChanceModifier: 1.3,
      specialBehavior: 'Şarj süresi uzundur; beklerken tesisleri kullanır.',
      requiresCharger: true
    },
    luxury: {
      type: 'luxury',
      name: 'Lüks / Spor',
      vehicleModel: 'sport_luxury',
      minDemand: 30,
      maxDemand: 60,
      basePatienceSeconds: 30,
      priceSensitivity: 'LOW',
      preferredFuel: 'gasoline',
      marketBaseProbability: 0.25,
      marketAvgBasket: 220,
      tipChanceModifier: 2.2,
      specialBehavior: 'Temiz sahada ve yüksek puanda yüklü bahşiş verir.'
    }
  },
  employees: {
    pumpAttendant: {
      role: 'PUMP_ATTENDANT',
      tierLevels: [
        {
          level: 1,
          hireCost: 7500,
          dailyWage: 650,
          speedMultiplier: 0.75,
          actionDelaySeconds: 2.0,
          maxConcurrentPumps: 1,
          unlockRequirement: 'Seviye 3'
        },
        {
          level: 2,
          hireCost: 4000,
          dailyWage: 800,
          speedMultiplier: 0.90,
          actionDelaySeconds: 1.2,
          maxConcurrentPumps: 1,
          unlockRequirement: '40 Hizmet Tamamla',
          requiredServices: 40
        },
        {
          level: 3,
          hireCost: 9000,
          dailyWage: 1050,
          speedMultiplier: 1.10,
          actionDelaySeconds: 0.6,
          maxConcurrentPumps: 2,
          unlockRequirement: '160 Hizmet Tamamla',
          requiredServices: 160
        }
      ]
    },
    manager: {
      minLevel: 10,
      minOfficeLevel: 2,
      minReputation: 4.00,
      minActiveAttendants: 2,
      minProfitableDaysInLast3: 2,
      hireCost: 45000,
      dailyWage: 2800,
      defaultKasaReserve: 8000
    }
  },
  loans: [
    {
      id: 'loan_micro',
      name: 'İşletme Sermayesi Kredisi',
      principal: 10000,
      totalCostRatio: 0.10,
      termDays: 5,
      dailyPayment: 2200,
      minLevel: 5,
      minReputation: 3.00
    },
    {
      id: 'loan_growth',
      name: 'Büyüme & Yatırım Kredisi',
      principal: 35000,
      totalCostRatio: 0.14,
      termDays: 10,
      dailyPayment: 3990,
      minLevel: 5,
      minReputation: 3.50
    },
    {
      id: 'loan_expansion',
      name: 'Arsa & Genişleme Kredisi',
      principal: 90000,
      totalCostRatio: 0.18,
      termDays: 18,
      dailyPayment: 5900,
      minLevel: 6,
      minReputation: 4.00,
      requiredExpansion: 'A'
    },
    {
      id: 'loan_corporate',
      name: 'Kurumsal Ölçeklendirme Kredisi',
      principal: 200000,
      totalCostRatio: 0.25,
      termDays: 30,
      dailyPayment: 8333,
      minLevel: 10,
      minReputation: 4.50
    }
  ],
  levels: [
    { level: 1, requiredTotalXp: 0, rewardCash: 0, unlockedFeatures: 'Benzin, Manuel Dolum, Tanker Siparişi' },
    { level: 2, requiredTotalXp: 300, rewardCash: 1500, unlockedFeatures: 'Dizel Tank Paketi, Çöp Kutusu' },
    { level: 3, requiredTotalXp: 800, rewardCash: 0, unlockedFeatures: 'Pompacı İşe Alma, Pompa S2 Yükseltmesi, Aydınlatma Direği' },
    { level: 4, requiredTotalXp: 1600, rewardCash: 2500, unlockedFeatures: 'LPG Tank Paketi, Orta Boy Tank (3.000 L)' },
    { level: 5, requiredTotalXp: 2800, rewardCash: 0, unlockedFeatures: 'Banka Kredileri, Yapı Bakımı & Tamir, Ofis S2' },
    { level: 6, requiredTotalXp: 4500, rewardCash: 3000, unlockedFeatures: 'Mini Market, Tuvalet, Oto Yıkama' },
    { level: 7, requiredTotalXp: 6500, rewardCash: 0, unlockedFeatures: 'Ada Sundurması (Canopy), Dijital LED Tabela' },
    { level: 8, requiredTotalXp: 9000, rewardCash: 0, unlockedFeatures: 'Büyük Tank (6.000 L), Pompa S3 Yükseltmesi' },
    { level: 9, requiredTotalXp: 12000, rewardCash: 5000, unlockedFeatures: 'Yeni Arsa Parselleri, 3. Pompacı Yuvası' },
    { level: 10, requiredTotalXp: 15500, rewardCash: 0, unlockedFeatures: 'İstasyon Müdürü Otomasyonu, V1 Final Hedefi' }
  ],
  economy: {
    initialCash: 15000,
    initialReputation: 3.00,
    /**
     * A day runs from six in the morning round to six the next morning, so
     * the night is played rather than skipped. `gameTime` counts on past 24
     * rather than wrapping — every hour-of-day rule reads it through
     * `hourOfDay`, and a clock that never goes backwards is far easier to
     * reason about than one that does.
     */
    dayStartHour: 6,
    dayEndHour: 30,
    /** Ten seconds at the wall is an hour on the forecourt. */
    realSecondsPerGameHour: 10,
    minRepairCost: 250,
    siteCleanCost: 300,
    cleanDurationSeconds: 12,
    /**
     * What selling a structure hands back. Deliberately well under half: a
     * misplaced building should cost the player something, so that the plot
     * they end up with is one they had to think about.
     */
    refundRatio: 0.4,
    moveFeeRatio: 0.02,
    tankerSpeedSecondsMin: 36,
    tankerSpeedSecondsMax: 60,
    tankerUnloadSpeedLps: 100,
    tankerCancelRefundRatio: 0.85,
    overdraftLimit: -5000,
    defaultAutonomyBudgetReserve: 8000
  },
  /**
   * Charging tariffs, in TL per kWh. Fixed for now: electricity is not yet a
   * stocked commodity like the liquid fuels, so there is nothing for the
   * player to price against.
   */
  ev: {
    acPricePerKwh: 7.5,
    dcPricePerKwh: 12.9,
    /** How long a charge takes at each kind of point, in game seconds. */
    acChargeSeconds: 28,
    dcChargeSeconds: 10
  },
  roadUpgrade: {
    price: 250000,
    minLevel: 8,
    minReputation: 4.0
  },
  grid: {
    initialWidth: 16,
    initialHeight: 14,
    expansionAWidth: 8,
    expansionBDepth: 8,
    cellSizeMeters: 2.0
  },
  tutorialTasks: [
    { id: 'T1', description: 'İlk gelen araca benzin doldur ve ödemeyi al', metric: 'CUSTOMERS_SERVED', target: 1, rewardCash: 500, rewardXp: 50 },
    { id: 'T2', description: '3 müşteriye eksiksiz hizmet vererek istasyonu işlet', metric: 'CUSTOMERS_SERVED', target: 3, rewardCash: 500, rewardXp: 50 },
    { id: 'T3', description: 'Tedarik panelinden 500 L benzin tankeri siparişi ver', metric: 'ORDERS_PLACED', target: 1, rewardCash: 450, rewardXp: 75 },
    { id: 'T4', description: 'Fiyatlandırma paneline girerek satış fiyatını ayarla', metric: 'PRICE_SET', target: 1, rewardCash: 500, rewardXp: 50 },
    { id: 'T5', description: 'İnşaat modunda bir yapıyı taşı veya yeni bir tabela yerleştir', metric: 'BUILD_PLACED', target: 1, rewardCash: 0, rewardXp: 50 },
    { id: 'T6', description: 'Günü tamamla ve Gün Sonu Faaliyet Raporunu incele', metric: 'DAYS_COMPLETED', target: 1, rewardCash: 1000, rewardXp: 100 }
  ]
};
