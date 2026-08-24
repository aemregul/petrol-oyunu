/**
 * Project Highway - Master Mathematical & Economic Formulas
 * Sourced directly from GDD (Ek B, Section 10, 12, 13, 14, 17, 20)
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Section 10.2: Günlük Alış Fiyatı
 * bugunkuAlis = tabanAlis * (1 + trend + gunlukDalgalanma + olayEtkisi)
 */
export function calculateDailyWholesalePrice(
  baseWholesale: number,
  trend: number = 0, // -0.01 to +0.01
  dailyVolatility: number = 0, // -0.03 to +0.03
  eventModifier: number = 0 // -0.05 to +0.08
): number {
  const finalPrice = baseWholesale * (1 + trend + dailyVolatility + eventModifier);
  return Number(finalPrice.toFixed(2));
}

/**
 * Section 10.3 & Ek B: Fiyat Çekiciliği ve Talep
 * fiyatEndeksi = oyuncuSatisFiyati / bolgeselOrtalama
 * fiyatCekiciligi = clamp(1.25 - 1.80 * (fiyatEndeksi - 1), 0.55, 1.25)
 */
export function calculatePriceAttractiveness(
  playerPrice: number,
  regionalAverage: number
): { priceIndex: number; attractiveness: number; trafficModifierPercent: number; reputationDeltaPerDay: number } {
  if (regionalAverage <= 0) {
    return { priceIndex: 1.0, attractiveness: 1.0, trafficModifierPercent: 0, reputationDeltaPerDay: 0 };
  }

  const priceIndex = playerPrice / regionalAverage;
  const attractiveness = clamp(1.25 - 1.80 * (priceIndex - 1), 0.55, 1.25);
  const diffPercent = (playerPrice - regionalAverage) / regionalAverage;

  let trafficModifierPercent = 0;
  let reputationDeltaPerDay = 0;

  if (diffPercent <= -0.08) {
    trafficModifierPercent = 14;
    reputationDeltaPerDay = 0.02;
  } else if (diffPercent <= -0.03) {
    trafficModifierPercent = 5;
    reputationDeltaPerDay = 0.01;
  } else if (diffPercent <= 0.02) {
    trafficModifierPercent = 0;
    reputationDeltaPerDay = 0.00;
  } else if (diffPercent <= 0.05) {
    trafficModifierPercent = -5;
    reputationDeltaPerDay = -0.01;
  } else if (diffPercent <= 0.10) {
    trafficModifierPercent = -14;
    reputationDeltaPerDay = -0.03;
  } else {
    trafficModifierPercent = -25;
    reputationDeltaPerDay = -0.06;
  }

  return {
    priceIndex: Number(priceIndex.toFixed(3)),
    attractiveness: Number(attractiveness.toFixed(3)),
    trafficModifierPercent,
    reputationDeltaPerDay
  };
}

/**
 * Section 8.2: Trafik Saat Çarpanı (06:00 - 22:00)
 */
export function calculateHourlyTrafficMultiplier(hour: number): number {
  if (hour >= 6 && hour < 8) return 1.25; // Taksi, işe giden, servis
  if (hour >= 8 && hour < 12) return 0.90; // Aile, hafif ticari
  if (hour >= 12 && hour < 14) return 1.15; // Aile, kurye, taksi
  if (hour >= 14 && hour < 17) return 0.85; // Karma trafik
  if (hour >= 17 && hour < 20) return 1.35; // İşten dönen, taksi, aile
  if (hour >= 20 && hour <= 22) return 0.75; // Uzun yol ve ticari
  return 0.50; // Gece/Kapalı
}

/**
 * Section 12.3: İtibar Çarpanı
 * 1.0 puanda 0.55x; 3.0 puanda 1.0x; 5.0 puanda 1.45x
 */
