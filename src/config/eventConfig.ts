/**
 * Project Highway - Random Event & Daily Mission Catalogue
 *
 * Events feed the olayEtkisi / eventDelta terms the economy formulas already
 * accept, so they move wholesale prices, traffic and reputation through the
 * same maths the rest of the simulation uses.
 */

import { GameEventCategory, GameEventEffects, MissionMetric } from '../domain/types/gameState';

export interface GameEventConfig {
  id: string;
  name: string;
  description: string;
  category: GameEventCategory;
  icon: string;
  /** Relative draw weight against every other eligible event. */
  weight: number;
  minLevel: number;
  /** Lifetime in game hours. 0 means the effects apply once and it is done. */
  durationHours: number;
  /** Rolled at the day boundary instead of during play. */
  daily?: boolean;
  effects: GameEventEffects;
}

export const GAME_EVENTS: GameEventConfig[] = [
  /* ---------------- Economy: rolled when a new day starts ---------------- */
  {
    id: 'refinery_hike',
    name: 'Rafineri Zammı',
    description: 'Rafineri çıkış fiyatları yükseldi. Bugün toptan alış %8 daha pahalı.',
    category: 'ECONOMY',
    icon: 'TrendingUp',
    weight: 10,
    minLevel: 1,
    durationHours: 16,
    daily: true,
    effects: { wholesalePriceModifier: 0.08 }
  },
  {
    id: 'supply_discount',
    name: 'Tedarikçi İndirimi',
    description: 'Tedarikçi kampanya başlattı. Bugün toptan alış %6 daha ucuz.',
    category: 'ECONOMY',
    icon: 'TrendingDown',
    weight: 10,
    minLevel: 1,
    durationHours: 16,
    daily: true,
    effects: { wholesalePriceModifier: -0.06 }
  },
  {
    id: 'currency_shock',
    name: 'Kur Dalgalanması',
    description: 'Döviz kuru sıçradı; ithal yakıt maliyeti %12 arttı.',
    category: 'ECONOMY',
    icon: 'AlertTriangle',
    weight: 5,
    minLevel: 4,
    durationHours: 16,
    daily: true,
    effects: { wholesalePriceModifier: 0.12 }
  },

  /* ---------------- Traffic: fire during the day ---------------- */
  {
    id: 'rush_hour',
    name: 'Yoğun Trafik Akını',
    description: 'Ana yolda trafik patladı. Gelen araç sayısı belirgin şekilde arttı.',
    category: 'TRAFFIC',
    icon: 'Car',
    weight: 14,
    minLevel: 1,
    durationHours: 2,
    effects: { trafficMultiplier: 1.6 }
  },
  {
    id: 'city_festival',
    name: 'Şehir Festivali',
    description: 'Şehirde festival var; yoldan geçen araç trafiği ikiye katlandı.',
    category: 'TRAFFIC',
    icon: 'PartyPopper',
    weight: 8,
    minLevel: 3,
    durationHours: 4,
    effects: { trafficMultiplier: 1.9 }
  },
  {
    id: 'road_works',
    name: 'Yol Çalışması',
    description: 'Ana yolda bakım çalışması başladı; istasyona ulaşan araç sayısı yarıya düştü.',
    category: 'TRAFFIC',
    icon: 'Construction',
    weight: 9,
    minLevel: 2,
    durationHours: 3,
    effects: { trafficMultiplier: 0.5 }
  },
  {
    id: 'competitor_promo',
    name: 'Rakip İstasyon Kampanyası',
    description: 'Yakındaki rakip istasyon indirim kampanyası açtı; trafiğin bir kısmı oraya kaydı.',
    category: 'TRAFFIC',
    icon: 'Users',
    weight: 8,
    minLevel: 3,
    durationHours: 4,
    effects: { trafficMultiplier: 0.65 }
  },

  /* ---------------- Incidents ---------------- */
  {
    id: 'fuel_spill',
    name: 'Yakıt Sızıntısı',
    description: 'Bir pompada yakıt döküldü. Saha kirlendi ve müşteriler rahatsız oldu.',
    category: 'INCIDENT',
    icon: 'Droplets',
    weight: 9,
    minLevel: 2,
    durationHours: 0,
    effects: { cleanlinessDelta: -25, reputationDelta: -0.06 }
  },
  {
    id: 'pump_malfunction',
    name: 'Pompa Arızası',
    description: 'Bir pompanın sayaç mekanizması bozuldu; ekipman sağlığı ciddi şekilde düştü.',
    category: 'INCIDENT',
    icon: 'Wrench',
    weight: 8,
    minLevel: 2,
    durationHours: 0,
    effects: { pumpHealthDelta: -35 }
  },
  {
    id: 'power_outage',
    name: 'Elektrik Kesintisi',
    description: 'Bölgesel elektrik kesintisi! Pompalar kesinti boyunca hizmet veremiyor.',
    category: 'INCIDENT',
    icon: 'ZapOff',
    weight: 5,
    minLevel: 4,
    durationHours: 1,
    effects: { pumpsDisabled: true }
  },
  {
    id: 'health_inspection',
    name: 'Belediye Denetimi',
    description: 'Belediye ekipleri istasyonu denetliyor. Sonuç saha temizliğine bağlı.',
    category: 'INCIDENT',
    icon: 'ClipboardCheck',
    weight: 7,
    minLevel: 3,
    durationHours: 0,
    effects: {} // resolved dynamically from station cleanliness
  },

  /* ---------------- Opportunities ---------------- */
  {
    id: 'vip_convoy',
    name: 'VIP Konvoyu',
    description: 'Lüks araç konvoyu istasyona uğradı; bahşişler üç katına çıktı.',
    category: 'OPPORTUNITY',
    icon: 'Crown',
    weight: 7,
    minLevel: 5,
    durationHours: 2,
    effects: { tipMultiplier: 3, trafficMultiplier: 1.2 }
  },
  {
    id: 'fleet_contract',
    name: 'Kurumsal Filo Anlaşması',
    description: 'Bir kargo firması filosunu istasyonunuza yönlendirdi. Peşin avans yatırıldı.',
    category: 'OPPORTUNITY',
    icon: 'Truck',
    weight: 6,
    minLevel: 6,
    durationHours: 5,
    effects: { cashDelta: 6000, trafficMultiplier: 1.35 }
  },
  {
    id: 'local_review',
    name: 'Olumlu Yerel Haber',
    description: 'Yerel bir blog istasyonunuzu övdü; itibarınız arttı ve trafik canlandı.',
    category: 'OPPORTUNITY',
    icon: 'Star',
    weight: 6,
    minLevel: 2,
    durationHours: 3,
    effects: { reputationDelta: 0.12, trafficMultiplier: 1.25 }
  }
];

