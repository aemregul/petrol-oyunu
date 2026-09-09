import { MissionMetric, VehicleArchetype, VehicleModelVariant } from '../domain/types/gameState';

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

export type SupplierType = 'toptan_depo' | 'standart' | 'hizli_lojistik';

export interface SupplierConfig {
  id: SupplierType;
  name: string;
  /** Label altı küçük etiket: "%−8 · yavaş" gibi. */
  tag: string;
  /** Piyasa fiyatı çarpanı: 0.92 = %8 indirim, 1.07 = %7 zam. */
  priceMultiplier: number;
  /** Teslimat süresi çarpanı: 0.5 = yarı sürede, 2.2 = çok yavaş. */
  speedMultiplier: number;
  /** Seçiliyken gösterilen dinamik açıklama satırı. */
  description: string;
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
  /**
   * Fitted to an existing structure instead of being placed on the ground.
   * The catalogue still lists it and still names the price; what changes is
   * that picking it asks the player which pump it goes on.
   */
  attachTo?: 'pump';
}

/**
 * How many of a thing the station may have, and how the price climbs as it
 * gets them (Emre, 2026-09-08). A cap per block is for what every block
 * needs one of — a shop, a toilet; a cap in total is for what the station
 * needs one of wherever it stands — a tyre bay, a car wash, the complex.
 * No cap means the plot is the only limit. The price growth compounds per
 * unit already owned, so the fifth pump is dearer than the first.
 */