export function calculateReputationTrafficMultiplier(reputation: number): number {
  const repClamped = clamp(reputation, 1.0, 5.0);
  if (repClamped <= 3.0) {
    // 1.0 -> 0.55, 3.0 -> 1.00
    return 0.55 + ((repClamped - 1.0) / 2.0) * 0.45;
  } else {
    // 3.0 -> 1.00, 5.0 -> 1.45
    return 1.00 + ((repClamped - 3.0) / 2.0) * 0.45;
  }
}

/**
 * Section 13.3: Hizmet Puanı
 * hizmetPuani = 0.45 * hiz + 0.35 * dogruluk + 0.20 * temizlik (0 - 100)
 */
export function calculateServiceScore(
  speedScore: number, // 0 - 100 (kalan sabır oranı)
  accuracyScore: number, // 0 - 100 (hedef tutturma)
  cleanlinessScore: number // 0 - 100
): number {
  const score = 0.45 * clamp(speedScore, 0, 100) +
                0.35 * clamp(accuracyScore, 0, 100) +
                0.20 * clamp(cleanlinessScore, 0, 100);
  return Math.round(score);
}

/**
 * Section 14.3: Bahşiş Hesaplama
 * Temel %8, 85+ hizmet puanında %18, lüks müşteride +%12
 * Bahşiş tutarı satışın %1 - %4'ü arasındadır.
 */
export function calculateCustomerTip(
  saleAmount: number,
  serviceScore: number,
  archetype: string
): number {
  let chance = 0.08;
  if (serviceScore >= 85) chance = 0.18;
  if (archetype === 'luxury') chance += 0.12;
  if (archetype === 'courier' && serviceScore >= 90) chance += 0.10;

  if (Math.random() < chance) {
    const tipPercent = 0.01 + Math.random() * 0.03; // %1 - %4
    const tipAmount = Math.max(1, Math.round(saleAmount * tipPercent));
    return tipAmount;
  }
  return 0;
}

/**
 * Section 14.1 & Ek B: İtibar Güncelleme Formülü
 * yeniItibar = clamp(eskiItibar * 0.85 + (gunHizmetPuani / 20) * 0.15 + olayDeltasi, 1.00, 5.00)
 */
export function calculateEndOfDayReputation(
  currentReputation: number,
  avgDayServiceScore: number, // 0 - 100
  eventDelta: number = 0
): number {
  const targetScoreFromServices = (avgDayServiceScore / 20); // 0 - 5.00
  const updatedRep = currentReputation * 0.85 + targetScoreFromServices * 0.15 + eventDelta;
  return Number(clamp(updatedRep, 1.00, 5.00).toFixed(2));
}

/**
 * Section 20.2 & Ek B: Tamir Maliyeti
 * tamirMaliyeti = varlikTemelFiyati * eksikSaglikYuzdesi * 0.18 (Min 250 TL)
 */
export function calculateRepairCost(basePrice: number, currentHealth: number): number {
  const missingHealthRatio = (100 - clamp(currentHealth, 0, 100)) / 100;
  if (missingHealthRatio <= 0) return 0;
  const cost = basePrice * missingHealthRatio * 0.18;
  return Math.max(250, Math.round(cost));
}

/**
 * Section 14.3 & Ek B: Satış / Yıkım İadesi
 * Geri ödeme = (temel fiyat + yukseltme maliyetleri) * 0.55
 */
export function calculateRefundAmount(basePrice: number, upgradeCosts: number = 0): number {
  return Math.round((basePrice + upgradeCosts) * 0.55);
}

/**
 * Section 17.3 & Ek B: Müdür Kullanılabilir Otomasyon Bütçesi
 * kullanilabilirOtomasyonButcesi = kasa - oyuncuKasaRezervi - bugunkuZorunluTaksit - bugunkuMaasTahmini
 */
export function calculateManagerAvailableBudget(
  cash: number,
  kasaReserve: number,
  todayDueLoanInstallments: number,
  todayEstimatedWages: number
): number {
  const available = cash - kasaReserve - todayDueLoanInstallments - todayEstimatedWages;
  return Math.max(0, available);
}
