import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { evaluatePlacement, getFootprint } from '../domain/services/placement';
import {
  drivewayReserveRects,
  FORECOURT_FRONT,
  RESERVE_SETBACK
} from '../domain/services/simulationEngine';
import { GameState } from '../domain/types/gameState';
import {
  WELCOME_CARS,
  WELCOME_LAMPS,
  WELCOME_PLOT,
  WELCOME_PUMPS,
  WELCOME_SIGN,
  WELCOME_STRUCTURES,
  cardLeftFraction,
  lampArmDirection,
  stationScreenBand
} from '../rendering/welcomeLayout';

/**
 * Karşılama ekranındaki vitrin istasyon — Emre'nin yerleşim tarifi
 * (2026-09-03) ve oyunun kendi kuralları, sayıya çivilenmiş halde.
 *
 * Vitrin, oyunda kurulamayacak bir şey göstermez: her parça evaluatePlacement
 * sınavından geçer. Tarifin her maddesi de ayrı ayrı ölçülür ki bir sonraki
 * "şunu biraz kaydır" dokunuşu ötekini sessizce bozamasın.
 */
function emptyPlot(): GameState {
  const state = createInitialGameState();
  state.player.level = 99;
  state.buildings = {};
  state.pumps = {};
  return state;
}

const byType = (type: string) => {
  const found = WELCOME_STRUCTURES.find((b) => b.type === type);
  if (!found) throw new Error(`vitrinde ${type} yok`);
  return found;
};
const footprintOf = (b: { position: [number, number]; size: [number, number]; rotation: number }) =>
  getFootprint(b.position, b.size, b.rotation);

const PLOT = { minX: 0, maxX: WELCOME_PLOT.width, minZ: FORECOURT_FRONT, maxZ: WELCOME_PLOT.height };