export interface BuildingRule {
  maxPerSide?: number;
  maxTotal?: number;
  /** Per-unit multiplier on the catalogue price; economy.priceGrowthPerUnit when absent. */
  priceGrowth?: number;
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

/** One price on a facility's tariff card, and what charging it does. */
export interface FacilityTariff {
  label: string;
  /** What one visit pays, in TL. */
  price: number;
  /** How the price sways demand: 1 is the base odds. */
  demand: number;
  /** How much of the facility's goodwill survives the price: 1 is all of it. */
  moral: number;
}

/**
 * A building people walk into and pay at.
 *
 * These earn on their own — coins into the building's till, not the station's
 * cash — and the player (or the manager) collects. What a visit is worth, how
 * long it takes, and whether a driver may leave the car at the pump to make
 * it are all data here rather than cases in the engine.
 */
export interface FacilityConfig {
  /** Base odds a driver on this block wants this facility. */
  visitChance: number;
  /** What a visit brings in before level and tariff, in TL. Zero when the tariff sets it. */
  avgSpend: number;
  /** Share of a sale that is stock or running cost, for the books. */
  costRatio: number;
  /** How long a visitor is inside, in game seconds. */
  visitSeconds: number;
  /** Income multiplier by level (index = level - 1). */
  levelIncome: number[];
  /** Demand multiplier by level (index = level - 1); absent reads as flat. */
  levelDemand?: number[];
  /** What a visit still earns when nobody can park, as a share of a real one. */
  virtualShare: number;
  /** May a driver leave the car standing at the pump to walk over? */
  walkFromPump: boolean;
  tariffs?: FacilityTariff[];
  defaultTariff?: number;
  /** Demand multiplier in the evening and at night — a hotel's hours. */
  nightBoost?: number;
  /** Rooms by level; a visitor is a guest and needs one free. */
  rooms?: number[];
  /** Words for the card over a car whose driver has gone in. */
  driverAway: string;
  /** What the panel says about the place. */
  blurb: string;
}

export interface CustomerTypeConfig {
  type: VehicleArchetype;
  name: string;
  vehicleModels: VehicleModelVariant[];
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
  /** Relative frequency among vehicles that continue along the highway. */
  roadTrafficWeight?: number;
  /** Relative frequency among drivers who actually turn into the station. */
  stationStopWeight?: number;
  /** Large and emergency vehicles do not all cruise at the same pace. */
  roadSpeedMultiplier?: number;
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

/**
 * What the manager takes on, one toggle each. The keys are the job
 * description; which of them a given manager actually does is decided by
 * their grade (ManagerTierConfig.duties) and the player's toggles together.
 */
export type ManagerDuty =
  | 'collectTills'
  | 'fuelOrder'
  | 'assignAttendants'
  | 'maintenance'
  | 'pricing'
  | 'nightGridFill'
  | 'cleanStation'
  | 'repair'
  | 'dealStock';

export interface ManagerTierConfig {
  level: number;
  /** What promotion to this grade costs. Zero for the grade hiring gives. */
  upgradeCost: number;
  dailyWage: number;
  /** The station must be held in this regard before the manager is promoted. */
  minReputation: number;
  /** Sim seconds between the manager's rounds. */
  tourSeconds: number;
  /** Everything this grade can do — cumulative, so a list per grade is complete. */
  duties: ManagerDuty[];
  /** Tank levels the manager can be told to reorder at, in percent. */
  orderThresholds: number[];
  /** Whether the manager may be told to fill the tank right up rather than to the target. */
  canFillTank: boolean;
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
  buildingRules: Record<string, BuildingRule>;
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
  /** The buildings customers walk into, keyed by catalogue type. */
  facilities: Record<string, FacilityConfig>;
  customerTypes: Record<string, CustomerTypeConfig>;
  employees: {
    pumpAttendant: EmployeeConfig;
    manager: {
      minLevel: number;
      minReputation: number;
      minActiveAttendants: number;
      minProfitableDaysInLast3: number;
      hireCost: number;
      /** Level 1 pay; the tiers below carry their own. */
      dailyWage: number;
      defaultKasaReserve: number;
      tiers: ManagerTierConfig[];
    };
  };
  /**
   * Per-pump nozzle modules: access opens with player level, ownership is
   * bought with money, pump by pump. Petrol comes with the pump itself.
   */
  pumpFuelModules: Record<'diesel' | 'lpg', { cost: number; minLevel: number }>;
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
    /** What the next unit of a repeatable structure costs, over the last: 1.3 is +30% each. */
    priceGrowthPerUnit: number;
    tankerSpeedSecondsMin: number;
    tankerSpeedSecondsMax: number;
    tankerUnloadSpeedLps: number;
    tankerCancelRefundRatio: number;
    overdraftLimit: number; // -5000 TL
    defaultAutonomyBudgetReserve: number; // 8000 TL
  };
  suppliers: SupplierConfig[];
  /** What it takes to turn the single lane into a dual carriageway. */
  ev: {
    acPricePerKwh: number;
    dcPricePerKwh: number;
    acChargeSeconds: number;
    dcChargeSeconds: number;
    /** What a battery bank holds at each level, in kWh (index = level - 1). */
    storageKwhByLevel: number[];
    /** What a Sv.1 substation feeds into the banks, in kWh per game hour. */
    gridKwhPerHour: number;
    /** How much more each substation level pulls (index = level - 1). */
    gridLevelFactor: number[];
    /** What the grid charges by day, in TL per kWh — billed at day end. */
    gridPricePerKwh: number;
    /**
     * The contract's clock: cheap at night, dear at the evening peak. Hours
     * are inclusive of `from`, exclusive of `to`; a night window wraps
     * midnight.
     */
    gridTariff: {
      night: { from: number; to: number; price: number };
      peak: { from: number; to: number; price: number };
    };
    /** The manager's night-fill rule tops up anyway below this share. */
    nightFillFloorPercent: number;
    /**
     * Panels go on the roof the station already has — a pump's canopy — not
     * on a field of their own (Emre, 2026-09-07: sundurma dışında çatı yok).
     */
    solar: {
      unlockLevel: number;
      /** TL per footprint cell, so a bigger roof costs more. */
      pricePerCell: number;
      upkeepPerCell: number;
      /** What washing a roof of panels costs, per cell. */
      cleanCostPerCell: number;
      /** How fast the glass dirties, cleanliness points per sim second. */
      grimePerSecond: number;
      /** How fast rain rinses it, cleanliness points per sim second, before the grime is taken off. */
      rainWashPerSecond: number;
      /** kWh per game hour per cell under a clear noon sun. */
      peakKwhPerCell: number;
      sunrise: number;
      sunset: number;
      weather: Record<'SUNNY' | 'OVERCAST' | 'RAIN', number>;
      /** A filthy station's panels still give this share of their best. */
      minGrimeFactor: number;
    };
    /** Burns the station's own diesel when the bank runs low. */
    generator: {
      kwhPerHour: number;
      litersPerKwh: number;
      /** Kicks in when the block's banks fall below this share. */
      runBelowPercent: number;
      /** Never eats into the last share of the diesel tank. */
      reserveShare: number;
    };
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
  return type === 'tank_farm' ? 'tank' : type;
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
      baseWholesale: 70.70,
      regionalRetail: 76.90,
      targetMargin: 6.20,
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
      baseWholesale: 82.40,
      regionalRetail: 88.90,
      targetMargin: 6.50,
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
      baseWholesale: 32.00,
      regionalRetail: 35.00,
      targetMargin: 3.00,
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
      price: 39500,
      dailyUpkeep: 160,
      size: [2, 3],
      unlockLevel: 1,
      description: '1 araç kapasiteli, 8 L/sn dolum hızında akaryakıt pompası.',
      icon: 'Fuel'
    },
    /**
     * The station's one tank farm: petrol, diesel and LPG in a single fixture,
     * standing from day one. Splitting the fuels into separate purchases put a
     * new player in a trap — diesel drivers arriving before the diesel tank
     * could be afforded, bleeding reputation for the crime of starting out.
     */
    tank_farm: {
      type: 'tank_farm',
      name: 'Yakıt Tank Sahası',
      category: 'tank',
      price: 66000,
      dailyUpkeep: 270,
      size: [3, 3],
      unlockLevel: 1,
      description:
        'Benzin, dizel ve LPG depolarını tek sahada toplar. Yükseltmek üçünün de kapasitesini büyütür.',
      fixed: true,
      icon: 'Database'
    },
    tank_expansion: {
      type: 'tank_expansion',
      name: 'Geniş Yakıt Tankı',
      category: 'tank',
      price: 209000,
      dailyUpkeep: 480,
      size: [4, 3],
      unlockLevel: 8,
      description:
        'Tüm yakıt depolama kapasitesini iki katına çıkarır. Ana tank sahası Sv3 olmalıdır.',
      icon: 'Database'
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
      price: 8800,
      dailyUpkeep: 30,
      size: [1, 1],
      unlockLevel: 1,
      description: 'Ana yol sürücülerine güncel yakıt fiyatlarını gösterir.',
      icon: 'Tag'
    },
    pylon_sign: {
      type: 'pylon_sign',
      name: 'Reklam Kulesi',
      category: 'structure',
      price: 132000,
      dailyUpkeep: 390,
      /**
       * One cell, matching the mast's own base. It used to reserve four, which
       * is nearly three times the concrete it actually stands on — and since
       * the verge is under a cell deep, that oversized claim was what stopped
       * the sign ever tucking in beside the road without eating forecourt.
       */
      size: [1, 1],
      unlockLevel: 5,
      description:
        'Yol boyunca kilometrelerce öteden görünen yüksek kule; istasyon adını ve açık/kapalı durumunu duyurur. Arsanın 3 birim dışına, yola sıfır kurulabilir.',
      icon: 'Megaphone'
    },
    canopy: {
      type: 'canopy',
      name: 'Ada Sundurması',
      category: 'structure',
      price: 20000,
      dailyUpkeep: 80,
      size: [3, 5],
      unlockLevel: 5,
      description: 'Bir pompanın üstüne kurulur: o pompada +%5 dolum hızı, istasyonda temizlik koruması.',
      icon: 'Umbrella',
      attachTo: 'pump'
    },
    office: {
      type: 'office',
      name: 'Yönetim Ofisi',
      category: 'structure',
      price: 39500,
      dailyUpkeep: 180,
      size: [4, 4],
      unlockLevel: 5,
      description: 'Gelişmiş finansal raporlama ve istasyon müdürü çalışma alanı.',
      icon: 'Building2',
      // İstasyonla birlikte gelir: satın alınacak ya da sökülecek bir şey
      // değil, yalnızca yükseltilir. `fixed` hem katalogdan çıkarır hem
      // satışı engeller — tank sahası ve fiyat tabelasıyla aynı kural.
      fixed: true
    },
    mini_market: {
      type: 'mini_market',
      name: 'Mini Market',
      category: 'service',
      price: 61500,
      dailyUpkeep: 200,
      size: [5, 5],
      unlockLevel: 6,
      description: 'Yakıt alan müşterilere sepet satışı yaparak yan gelir üretir.',
      icon: 'ShoppingBag'
    },
    toilet: {
      type: 'toilet',
      name: 'Müşteri WC / Lavabo',
      category: 'service',
      price: 17500,
      dailyUpkeep: 30,
      size: [2, 2],
      unlockLevel: 6,
      description: 'Aile ve uzun yol müşterilerinin memnuniyetini +%8 artırır.',
      icon: 'Bath'
    },
    light_pole: {
      type: 'light_pole',
      name: 'Aydınlatma Direği',
      category: 'structure',
      price: 3300,
      dailyUpkeep: 40,
      size: [1, 1],
      unlockLevel: 3,
      description: 'Gece saatlerinde istasyon görüşünü ve güvenlik hissini artırır.',
      icon: 'Lightbulb'
    },
    trash_can: {
      type: 'trash_can',
      name: 'Çöp Kutusu',
      category: 'structure',
      price: 1300,
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
      price: 13000,
      dailyUpkeep: 50,
      size: [1, 2],
      unlockLevel: 3,
      description: 'Lastik havası ve su ikmali; kısa duraklamalarda memnuniyeti artırır.',
      icon: 'Wind'
    },
    car_park: {
      type: 'car_park',
      name: 'Otopark (4 Araçlık)',
      category: 'service',
      price: 20000,
      dailyUpkeep: 40,
      size: [5, 3],
      unlockLevel: 4,
      description: 'Dört araçlık park alanı. Birden fazla alan kurarak kapasiteyi artırabilirsiniz.',
      icon: 'SquareParking'
    },
    truck_park: {
      type: 'truck_park',
      name: 'TIR Parkı (3 Araçlık)',
      category: 'service',
      price: 44000,
      dailyUpkeep: 90,
      size: [6, 4],
      unlockLevel: 7,
      description: 'Üç ağır vasıta kapasiteli park alanı. Uzun yol şoförlerini istasyona çeker.',
      icon: 'Truck'
    },
    car_wash: {
      type: 'car_wash',
      name: 'Oto Yıkama',
      category: 'service',
      price: 70500,
      dailyUpkeep: 260,
      size: [2, 3],
      unlockLevel: 6,
      description: 'Tünel tipi otomatik yıkama hattı.',
      icon: 'Droplets'
    },
    oil_change: {
      type: 'oil_change',
      name: 'Yağ Değişim İstasyonu',
      category: 'service',
      price: 57000,
      dailyUpkeep: 220,
      size: [3, 3],
      unlockLevel: 6,
      description: 'Çift kanallı yağ ve filtre değişim servisi.',
      icon: 'Wrench'
    },
    tyre_service: {
      type: 'tyre_service',
      name: 'Lastik Servisi',
      category: 'service',
      price: 53000,
      dailyUpkeep: 200,
      size: [3, 3],
      unlockLevel: 5,
      description: 'Lastik değişimi, balans ve rot ayarı yapılan servis birimi.',
      icon: 'CircleDot'
    },
    cafe: {
      type: 'cafe',
      name: 'Kahveci',
      category: 'service',
      price: 48500,
      dailyUpkeep: 160,
      size: [3, 3],
      unlockLevel: 5,
      description: 'Yol kahvesi ve atıştırmalık satan küçük büfe.',
      icon: 'Coffee'
    },
    restaurant: {
      type: 'restaurant',
      name: 'Restoran',
      category: 'service',
      price: 99000,
      dailyUpkeep: 350,
      size: [6, 6],
      unlockLevel: 8,
      description: 'Oturmalı yol restoranı; uzun yol yolcularını uzun süre tutar.',
      icon: 'UtensilsCrossed'
    },
    rest_complex: {
      type: 'rest_complex',
      name: 'Dinlenme Tesisi',
      category: 'service',
      price: 330000,
      dailyUpkeep: 950,
      size: [12, 6],
      unlockLevel: 10,
      description: 'Market, restoran, kahveci ve WC birimlerini tek çatı altında toplayan büyük tesis.',
      icon: 'Building'
    },
    decoration: {
      type: 'decoration',
      name: 'Peyzaj & Dekorasyon',
      category: 'structure',
      price: 11000,
      dailyUpkeep: 30,
      size: [2, 2],
      unlockLevel: 3,
      description: 'Yeşil alan, saksı ve bank düzenlemesi; sahanın görünümünü iyileştirir.',
      icon: 'Trees'
    },
    wide_entry: {
      type: 'wide_entry',
      name: 'Geniş Giriş Rampası',
      category: 'structure',
      price: 39500,
      dailyUpkeep: 40,
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
      price: 39500,
      dailyUpkeep: 40,
      size: [6, 2],
      unlockLevel: 6,
      description: 'Çift şeritli çıkış rampası; ayrılan araçlar birbirini beklemez.',
      icon: 'ArrowLeft'
    },
    hotel: {
      type: 'hotel',
      name: 'Yol Oteli',
      category: 'service',
      price: 209000,
      dailyUpkeep: 650,
      size: [6, 7],
      unlockLevel: 9,
      description: 'Uzun yol yolcuları için konaklama; geceleyen müşteri akışı yaratır.',
      icon: 'BedDouble'
    },
    ev_substation: {
      type: 'ev_substation',
      name: 'Elektrik Altyapısı',
      category: 'energy',
      price: 88000,
      dailyUpkeep: 380,
      size: [2, 2],
      unlockLevel: 7,
      description: 'Trafo ve dağıtım panosu. Şebekeden enerji çeker; bataryanın ön koşuludur.',
      icon: 'Zap'
    },
    ev_storage: {
      type: 'ev_storage',
      name: 'Enerji Depolama',
      category: 'energy',
      price: 77000,
      dailyUpkeep: 270,
      size: [3, 3],
      unlockLevel: 8,
      description: '200 kWh batarya; şarj üniteleri buradan çeker, trafo şebekeden doldurur. Elektrik altyapısı gerekir.',
      icon: 'BatteryCharging'
    },
    ev_charger_ac: {
      type: 'ev_charger_ac',
      name: 'AC Şarj Ünitesi',
      category: 'energy',
      price: 39500,
      dailyUpkeep: 140,
      size: [1, 2],
      unlockLevel: 7,
      description: 'Yavaş şarj ünitesi. Bataryadan çeker; şarjcı alınabilir. Enerji depolama gerekir.',
      icon: 'Plug'
    },
    ev_charger_dc: {
      type: 'ev_charger_dc',
      name: 'DC Hızlı Şarj',
      category: 'energy',
      price: 99000,
      dailyUpkeep: 330,
      size: [1, 2],
      unlockLevel: 9,
      description: 'Yüksek güçlü hızlı şarj ünitesi. Bataryayı hızlı boşaltır; şarjcı alınabilir. Enerji depolama gerekir.',
      icon: 'Zap'
    },
    diesel_generator: {
      type: 'diesel_generator',
      name: 'Dizel Jeneratör',
      category: 'energy',
      price: 53000,
      dailyUpkeep: 180,
      size: [2, 2],
      unlockLevel: 8,
      description: 'Batarya azalınca kendi tankındaki mazotu yakar. Sattığın dizeli tüketir; stok kritiğe inince durur. Enerji depolama gerekir.',
      icon: 'Fuel'
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
    air_water:    { appeal: 0.03, satisfaction: 3, service: { chance: 0.20, avgSpend: 100 } },
    car_park:     { appeal: 0.04, patience: 0.10 },
    truck_park:   { appeal: 0.06, patience: 0.14 },
    decoration:   { appeal: 0.02, satisfaction: 4 },
    light_pole:   { appeal: 0.02, satisfaction: 1 },
    canopy:       { appeal: 0.04, satisfaction: 3 },
    price_sign:   { appeal: 0.06 },
    pylon_sign:   { appeal: 0.16 },
    office:       { satisfaction: 2 },
    mini_market:  { appeal: 0.06 },
    cafe:         { appeal: 0.07, satisfaction: 3, service: { chance: 0.26, avgSpend: 200 } },
    restaurant:   { appeal: 0.12, patience: 0.10, satisfaction: 5, service: { chance: 0.30, avgSpend: 600 } },
    car_wash:     { appeal: 0.10, satisfaction: 4, service: { chance: 0.25, avgSpend: 600 } },
    oil_change:   { appeal: 0.08, service: { chance: 0.08, avgSpend: 2500 } },
    tyre_service: { appeal: 0.08, service: { chance: 0.12, avgSpend: 1500 } },
    hotel:        { appeal: 0.14, satisfaction: 4, service: { chance: 0.08, avgSpend: 3000 } },
    rest_complex: { appeal: 0.26, patience: 0.20, satisfaction: 9, service: { chance: 0.45, avgSpend: 900 } }
  },