/* ------------------------------------------------------------------ */
/* Daily missions                                                      */
/* ------------------------------------------------------------------ */

export interface DailyMissionTemplate {
  id: string;
  /** {n} is replaced with the rolled target. */
  description: string;
  metric: MissionMetric;
  minTarget: number;
  maxTarget: number;
  /** Target is rounded to this step so goals read cleanly. */
  step: number;
  rewardCashPerUnit: number;
  rewardXp: number;
  minLevel: number;
}

export const DAILY_MISSION_TEMPLATES: DailyMissionTemplate[] = [
  {
    id: 'D_SERVE',
    description: 'Bugün {n} müşteriye hizmet ver',
    metric: 'CUSTOMERS_SERVED',
    minTarget: 6,
    maxTarget: 16,
    step: 1,
    rewardCashPerUnit: 90,
    rewardXp: 60,
    minLevel: 1
  },
  {
    id: 'D_LITERS',
    description: 'Bugün toplam {n} litre yakıt sat',
    metric: 'FUEL_LITERS_SOLD',
    minTarget: 200,
    maxTarget: 700,
    step: 50,
    rewardCashPerUnit: 2.5,
    rewardXp: 70,
    minLevel: 1
  },
  {
    id: 'D_REVENUE',
    description: 'Bugün {n} TL yakıt cirosu yap',
    metric: 'FUEL_REVENUE',
    minTarget: 8000,
    maxTarget: 30000,
    step: 1000,
    rewardCashPerUnit: 0.06,
    rewardXp: 80,
    minLevel: 2
  },
  {
    id: 'D_TIPS',
    description: 'Bugün {n} TL bahşiş topla',
    metric: 'TIPS_EARNED',
    minTarget: 40,
    maxTarget: 200,
    step: 10,
    rewardCashPerUnit: 8,
    rewardXp: 60,
    minLevel: 3
  },
  {
    id: 'D_MARKET',
    description: 'Bugün markette {n} satış gerçekleştir',
    metric: 'MARKET_SALES',
    minTarget: 3,
    maxTarget: 10,
    step: 1,
    rewardCashPerUnit: 200,
    rewardXp: 70,
    minLevel: 6
  },
  {
    id: 'D_CLEAN',
    description: 'Bugün sahayı {n} kez temizle',
    metric: 'STATION_CLEANED',
    minTarget: 1,
    maxTarget: 3,
    step: 1,
    rewardCashPerUnit: 450,
    rewardXp: 40,
    minLevel: 2
  }
];