describe('the welcome-screen station', () => {
  it('is buildable piece by piece under the game’s own placement rules', () => {
    const state = emptyPlot();

    for (const b of [...WELCOME_STRUCTURES, ...WELCOME_LAMPS]) {
      const verdict = evaluatePlacement(state, b.type, b.position, b.rotation);
      expect(verdict.valid, `${b.id} (${b.type}): ${verdict.reason ?? ''}`).toBe(true);
      state.buildings[b.id] = b;
    }
    for (const p of WELCOME_PUMPS) {
      const verdict = evaluatePlacement(state, 'pump_standard', p.position, p.rotation);
      expect(verdict.valid, `${p.id}: ${verdict.reason ?? ''}`).toBe(true);
      state.pumps[p.id] = p;
    }
    const sign = evaluatePlacement(state, 'price_sign', WELCOME_SIGN.position, 0);
    expect(sign.valid, sign.reason ?? '').toBe(true);
  });

  it('keeps every structure on the concrete', () => {
    for (const b of [...WELCOME_STRUCTURES, ...WELCOME_LAMPS]) {
      const f = footprintOf(b);
      expect(f.minX, b.id).toBeGreaterThanOrEqual(PLOT.minX);
      expect(f.maxX, b.id).toBeLessThanOrEqual(PLOT.maxX);
      expect(f.minZ, b.id).toBeGreaterThanOrEqual(PLOT.minZ);
      expect(f.maxZ, b.id).toBeLessThanOrEqual(PLOT.maxZ);
    }
  });

  it('puts the tank farm to the LEFT of the office (higher x), fronts in line', () => {
    const office = footprintOf(byType('office'));
    const tank = footprintOf(byType('tank_farm'));
    expect(tank.minX).toBe(office.maxX);
    expect(tank.minZ).toBe(office.minZ);
  });

  it('sets the DC charger and the air-water unit flush against the right kerb, side by side', () => {
    const charger = footprintOf(byType('ev_charger_dc'));
    const air = footprintOf(byType('air_water'));
    expect(charger.minX).toBe(0);
    expect(air.minX).toBe(0);
    // Yan yana: biri bitince öteki başlar, arada boşluk yok.
    expect(air.minZ === charger.maxZ || charger.minZ === air.maxZ).toBe(true);
    // Bay'i içe bakar — kaldırıma dönük bir bay arsanın dışına düşerdi.
    expect(byType('ev_charger_dc').rotation).toBe(0);
  });

  it('parks the car park against the left kerb, as far forward as the reserve allows', () => {
    const park = footprintOf(byType('car_park'));
    const lane = drivewayReserveRects(
      { ...emptyPlot(), station: { ...emptyPlot().station, plots: WELCOME_PLOT } },
      'near'
    ).find((r) => r.kind === 'lane')!;
    expect(park.maxX).toBe(WELCOME_PLOT.width);
    expect(park.minZ).toBe(lane.maxZ);
  });

  it('moves the bin to an edge, out of the middle', () => {
    const bin = footprintOf(byType('trash_can'));
    const onEdge =
      bin.minX === PLOT.minX || bin.maxX === PLOT.maxX || bin.minZ === PLOT.minZ || bin.maxZ === PLOT.maxZ;
    expect(onEdge).toBe(true);
  });

  it('has exactly two open islands (no canopy) with a clear gap between them', () => {
    expect(WELCOME_PUMPS).toHaveLength(2);
    // Sundurma arkadaki yapıları ve tabelalarını örtüyordu (Emre, 2026-09-03).
    for (const p of WELCOME_PUMPS) expect(p.hasCanopy, p.id).toBe(false);
    const [a, b] = WELCOME_PUMPS.map((p) => p.position[0]).sort((x, y) => x - y);
    // Ortadaki pompa kalktı: iki ada arasında en az bir ada boyu boşluk.
    expect(b - a).toBeGreaterThanOrEqual(6);
    // Totem tam o boşluğun altında görünür.
    expect(WELCOME_SIGN.position[0]).toBeGreaterThan(a);
    expect(WELCOME_SIGN.position[0]).toBeLessThan(b);
  });

  it('lines the lamps up along the frontage, evenly spaced, arms reaching into the forecourt', () => {
    expect(WELCOME_LAMPS.length).toBeGreaterThanOrEqual(3);
    const xs = WELCOME_LAMPS.map((l) => l.position[0]).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]);

    for (const lamp of WELCOME_LAMPS) {
      // Hepsi lamba payında: beton çizgisiyle araç bandı arasındaki hücre.
      const f = footprintOf(lamp);
      expect(f.minZ, lamp.id).toBeGreaterThanOrEqual(FORECOURT_FRONT);
      expect(f.maxZ, lamp.id).toBeLessThanOrEqual(FORECOURT_FRONT + RESERVE_SETBACK);
      // Kol önalana (+z) uzanır, yola ya da dışarıya değil.
      expect(lampArmDirection(lamp.rotation), lamp.id).toEqual([0, 1]);
    }
  });

  it('keeps every parked car on the concrete and off the driveway reserve', () => {
    const reserves = drivewayReserveRects(
      { ...emptyPlot(), station: { ...emptyPlot().station, plots: WELCOME_PLOT } },
      'near'
    );
    for (const car of WELCOME_CARS) {
      const [x, , z] = car.worldPosition;
      expect(x, car.id).toBeGreaterThan(PLOT.minX);
      expect(x, car.id).toBeLessThan(PLOT.maxX);
      expect(z, car.id).toBeGreaterThan(PLOT.minZ);
      expect(z, car.id).toBeLessThan(PLOT.maxZ);
      for (const r of reserves) {
        const inside = x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
        expect(inside, `${car.id} rezervde (${r.kind})`).toBe(false);
      }
    }
  });
});

describe('the welcome camera band', () => {
  it('keeps the whole station left of the licence card on every wide screen', () => {
    for (const width of [1024, 1200, 1366, 1470, 1600, 1920, 2560]) {
      const cardLeft = cardLeftFraction(width)!;
      const [left, right] = stationScreenBand(width);
      expect(left, `${width}`).toBeGreaterThan(0);
      expect(right, `${width}`).toBeLessThan(cardLeft);
      expect(right - left, `${width}`).toBeGreaterThan(0.4);
    }
  });

  it('centres the station under the card on narrow screens', () => {
    for (const width of [390, 768, 1023]) {
      expect(cardLeftFraction(width)).toBeNull();
      const [left, right] = stationScreenBand(width);
      expect((left + right) / 2).toBeCloseTo(0.5);
    }
  });
});