  buildingUpgrades: {
    pump_standard: {
      2: {
        type: 'pump_standard',
        level: 2,
        cost: 22000,
        flowRateLps: 10,
        bonusSpeed: 0.10,
        effectsDescription: '10 L/sn dolum hızı, -%10 servis gecikmesi, dijital sayaç ekranı.'
      },
      3: {
        type: 'pump_standard',
        level: 3,
        cost: 48500,
        flowRateLps: 13,
        bonusSpeed: 0.25,
        effectsDescription: '13 L/sn ultra hızlı dolum, arıza riski -%25, premium gövde tasarımı.'
      }
    },
    tank: {
      2: {
        type: 'tank',
        level: 2,
        cost: 44000,
        capacityLiters: 3000,
        effectsDescription: 'Her yakıtın depolama kapasitesini 3.000 L seviyesine çıkarır.'
      },
      3: {
        type: 'tank',
        level: 3,
        cost: 99000,
        capacityLiters: 6000,
        effectsDescription: 'Büyük Tank: Her yakıtın depolama kapasitesini 6.000 L seviyesine çıkarır.'
      }
    },
    mini_market: {
      2: {
        type: 'mini_market',
        level: 2,
        cost: 48500,
        effectsDescription: 'Müşteri sepet tutarı +%20 artar, vitrin ve iç aydınlatma büyür.'
      },
      3: {
        type: 'mini_market',
        level: 3,
        cost: 110000,
        effectsDescription: 'Süpermarket raf düzeni, sepet harcama çarpanı +%45 artar.'
      }
    },
    price_sign: {
      2: {
        type: 'price_sign',
        level: 2,
        cost: 15500,
        effectsDescription: 'LED Dijital Fiyat Paneli; uzaktan talep çekiciliği +%5 artar.'
      },
      3: {
        type: 'price_sign',
        level: 3,
        cost: 33000,
        effectsDescription: 'Büyük Dijital Pylon; promosyon ışıklandırması ve yüksek görünürlük.'
      }
    },
    toilet: {
      2: {
        type: 'toilet',
        level: 2,
        cost: 11000,
        effectsDescription: 'Daha fazla kabin: ziyaretçi sayısı +%30, moral etkisi +%25 artar.'
      },
      3: {
        type: 'toilet',
        level: 3,
        cost: 26500,
        effectsDescription: 'Engelli kabini ve bebek bakım odası: ziyaretçi +%60, moral etkisi +%50.'
      }
    },
    cafe: {
      2: {
        type: 'cafe',
        level: 2,
        cost: 26500,
        effectsDescription: 'Espresso makinesi ve vitrin: fiş başı harcama +%25 artar.'
      },
      3: {
        type: 'cafe',
        level: 3,
        cost: 61500,
        effectsDescription: 'Oturma alanı ve fırın: fiş başı harcama +%55 artar.'
      }
    },
    restaurant: {
      2: {
        type: 'restaurant',
        level: 2,
        cost: 55000,
        effectsDescription: 'Geniş menü ve teras: hesap başı harcama +%25 artar.'
      },
      3: {
        type: 'restaurant',
        level: 3,
        cost: 132000,
        effectsDescription: 'Şef mutfağı ve açık büfe: hesap başı harcama +%55 artar.'
      }
    },
    hotel: {
      2: {
        type: 'hotel',
        level: 2,
        cost: 110000,
        effectsDescription: '10 oda; yenilenen odalarla konaklama geliri +%20 artar.'
      },
      3: {
        type: 'hotel',
        level: 3,
        cost: 264000,
        effectsDescription: '16 oda, spa ve kahvaltı salonu; konaklama geliri +%40 artar.'
      }
    },
    ev_substation: {
      2: {
        type: 'ev_substation',
        level: 2,
        cost: 66000,
        effectsDescription: 'Şebeke sözleşmesi büyür: bataryaya saatte 120 kWh çekilir.'
      },
      3: {
        type: 'ev_substation',
        level: 3,
        cost: 143000,
        effectsDescription: 'Sanayi sözleşmesi: bataryaya saatte 240 kWh çekilir.'
      }
    },
    ev_storage: {
      2: {
        type: 'ev_storage',
        level: 2,
        cost: 55000,
        effectsDescription: 'Batarya 400 kWh tutar; şarj kuyruğu daha geç boşalır.'
      },
      3: {
        type: 'ev_storage',
        level: 3,
        cost: 121000,
        effectsDescription: 'Batarya 800 kWh tutar; hızlı şarj üniteleri gün boyu dolu çalışır.'
      }
    },
    rest_complex: {
      2: {
        type: 'rest_complex',
        level: 2,
        cost: 198000,
        effectsDescription: 'Tüm birimler yenilenir: ziyaret başı harcama +%25 artar.'
      },
      3: {
        type: 'rest_complex',
        level: 3,
        cost: 440000,
        effectsDescription: 'Bölgenin en büyük tesisi: ziyaret başı harcama +%55 artar.'
      }
    }
  },
  /**
   * What a customer does inside each of these, and what it costs them.
   *
   * The odds are per driver on the block, before the tariff and the hour have
   * their say; a driver wants at most one of them per visit. Times are game
   * seconds — a game hour is ten of them, so a hotel guest's forty-five is
   * most of an evening, and the bay their car takes up is the price of that.
   */
  facilities: {
    toilet: {
      visitChance: 0.35,
      avgSpend: 0,
      costRatio: 0.1,
      visitSeconds: 5,
      levelIncome: [1, 1, 1],
      levelDemand: [1, 1.3, 1.6],
      virtualShare: 0.7,
      walkFromPump: true,
      tariffs: [
        { label: 'Ücretsiz', price: 0, demand: 1, moral: 1 },
        { label: '₺15', price: 15, demand: 0.8, moral: 0.5 },
        { label: '₺25', price: 25, demand: 0.6, moral: 0 }
      ],
      defaultTariff: 1,
      driverAway: "Sürücü WC'ye gitti",
      blurb: 'Yol yorgunları için. Ücret koyarsan gelir gelir ama memnuniyet biraz düşer.'
    },
    mini_market: {
      // The odds and the basket come from the driver — a family fills a
      // trolley where a courier grabs a coffee — so these are only the
      // fallback for an archetype the table does not know.
      visitChance: 0.45,
      avgSpend: 300,
      costRatio: 0.55,
      visitSeconds: 8,
      levelIncome: [1, 1.2, 1.45],
      virtualShare: 0.6,
      walkFromPump: true,
      driverAway: 'Sürücü markete gitti',
      blurb: 'Yakıt alan ve park eden müşterilere sepet satışı. Raflar her sabah dolar.'
    },
    cafe: {
      visitChance: 0.30,
      avgSpend: 200,
      costRatio: 0.45,
      visitSeconds: 9,
      levelIncome: [1, 1.25, 1.55],
      virtualShare: 0.6,
      walkFromPump: true,
      driverAway: 'Sürücü kahveciye gitti',
      blurb: 'Yol kahvesi ve atıştırmalık. Park yeri olan istasyonda çok daha fazla müşteri uğrar.'
    },
    restaurant: {
      visitChance: 0.28,
      avgSpend: 600,
      costRatio: 0.5,
      visitSeconds: 16,
      levelIncome: [1, 1.25, 1.55],
      virtualShare: 0.45,
      walkFromPump: true,
      driverAway: 'Sürücü restorana gitti',
      blurb: 'Oturmalı yol restoranı; müşteri uzun kalır, hesap büyük gelir.'
    },
    hotel: {
      visitChance: 0.08,
      avgSpend: 0,
      costRatio: 0.3,
      visitSeconds: 45,
      levelIncome: [1, 1.2, 1.4],
      virtualShare: 0.3,
      walkFromPump: false,
      tariffs: [
        { label: 'Ekonomik', price: 2000, demand: 1.3, moral: 0.6 },
        { label: 'Standart', price: 3000, demand: 1, moral: 1 },
        { label: 'Lüks', price: 4500, demand: 0.65, moral: 1.3 }
      ],
      defaultTariff: 1,
      nightBoost: 2.2,
      rooms: [6, 10, 16],
      driverAway: 'Sürücü otele yerleşti',
      blurb: 'Uzun yol yolcuları için konaklama. Akşam saatlerinde dolar; her misafir bir oda ve bir park yeri tutar.'
    },
    rest_complex: {
      visitChance: 0.5,
      avgSpend: 900,
      costRatio: 0.5,
      visitSeconds: 12,
      levelIncome: [1, 1.25, 1.55],
      virtualShare: 0.5,
      walkFromPump: true,
      driverAway: 'Sürücü tesise gitti',
      blurb: 'Market, restoran, kahveci ve WC tek çatı altında; her ziyaret büyük hesap yazar.'
    }
  },
  customerTypes: {
    commuter: {
      type: 'commuter',
      name: 'İşe Giden',
      vehicleModels: ['sedan', 'hatchback', 'kenney-sedan', 'kenney-hatchback-sports'],
      minDemand: 18,
      maxDemand: 35,
      basePatienceSeconds: 36,
      priceSensitivity: 'MEDIUM',
      preferredFuel: 'gasoline',
      marketBaseProbability: 0.36,
      marketAvgBasket: 280,
      tipChanceModifier: 1.0,
      specialBehavior: 'Hızlı hizmet bekler.',
      roadTrafficWeight: 1.5
    },
    family: {
      type: 'family',
      name: 'Aile',
      vehicleModels: ['suv', 'kenney-suv'],
      minDemand: 25,
      maxDemand: 50,
      basePatienceSeconds: 48,
      priceSensitivity: 'MEDIUM',
      preferredFuel: 'gasoline',
      marketBaseProbability: 0.70,
      marketAvgBasket: 450,
      tipChanceModifier: 1.0,
      specialBehavior: 'Markete ve tuvalete girme olasılığı yüksektir.',
      roadTrafficWeight: 1.1
    },
    taxi: {
      type: 'taxi',
      name: 'Taksi',
      vehicleModels: ['taxi', 'kenney-taxi'],
      minDemand: 15,
      maxDemand: 40,
      basePatienceSeconds: 26,
      priceSensitivity: 'HIGH',
      preferredFuel: 'lpg',
      marketBaseProbability: 0.20,
      marketAvgBasket: 220,
      tipChanceModifier: 0.8,
      specialBehavior: 'Kısa kuyruk arar, sabırsızdır.',
      roadTrafficWeight: 0.75,
      stationStopWeight: 1.2
    },
    courier: {
      type: 'courier',
      name: 'Kurye / Motosiklet',
      vehicleModels: ['hatchback', 'kenney-van'],
      minDemand: 8,
      maxDemand: 28,
      basePatienceSeconds: 22,
      priceSensitivity: 'HIGH',
      preferredFuel: 'gasoline',
      marketBaseProbability: 0.16,
      marketAvgBasket: 200,
      tipChanceModifier: 1.2,
      specialBehavior: 'Hızlı hizmette ekstra hız bonusu bahşişi bırakır.',
      roadTrafficWeight: 0.85
    },
    commercial: {
      type: 'commercial',
      name: 'Ticari Van / Minibüs',
      vehicleModels: ['van', 'pickup', 'kenney-delivery'],
      minDemand: 35,
      maxDemand: 75,
      basePatienceSeconds: 44,
      priceSensitivity: 'LOW',
      preferredFuel: 'diesel',
      marketBaseProbability: 0.44,
      marketAvgBasket: 380,
      tipChanceModifier: 1.0,
      specialBehavior: 'Dizel ağırlıklıdır, yüksek hacimli yakıt alır.',
      roadTrafficWeight: 0.9
    },
    truck: {
      type: 'truck',
      name: 'Ağır Kamyon',
      vehicleModels: ['truck', 'truck-with-trailer', 'kenney-truck'],
      minDemand: 80,
      maxDemand: 180,
      basePatienceSeconds: 60,
      priceSensitivity: 'LOW',
      preferredFuel: 'diesel',
      marketBaseProbability: 0.70,
      marketAvgBasket: 500,
      tipChanceModifier: 1.1,
      specialBehavior: 'Büyük dolum yapar, sabrı uzundur.',
      roadTrafficWeight: 0.65,
      stationStopWeight: 0.65,
      roadSpeedMultiplier: 0.78
    },
    ev: {
      type: 'ev',
      name: 'Elektrikli Araç',
      vehicleModels: ['hatchback'],
      minDemand: 20,
      maxDemand: 55,
      basePatienceSeconds: 52,
      priceSensitivity: 'MEDIUM',
      preferredFuel: 'any',
      marketBaseProbability: 0.70,
      marketAvgBasket: 480,
      tipChanceModifier: 1.3,
      specialBehavior: 'Şarj süresi uzundur; beklerken tesisleri kullanır.',
      requiresCharger: true,
      roadTrafficWeight: 1.15
    },
    luxury: {
      type: 'luxury',
      name: 'Lüks / Spor',
      vehicleModels: [
        'sports',
        'roadster',
        'muscle',
        'muscle-2',
        'limousine',
        'kenney-suv-luxury',
        'kenney-sedan-sports'
      ],
      minDemand: 30,
      maxDemand: 60,
      basePatienceSeconds: 30,
      priceSensitivity: 'LOW',
      preferredFuel: 'gasoline',
      marketBaseProbability: 0.50,
      marketAvgBasket: 550,
      tipChanceModifier: 2.2,
      specialBehavior: 'Temiz sahada ve yüksek puanda yüklü bahşiş verir.',
      roadTrafficWeight: 0.75
    },
    police: {
      type: 'police',
      name: 'Polis Aracı',
      vehicleModels: ['police-sedan', 'police-suv', 'police-sports', 'police-muscle'],
      minDemand: 35,
      maxDemand: 65,
      basePatienceSeconds: 24,
      priceSensitivity: 'LOW',
      preferredFuel: 'gasoline',
      marketBaseProbability: 0.10,
      marketAvgBasket: 250,
      tipChanceModifier: 1.1,
      specialBehavior: 'Trafikte sık devriye gezer, istasyona nadiren uğrar.',
      roadTrafficWeight: 1,
      stationStopWeight: 0.12,
      roadSpeedMultiplier: 1.05
    },
    ambulance: {
      type: 'ambulance',
      name: 'Ambulans',
      vehicleModels: ['ambulance'],
      minDemand: 45,
      maxDemand: 85,
      basePatienceSeconds: 20,
      priceSensitivity: 'LOW',
      preferredFuel: 'diesel',
      marketBaseProbability: 0.06,
      marketAvgBasket: 220,
      tipChanceModifier: 1.0,
      specialBehavior: 'Trafikte görünür ancak acil görevi nedeniyle çok nadir durur.',
      roadTrafficWeight: 0.8,
      stationStopWeight: 0.08,
      roadSpeedMultiplier: 1.08
    },
    firetruck: {
      type: 'firetruck',
      name: 'İtfaiye Aracı',
      vehicleModels: ['firetruck'],
      minDemand: 90,
      maxDemand: 170,
      basePatienceSeconds: 42,
      priceSensitivity: 'LOW',
      preferredFuel: 'diesel',
      marketBaseProbability: 0.16,
      marketAvgBasket: 350,
      tipChanceModifier: 1.1,
      specialBehavior: 'Büyük deposu vardır; trafikte görünür, yakıt için seyrek uğrar.',
      roadTrafficWeight: 0.8,
      stationStopWeight: 0.1,
      roadSpeedMultiplier: 0.82
    },
    bus: {
      type: 'bus',
      name: 'Otobüs',
      vehicleModels: ['bus'],
      minDemand: 85,
      maxDemand: 150,
      basePatienceSeconds: 58,
      priceSensitivity: 'MEDIUM',
      preferredFuel: 'diesel',
      marketBaseProbability: 0.70,
      marketAvgBasket: 700,
      tipChanceModifier: 1.0,
      specialBehavior: 'Büyük depo doldurur; yolcular tesiste daha fazla harcama yapar.',
      roadTrafficWeight: 1,
      stationStopWeight: 0.25,
      roadSpeedMultiplier: 0.72
    },
    monster: {
      type: 'monster',
      name: 'Arazi / Monster Truck',
      vehicleModels: ['monster-truck'],
      minDemand: 55,
      maxDemand: 100,
      basePatienceSeconds: 30,
      priceSensitivity: 'LOW',
      preferredFuel: 'gasoline',
      marketBaseProbability: 0.24,
      marketAvgBasket: 450,
      tipChanceModifier: 1.5,
      specialBehavior: 'Yüksek tüketimli gösterişli araçtır ve istasyona seyrek uğrar.',
      roadTrafficWeight: 0.6,
      stationStopWeight: 0.12,
      roadSpeedMultiplier: 0.8
    }
  },
  employees: {
    pumpAttendant: {
      role: 'PUMP_ATTENDANT',
      tierLevels: [
        {
          level: 1,
          hireCost: 12000,
          dailyWage: 900,
          speedMultiplier: 0.75,
          actionDelaySeconds: 2.0,
          maxConcurrentPumps: 1,
          unlockRequirement: 'Seviye 3'
        },
        {
          level: 2,
          hireCost: 7000,
          dailyWage: 1100,
          speedMultiplier: 0.90,
          actionDelaySeconds: 1.2,
          maxConcurrentPumps: 1,
          unlockRequirement: '40 Hizmet Tamamla',
          requiredServices: 40
        },
        {
          level: 3,
          hireCost: 15000,
          dailyWage: 1450,
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
      minReputation: 4.00,
      minActiveAttendants: 2,
      minProfitableDaysInLast3: 2,
      hireCost: 90000,
      dailyWage: 4000,
      defaultKasaReserve: 8000,
      // Three grades, and the job grows with them. The first manager keeps the
      // lights on: money in, fuel ordered, staff at their posts, worn pumps
      // serviced. The second is trusted with the books and the power bill and
      // gets a failed bay back on its feet. Only the third is sharp enough to
      // catch the supplier's one-minute discount. Rounds get quicker as they
      // go — 45 seconds is long enough for a tank to run down between looks,
      // which is the point of paying for a better one (Emre, 2026-09-07:
      // the manager is meant to be expensive and the game meant to be hard).
      tiers: [
        {
          level: 1,
          upgradeCost: 0,
          dailyWage: 4000,
          minReputation: 4.0,
          tourSeconds: 45,
          duties: ['collectTills', 'fuelOrder', 'assignAttendants', 'maintenance'],
          orderThresholds: [10, 20],
          canFillTank: false
        },
        {
          level: 2,
          upgradeCost: 120000,
          dailyWage: 5200,
          minReputation: 4.25,
          tourSeconds: 32,
          duties: [
            'collectTills', 'fuelOrder', 'assignAttendants', 'maintenance',
            'pricing', 'nightGridFill', 'cleanStation', 'repair'
          ],
          orderThresholds: [10, 20, 35],
          canFillTank: false
        },
        {
          level: 3,
          upgradeCost: 190000,
          dailyWage: 6500,
          minReputation: 4.5,
          tourSeconds: 22,
          duties: [
            'collectTills', 'fuelOrder', 'assignAttendants', 'maintenance',
            'pricing', 'nightGridFill', 'cleanStation', 'repair', 'dealStock'
          ],
          orderThresholds: [10, 20, 35, 50],
          canFillTank: true
        }
      ]
    }
  },
  pumpFuelModules: {
    diesel: { cost: 13000, minLevel: 3 },
    lpg: { cost: 20000, minLevel: 8 }
  },
  loans: [
    {
      id: 'loan_micro',
      name: 'İşletme Sermayesi Kredisi',
      principal: 30000,
      totalCostRatio: 0.10,
      termDays: 5,
      dailyPayment: 6600,
      minLevel: 5,
      minReputation: 3.00
    },
    {
      id: 'loan_growth',
      name: 'Büyüme & Yatırım Kredisi',
      principal: 105000,
      totalCostRatio: 0.14,
      termDays: 10,
      dailyPayment: 11970,
      minLevel: 5,
      minReputation: 3.50
    },
    {
      id: 'loan_expansion',
      name: 'Arsa & Genişleme Kredisi',
      principal: 270000,
      totalCostRatio: 0.18,
      termDays: 18,
      dailyPayment: 17700,
      minLevel: 6,
      minReputation: 4.00,
      requiredExpansion: 'A'
    },
    {
      id: 'loan_corporate',
      name: 'Kurumsal Ölçeklendirme Kredisi',
      principal: 600000,
      totalCostRatio: 0.25,
      termDays: 30,
      dailyPayment: 25000,
      minLevel: 10,
      minReputation: 4.50
    }
  ],
  levels: [
    { level: 1, requiredTotalXp: 0, rewardCash: 0, unlockedFeatures: 'Benzin, Manuel Dolum, Tanker Siparişi' },
    { level: 2, requiredTotalXp: 300, rewardCash: 1500, unlockedFeatures: 'Çöp Kutusu, Aydınlatmalı Gece Trafiği' },
    { level: 3, requiredTotalXp: 800, rewardCash: 0, unlockedFeatures: 'Pompacı İşe Alma, Pompa S2, Dizel Tabancası, Aydınlatma Direği' },
    { level: 4, requiredTotalXp: 1600, rewardCash: 2500, unlockedFeatures: 'Orta Boy Tank Yükseltmesi (3.000 L)' },
    { level: 5, requiredTotalXp: 2800, rewardCash: 0, unlockedFeatures: 'Banka Kredileri, Yapı Bakımı & Tamir, Düzenleme Modu' },
    { level: 6, requiredTotalXp: 4500, rewardCash: 3000, unlockedFeatures: 'Mini Market, Tuvalet, Oto Yıkama' },
    { level: 7, requiredTotalXp: 6500, rewardCash: 0, unlockedFeatures: 'Ada Sundurması (Canopy), Dijital LED Tabela' },
    { level: 8, requiredTotalXp: 9000, rewardCash: 0, unlockedFeatures: 'Büyük Tank (6.000 L), Pompa S3, LPG Tabancası, Geniş Yakıt Tankı' },
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
    priceGrowthPerUnit: 1.3,
    tankerSpeedSecondsMin: 36,
    tankerSpeedSecondsMax: 60,
    tankerUnloadSpeedLps: 100,
    tankerCancelRefundRatio: 0.85,
    overdraftLimit: -5000,
    defaultAutonomyBudgetReserve: 8000
  },
  suppliers: [
    {
      id: 'toptan_depo',
      name: 'Toptancı Depo',
      tag: '%-8 · yavaş',
      priceMultiplier: 0.92,
      speedMultiplier: 2.2,
      description: 'En ucuz litre fiyatı ama tanker geç gelir — stoğunu erken planla.'
    },
    {
      id: 'standart',
      name: 'Standart Dağıtım',
      tag: 'piyasa · normal',
      priceMultiplier: 1.00,
      speedMultiplier: 1.0,
      description: 'Piyasa fiyatı, normal teslimat süresi.'
    },
    {
      id: 'hizli_lojistik',
      name: 'Hızlı Lojistik',
      tag: '+%7 · hızlı',
      priceMultiplier: 1.07,
      speedMultiplier: 0.5,
      description: 'Pahalı ama tanker yarı sürede kapıda — tank kurutmadan doldurur.'
    }
  ] as const,
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
    dcChargeSeconds: 10,
    /**
     * The battery bank is the electric fuel tank: chargers draw from it and
     * the substation trickles it back from the grid. A bank comes full
     * (Emre, 2026-09-07: "200 kWh otomatik gelsin") and grows with its level.
     */
    storageKwhByLevel: [200, 400, 800],
    gridKwhPerHour: 60,
    gridLevelFactor: [1, 2, 4],
    gridPricePerKwh: 4.5,
    // The contract's clock (Emre, 2026-09-07): energy is a supply line like
    // fuel is. Filling at night is the cheap tanker; the evening peak is the
    // dear one. The manager's night-fill rule is what makes the choice pay.
    gridTariff: {
      night: { from: 22, to: 6, price: 2.4 },
      peak: { from: 17, to: 21, price: 7.5 }
    },
    nightFillFloorPercent: 25,
    solar: {
      unlockLevel: 8,
      pricePerCell: 1300,
      upkeepPerCell: 4,
      // The glass has its own grime (Emre, 2026-09-08), apart from the
      // forecourt's: a fortnight of dust takes a roof to about a third of
      // clean, a day of rain gives most of it back, and a wash is cheap
      // against what a dirty roof stops making.
      cleanCostPerCell: 40,
      grimePerSecond: 0.02,
      rainWashPerSecond: 0.08,
      peakKwhPerCell: 0.8,
      sunrise: 6,
      sunset: 20,
      weather: { SUNNY: 1, OVERCAST: 0.45, RAIN: 0.2 },
      minGrimeFactor: 0.5
    },
    generator: {
      kwhPerHour: 80,
      litersPerKwh: 0.3,
      runBelowPercent: 50,
      reserveShare: 0.15
    }
  },
  roadUpgrade: {
    price: 550000,
    minLevel: 8,
    minReputation: 4.0
  },
  // Emre'nin kuralı (2026-09-08): sınırsız alım yok. Arsa başına bir market,
  // bir tuvalet, bir restoran, bir kahveci; istasyonda toplam bir tesis, bir
  // yağ, bir lastik, bir yıkama, bir otel; şarj direği AC'de beş, DC'de on.
  // Pompa ve direk gibi tekrar alınanlar her seferinde pahalanır; süs ve
  // aydınlatma daha yavaş, ki onuncu direk bir pompa etmesin.
  buildingRules: {
    mini_market: { maxPerSide: 1 },
    toilet: { maxPerSide: 1 },
    restaurant: { maxPerSide: 1 },
    cafe: { maxPerSide: 1 },
    rest_complex: { maxTotal: 1 },
    hotel: { maxTotal: 1 },
    oil_change: { maxTotal: 1 },
    tyre_service: { maxTotal: 1 },
    car_wash: { maxTotal: 1 },
    ev_charger_ac: { maxTotal: 5 },
    ev_charger_dc: { maxTotal: 10 },
    ev_substation: { maxPerSide: 1 },
    ev_storage: { maxPerSide: 1 },
    diesel_generator: { maxPerSide: 1 },
    air_water: { maxPerSide: 1 },
    truck_park: { maxPerSide: 1 },
    car_park: { maxPerSide: 2 },
    pylon_sign: { maxTotal: 1 },
    tank_farm: { maxTotal: 1 },
    tank_expansion: { maxTotal: 1 },
    light_pole: { priceGrowth: 1.1 },
    trash_can: { priceGrowth: 1.1 },
    decoration: { priceGrowth: 1.1 }
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
    { id: 'T3', description: 'Tedarik panelinden bir benzin tankeri siparişi ver', metric: 'ORDERS_PLACED', target: 1, rewardCash: 450, rewardXp: 75 },
    { id: 'T4', description: 'Fiyatlandırma paneline girerek satış fiyatını ayarla', metric: 'PRICE_SET', target: 1, rewardCash: 500, rewardXp: 50 },
    { id: 'T5', description: 'İnşaat modunda bir yapıyı taşı veya yeni bir tabela yerleştir', metric: 'BUILD_PLACED', target: 1, rewardCash: 0, rewardXp: 50 },
    { id: 'T6', description: 'Günü tamamla ve Gün Sonu Faaliyet Raporunu incele', metric: 'DAYS_COMPLETED', target: 1, rewardCash: 1000, rewardXp: 100 }
  ]
};
