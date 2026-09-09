import { describe, it, expect, vi } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  createEffects,
  runSimulationTick,
  vehicleBodyHalfExtents
} from '../domain/services/simulationEngine';
import { evaluatePlacement, snapPlacement } from '../domain/services/placement';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState, VehicleEntity } from '../domain/types/gameState';

/**
 * Emre, 2026-09-09 (canlı sürümün ilk hatası): "iki araba üst üste kaldı".
 *
 * Servisi biten araç pompayı bırakır ve yola çıkar — ama bay'den ÇIKMASI bir
 * sonraki birkaç saniyeye yayılır, kapalı bir düzende hiç olmayabilir: çıkış
 * rotası aracı olduğu yerde döndürüp kuyruğunu adaya sokuyorsa katı yapı
 * kuralı her adımı geri alır ve müşteri bay'de taşlaşır. Serbest kalan pompa
 * bu arada sıradakine verildiğinden — ve önalanda araçlar birbirine hayalet
 * olduğundan — yeni müşteri duran aracın tam ÜSTÜNE yanaşıyordu.
 *
 * Buradaki kural tek cümle: bir bay'de aynı anda iki gövde durmaz.
 */

/** İki yönelmiş araç gövdesi kesişiyor mu (ayıran eksen yöntemi). */
function bodiesOverlap(a: VehicleEntity, b: VehicleEntity): boolean {
  const frame = (v: VehicleEntity) => ({
    body: vehicleBodyHalfExtents(v),
    ahead: { x: Math.sin(v.heading), z: Math.cos(v.heading) },
    across: { x: Math.cos(v.heading), z: -Math.sin(v.heading) }
  });
  const A = frame(a);
  const B = frame(b);
  const dx = b.worldPosition[0] - a.worldPosition[0];
  const dz = b.worldPosition[2] - a.worldPosition[2];

  // Santimlik sürtünme çakışma sayılmaz: kuyruk kuyruğa duran iki araç
  // birbirine değebilir, üst üste binemez.
  const margin = 0.12;
  const apart = (axis: { x: number; z: number }) => {
    const reach = (f: typeof A) =>
      Math.abs(f.ahead.x * axis.x + f.ahead.z * axis.z) * f.body.length +
      Math.abs(f.across.x * axis.x + f.across.z * axis.z) * f.body.width;
    return Math.abs(dx * axis.x + dz * axis.z) >= reach(A) + reach(B) - margin * 2;
  };

  return !(apart(A.ahead) || apart(A.across) || apart(B.ahead) || apart(B.across));
}

/**
 * Pompa başında duran araç: üstüne gelinmemesi gereken araç. OPTIONAL_SHOP
 * listede yok — alışverişe kalan sürücü arabasını park yerine de bırakmış
 * olabilir, o zaman aracın durduğu yer bay değildir.
 */
const BEING_SERVED = ['AT_PUMP', 'REQUEST', 'FUELING', 'PAYMENT'];

/**
 * İstasyonu verilen süre kadar çalıştırır ve pompa başında ÜST ÜSTE ve
 * KIPIRDAMADAN duran araç çiftlerini toplar. Geçerken birbirinin içinden
 * süzülen araçlar (önalan kuralı gereği hayalettirler) sayılmaz — sayılan,
 * üç saniye boyunca aynı yerde donmuş çifttir: oyuncunun ekran görüntüsü.
 */
function stackedAtBay(state: GameState, seconds: number): string[] {
  const effects = createEffects();
  const found: string[] = [];
  const held = new Map<string, number>();
  const previous = new Map<string, [number, number]>();

  for (let tick = 0; tick < seconds * 20; tick++) {
    runSimulationTick(state, 0.05, effects);

    const vehicles = Object.values(state.vehicles);
    const still = new Map<string, boolean>();
    for (const v of vehicles) {
      const was = previous.get(v.id);
      still.set(
        v.id,
        !!was && Math.hypot(v.worldPosition[0] - was[0], v.worldPosition[2] - was[1]) < 0.002
      );
      previous.set(v.id, [v.worldPosition[0], v.worldPosition[2]]);
    }

    const seen = new Set<string>();
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        const one = vehicles[i];
        const two = vehicles[j];
        if (!BEING_SERVED.includes(one.state) && !BEING_SERVED.includes(two.state)) continue;
        if (!still.get(one.id) || !still.get(two.id)) continue;
        if (!bodiesOverlap(one, two)) continue;

        const key = [one.id, two.id].sort().join('|');
        seen.add(key);
        const ticks = (held.get(key) ?? 0) + 1;
        held.set(key, ticks);
        if (ticks === 60) {
          found.push(
            `${one.state} @ ${one.worldPosition[0].toFixed(2)},${one.worldPosition[2].toFixed(2)}` +
              ` <-> ${two.state} @ ${two.worldPosition[0].toFixed(2)},${two.worldPosition[2].toFixed(2)}`
          );
        }
      }
    }
    for (const key of [...held.keys()]) if (!seen.has(key)) held.delete(key);
  }

  return found;
}

function seeded(seed: number): { rnd: () => number; restore: () => void } {
  let value = seed;
  const rnd = () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
  const spy = vi.spyOn(Math, 'random').mockImplementation(rnd);
  return { rnd, restore: () => spy.mockRestore() };
}

function ownWholePlot(state: GameState, cols: number, rows: number): void {
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r <= rows; r++) {
      const key = `${c},${r}`;
      if (!state.station.plots.ownedParcels.includes(key)) state.station.plots.ownedParcels.push(key);
      if (!state.station.plots.pavedParcels.includes(key)) state.station.plots.pavedParcels.push(key);
    }
  }
  state.station.plots.width = (cols + 1) * 8;
  state.station.plots.height = (rows + 1) * 7;
}

