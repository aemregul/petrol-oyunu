import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  placeFuelOrder,
  runSimulationTick,
  FORECOURT_FRONT
} from '../domain/services/simulationEngine';
import { GameState } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import { createEffects } from '../domain/services/simulationEngine';

/** Tanklı, paralı, açık günlük bir temel durum. */
function baseState(): GameState {
  const s = createInitialGameState();
  s.player.cash = 999_999;
  // Tüm tankları aç
  s.tanks.gasoline.capacity = 1500;
  s.tanks.gasoline.stock    = 0;
  s.tanks.diesel.capacity   = 1500;
  s.tanks.diesel.stock      = 0;
  s.tanks.lpg.capacity      = 1500;
  s.tanks.lpg.stock         = 0;
  s.dayState.isDayActive    = true;
  s.dayState.timeSpeed      = 1;
  return s;
}

// ─── Tedarikçi fiyat çarpanları ──────────────────────────────────────────────

describe('placeFuelOrder — tedarikçi fiyat çarpanları', () => {
  it('standart tedarikçi piyasa fiyatını bire bir uygular', () => {
    const s = baseState();
    const piyasa = s.pricing.gasoline.todayWholesaleCost;
    placeFuelOrder(s, 'gasoline', 500, createEffects(), 'standart');
    const order = s.fuelOrders[0];
    expect(order.unitCost).toBeCloseTo(piyasa, 2);
  });

  it('toptancı depo %8 indirim uygular', () => {
    const s = baseState();
    const piyasa = s.pricing.gasoline.todayWholesaleCost;
    placeFuelOrder(s, 'gasoline', 500, createEffects(), 'toptan_depo');
    const order = s.fuelOrders[0];
    expect(order.unitCost).toBeCloseTo(piyasa * 0.92, 2);
  });

  it('hızlı lojistik %7 zam uygular', () => {
    const s = baseState();
    const piyasa = s.pricing.gasoline.todayWholesaleCost;
    placeFuelOrder(s, 'gasoline', 500, createEffects(), 'hizli_lojistik');
    const order = s.fuelOrders[0];
    expect(order.unitCost).toBeCloseTo(piyasa * 1.07, 2);
  });

  it('bilinmeyen tedarikçi id standart çarpan kullanır', () => {
    const s = baseState();
    const piyasa = s.pricing.gasoline.todayWholesaleCost;
    placeFuelOrder(s, 'gasoline', 500, createEffects(), 'YANLIS_ID');
    const order = s.fuelOrders[0];
    expect(order.unitCost).toBeCloseTo(piyasa, 2);
  });
});

// ─── Tedarikçi hız çarpanları ─────────────────────────────────────────────────

describe('placeFuelOrder — tedarikçi hız çarpanları', () => {
  const baseMin = GAME_CONFIG.economy.tankerSpeedSecondsMin;
  const baseMax = GAME_CONFIG.economy.tankerSpeedSecondsMax;

  it('hızlı lojistik standarttan daha kısa sürede teslim eder', () => {
    const std  = baseState();
    const hzl  = baseState();
    // Deterministik olmadığı için çok sayıda deneme; istatistiksel olarak
    // speedMultiplier 0.5 vs 1.0 arasındaki fark kaçamaz.
    let sumStd = 0, sumHzl = 0;
    for (let i = 0; i < 100; i++) {
      const s1 = baseState(); placeFuelOrder(s1, 'gasoline', 500, createEffects(), 'standart');
      const s2 = baseState(); placeFuelOrder(s2, 'gasoline', 500, createEffects(), 'hizli_lojistik');
      sumStd += s1.fuelOrders[0].totalDurationSeconds;
      sumHzl += s2.fuelOrders[0].totalDurationSeconds;
    }
    expect(sumHzl / 100).toBeLessThan(sumStd / 100);
  });

  it('toptancı depo standarttan daha uzun sürede teslim eder', () => {
    let sumStd = 0, sumTop = 0;
    for (let i = 0; i < 100; i++) {
      const s1 = baseState(); placeFuelOrder(s1, 'gasoline', 500, createEffects(), 'standart');
      const s2 = baseState(); placeFuelOrder(s2, 'gasoline', 500, createEffects(), 'toptan_depo');
      sumStd += s1.fuelOrders[0].totalDurationSeconds;
      sumTop += s2.fuelOrders[0].totalDurationSeconds;
    }
    expect(sumTop / 100).toBeGreaterThan(sumStd / 100);
  });
});

// ─── supplierId kaydı ────────────────────────────────────────────────────────

describe('placeFuelOrder — supplierId kaydı', () => {
  it("sipariş objesinde doğru supplierId saklar", () => {
    for (const sid of ['toptan_depo', 'standart', 'hizli_lojistik'] as const) {
      const s = baseState();
      placeFuelOrder(s, 'gasoline', 500, createEffects(), sid);
      expect(s.fuelOrders[0].supplierId).toBe(sid);
    }
  });
});

// ─── Alım Defteri ─────────────────────────────────────────────────────────────