function busyStation(state: GameState): void {
  state.dayState.timeSpeed = 1;
  state.player.level = 20;
  state.player.reputation = 5;
  state.player.cash = 9_000_000;
  state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.75;
}

/**
 * Burnu kapalı bir bay: pompa çeyrek dönük, aracın çıkış doğrultusunda tank
 * çiftliği duruyor. Düz çıkış hamlesi bir yapıyla kesildiğinde ayrılan araç
 * bay'de donuyor, pompa ise sıradakine veriliyordu.
 */
function pumpWithBlockedNose(): GameState {
  const state = createInitialGameState();
  busyStation(state);
  ownWholePlot(state, 3, 3);

  const proto = Object.values(state.pumps)[0];
  state.pumps = {
    p0: { ...proto, id: 'p0', position: [11.5, 12], rotation: 90, currentVehicleId: null, employeeId: null }
  };
  return state;
}

describe('two cars at one bay', () => {
  it('never lets a second car pull into a bay that still has a car standing in it', () => {
    const { restore } = seeded(5);
    try {
      expect(stackedAtBay(pumpWithBlockedNose(), 180)).toEqual([]);
    } finally {
      restore();
    }
  }, 60_000);

  it('does not send a car through a neighbouring island on the way to its own bay', () => {
    // Dealt by the fuzz below (seed 23, layout 6): three turned pumps, two of
    // them side by side. The car bound for the back one lined up a car's
    // length short of its bay — straight through the front one's island —
    // and stood inside that island's customer until the twenty-second valve.
    const { restore } = seeded(5);
    try {
      const state = createInitialGameState();
      busyStation(state);
      ownWholePlot(state, 2, 2);
      const proto = Object.values(state.pumps)[0];
      state.pumps = {};
      for (const [id, position] of [
        ['p0', [17.5, 10]],
        ['p1', [15.5, 7]],
        ['p2', [11.5, 8]]
      ] as Array<[string, [number, number]]>) {
        state.pumps[id] = { ...proto, id, position, rotation: 90, currentVehicleId: null, employeeId: null };
      }
      for (const [type, position] of [
        ['car_wash', [12, 11.5]],
        ['tyre_service', [20.5, 5.5]]
      ] as Array<[string, [number, number]]>) {
        state.buildings[`r_${type}`] = {
          id: `r_${type}`,
          type,
          level: 1,
          position,
          rotation: 0,
          size: GAME_CONFIG.buildings[type].size,
          health: 100,
          constructionState: 'ACTIVE',
          builtAtTimestamp: 0
        } as GameState['buildings'][string];
      }
      expect(stackedAtBay(state, 150)).toEqual([]);
    } finally {
      restore();
    }
  }, 60_000);

  it('holds the same rule on forecourts nobody designed', () => {
    const { rnd, restore } = seeded(23);
    try {
      const broken: string[] = [];

      for (let layout = 0; layout < 8; layout++) {
        const state = createInitialGameState();
        busyStation(state);
        const cols = 2 + Math.floor(rnd() * 2);
        const rows = 2 + Math.floor(rnd() * 2);
        ownWholePlot(state, cols, rows);

        const proto = Object.values(state.pumps)[0];
        state.pumps = {};
        for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) {
          for (let tries = 0; tries < 40; tries++) {
            const rotation = rnd() < 0.5 ? 0 : 90;
            const at = snapPlacement(
              state,
              'pump_standard',
              [
                4 + Math.floor(rnd() * (state.station.plots.width - 8)),
                6 + Math.floor(rnd() * (state.station.plots.height - 9))
              ],
              rotation
            );
            if (!evaluatePlacement(state, 'pump_standard', at, rotation).valid) continue;
            state.pumps[`p${i}`] = {
              ...proto,
              id: `p${i}`,
              position: at,
              rotation,
              currentVehicleId: null,
              employeeId: null
            };
            break;
          }
        }

        const types = ['toilet', 'mini_market', 'cafe', 'car_wash', 'tyre_service', 'car_park'];
        for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) {
          const type = types[Math.floor(rnd() * types.length)];
          if (state.buildings[`r_${type}`]) continue;
          for (let tries = 0; tries < 40; tries++) {
            const at = snapPlacement(state, type, [
              2 + Math.floor(rnd() * (state.station.plots.width - 4)),
              2 + Math.floor(rnd() * (state.station.plots.height - 4))
            ]);
            if (!evaluatePlacement(state, type, at, 0).valid) continue;
            state.buildings[`r_${type}`] = {
              id: `r_${type}`,
              type,
              level: 1,
              position: at,
              rotation: 0,
              size: GAME_CONFIG.buildings[type].size,
              health: 100,
              constructionState: 'ACTIVE',
              builtAtTimestamp: 0
            } as GameState['buildings'][string];
            break;
          }
        }

        // Kırıldığında düzenin kendisi de rapora girer: bir fuzz testinin
        // kırıldığı arsayı yeniden kurabilmek, çıktısının yarısı kadar değerli.
        const stacked = stackedAtBay(state, 150);
        if (stacked.length > 0) {
          const pumps = Object.values(state.pumps)
            .map((p) => `${p.id}@${p.position.join(',')}r${p.rotation}`)
            .join(' ');
          const built = Object.values(state.buildings)
            .map((b) => `${b.type}@${b.position.join(',')}`)
            .join(' ');
          broken.push(`düzen ${layout}: ${stacked.join(' ; ')} | pompa ${pumps} | yapı ${built}`);
        }
      }

      expect(broken).toEqual([]);
    } finally {
      restore();
    }
  }, 180_000);
});