describe('fuelPurchaseHistory — Alım Defteri', () => {
  /** Siparişi verer, tick'leyerek COMPLETED'a taşır. */
  function deliverOrder(
    s: GameState,
    fuelType: 'gasoline' | 'diesel' | 'lpg',
    liters: number,
    supplierId: string
  ) {
    // Sipariş öncesi tank kapasitesi yeterli olmalı
    s.tanks[fuelType].capacity = Math.max(s.tanks[fuelType].capacity, liters + 100);
    s.tanks[fuelType].stock    = 0;
    placeFuelOrder(s, fuelType, liters, createEffects(), supplierId);
    // TRAVELLING → QUEUED → UNLOADING → COMPLETED zinciri için çok sayıda küçük tick
    const maxTicks = 1000;
    for (let i = 0; i < maxTicks; i++) {
      runSimulationTick(s, 5, createEffects());
      const order = s.fuelOrders.find((o) => o.fuelType === fuelType && o.state !== 'COMPLETED');
      if (!order) break; // tamamlandı
    }
  }

  it('teslimat tamamlanınca fuelPurchaseHistory kaydı düşer', () => {
    const s = baseState();
    expect(s.fuelPurchaseHistory).toHaveLength(0);
    deliverOrder(s, 'gasoline', 500, 'standart');
    expect(s.fuelPurchaseHistory.length).toBeGreaterThanOrEqual(1);
  });

  it('kaydın alanları doğrudur', () => {
    const s = baseState();
    deliverOrder(s, 'diesel', 700, 'toptan_depo');
    expect(s.fuelPurchaseHistory.length).toBeGreaterThanOrEqual(1);
    const rec = s.fuelPurchaseHistory[0];
    expect(rec.fuelType).toBe('diesel');
    expect(rec.liters).toBe(700);
    expect(rec.supplierId).toBe('toptan_depo');
    expect(rec.totalCost).toBeGreaterThan(0);
    expect(rec.unitCost).toBeGreaterThan(0);
    expect(rec.day).toBe(s.dayState.currentDay);
  });

  it('birden fazla sipariş kaydı birikiyor', () => {
    const s = baseState();
    deliverOrder(s, 'gasoline', 500, 'standart');
    deliverOrder(s, 'diesel',   600, 'hizli_lojistik');
    expect(s.fuelPurchaseHistory.length).toBeGreaterThanOrEqual(2);
  });

  it('toptancı kaydı standarttan daha düşük unitCost içeriyor', () => {
    const s1 = baseState();
    const s2 = baseState();
    const baseCost = s1.pricing.gasoline.todayWholesaleCost;
    deliverOrder(s1, 'gasoline', 500, 'standart');
    deliverOrder(s2, 'gasoline', 500, 'toptan_depo');
    expect(s1.fuelPurchaseHistory.length).toBeGreaterThanOrEqual(1);
    expect(s2.fuelPurchaseHistory.length).toBeGreaterThanOrEqual(1);
    expect(s2.fuelPurchaseHistory[0].unitCost).toBeLessThan(s1.fuelPurchaseHistory[0].unitCost);
    expect(s2.fuelPurchaseHistory[0].unitCost).toBeCloseTo(baseCost * 0.92, 2);
  });
});

// ─── Başlangıç durumu ─────────────────────────────────────────────────────────

describe('initialState', () => {
  it("fuelPurchaseHistory alanı boş dizi olarak başlar", () => {
    const s = createInitialGameState();
    expect(s.fuelPurchaseHistory).toBeDefined();
    expect(Array.isArray(s.fuelPurchaseHistory)).toBe(true);
    expect(s.fuelPurchaseHistory).toHaveLength(0);
  });

  it("schemaVersion 6'dır", () => {
    const s = createInitialGameState();
    expect(s.schemaVersion).toBe(6);
  });
});

// ─── GAME_CONFIG tedarikçiler ──────────────────────────────────────────────

describe('GAME_CONFIG.suppliers', () => {
  it('tam olarak 3 tedarikçi var', () => {
    expect(GAME_CONFIG.suppliers).toHaveLength(3);
  });

  it('standart tedarikçi priceMultiplier 1.0', () => {
    const std = GAME_CONFIG.suppliers.find((s) => s.id === 'standart')!;
    expect(std.priceMultiplier).toBe(1.0);
    expect(std.speedMultiplier).toBe(1.0);
  });

  it('toptancı %8 ucuz ve yavaş', () => {
    const top = GAME_CONFIG.suppliers.find((s) => s.id === 'toptan_depo')!;
    expect(top.priceMultiplier).toBe(0.92);
    expect(top.speedMultiplier).toBeGreaterThan(1);
  });

  it('hızlı lojistik %7 pahalı ve hızlı', () => {
    const hzl = GAME_CONFIG.suppliers.find((s) => s.id === 'hizli_lojistik')!;
    expect(hzl.priceMultiplier).toBe(1.07);
    expect(hzl.speedMultiplier).toBeLessThan(1);
  });
});
