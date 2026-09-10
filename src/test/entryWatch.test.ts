import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  createEffects,
  runSimulationTick,
  blockedWays,
  hasWayIn,
  blockLayout,
  tankerRoute,
  placeFuelOrder
} from '../domain/services/simulationEngine';
import { evaluatePlacement, snapPlacement } from '../domain/services/placement';
import { GAME_CONFIG } from '../config/gameConfig';
import { GameState, VehicleEntity } from '../domain/types/gameState';

/**
 * Emre, 2026-09-09, canlı sürüm, 8. gün: iki gün boyunca tek bir araç
 * tesise girmedi. Pompa "Boşta" yazıyor, tabela "AÇIK", bildirim yok, yolda
 * herkes geçip gidiyor. Fiyatı dibe çekmek de bir şey değiştirmedi — çünkü
 * motor "bu bloğa girilemez" diyordu ve bunu söyleyen hiçbir şey yoktu.
 *
 * Bir istasyonu sessizce öldüren tek şey budur, ve oyuncunun tek başına
 * bulamayacağı tek şey de. Artık oyun söylüyor.
 */

function seedRandom(seed = 9): () => void {
  let value = seed;
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
  restore = null;
});

function station(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.level = 4;
  state.player.cash = 50000;
  return state;
}

/**
 * Girişle bekleme hattının arasına küçük bir yapı — yerleşim kuralını
 * ATLAYARAK, eski bir kaydın taşıdığı hâliyle. Kural artık buna izin vermiyor
 * (aşağıda ayrıca sınanıyor); motor ise böyle bir kayıtta bile bloğa kimseyi
 * sokmaz ve bunu söyler.
 */
function plantInTheWay(state: GameState, type: string, near: [number, number]): void {
  const at = snapPlacement(state, type, near);
  state.buildings[type] = {
    id: type,
    type,
    level: 1,
    position: at,
    rotation: 0,
    size: GAME_CONFIG.buildings[type].size,
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0
  } as GameState['buildings'][string];
}

function plantPoleInTheWay(state: GameState): void {
  plantInTheWay(state, 'light_pole', [2.5, 4.5]);
}

/** İstasyonu bu kadar saniye çalıştırır; bildirimleri ve sapan araçları toplar. */
function run(state: GameState, seconds: number) {
  const titles: string[] = [];
  const turnedIn = new Set<string>();
  for (let i = 0; i < seconds * 20; i++) {
    const effects = createEffects();
    runSimulationTick(state, 0.05, effects);
    for (const n of effects.notifications) titles.push(n.title);
    for (const v of Object.values(state.vehicles)) {
      if (v.state !== 'SPAWN' && v.state !== 'PASSING' && v.state !== 'DESPAWN') turnedIn.add(v.id);
    }
  }
  return { titles, arrivals: turnedIn.size };
}

describe('a station nobody can enter', () => {
  it('reads a healthy starting station as open for business', () => {
    const state = station();
    expect(blockedWays(state, 'near')).toEqual([]);
    expect(hasWayIn(state, blockLayout(state, 'near')!, 'near')).toBe(true);
  });

  it('is what one legally placed light pole in the wrong spot makes of it', () => {
    const state = station();
    plantPoleInTheWay(state);
    expect(hasWayIn(state, blockLayout(state, 'near')!, 'near')).toBe(false);
    expect(blockedWays(state, 'near')).toContain('CUSTOMERS');
  });

  it('is a placement the build rules now refuse, by name', () => {
    // The move Emre made on day 8, and the pole that would have done the
    // same: both refused before the money leaves the till. A spot that
    // leaves the way in open is still fine — the rule is about the way in,
    // not about small structures.
    const state = station();
    for (const [type, near] of [
      ['air_water', [2.5, 5]],
      ['light_pole', [2.5, 4.5]],
      ['trash_can', [3.5, 4.5]],
      ['decoration', [3, 5]]
    ] as Array<[string, [number, number]]>) {
      const at = snapPlacement(state, type, near);
      const verdict = evaluatePlacement(state, type, at, 0);
      expect(verdict.valid, `${type}@${at}`).toBe(false);
      expect(verdict.reason).toContain('girişi kapatıyor');
    }

    // Arsanın gerisinde, pompanın ve tank sahasının açığında: serbest.
    const clear = snapPlacement(state, 'air_water', [10.5, 12]);
    expect(evaluatePlacement(state, 'air_water', clear, 0).reason).toBeUndefined();
  });

  it('was, in the live game, one air & water unit beside the entrance', () => {
    // Emre'nin 8. gündeki istasyonu: direk masumdu, hava-su ünitesi satılınca
    // araçlar geri geldi. 1x2'lik bir servis kutusu, girişin dibinde.
    const state = station();
    plantInTheWay(state, 'air_water', [2.5, 5]);

    expect(blockedWays(state, 'near')).toContain('CUSTOMERS');
    const { titles, arrivals } = run(state, 120);
    expect(arrivals).toBe(0);
    expect(titles).toContain('Yol Kapalı');

    delete state.buildings.air_water;
    expect(run(state, 120).arrivals).toBeGreaterThan(0);
  });

  it('tells the player, once a day, instead of letting the road drive past in silence', () => {
    const state = station();
    plantPoleInTheWay(state);

    const { titles, arrivals } = run(state, 120);
    // The symptom the player saw: cars on the road, none of them turning in.
    expect(arrivals).toBe(0);
    // And now the game says so — exactly once, not every few seconds.
    expect(titles.filter((t) => t === 'Yol Kapalı')).toHaveLength(1);
  });

  it('explains when a limousine already at the entrance cannot manoeuvre to service', () => {
    const state = station();
    plantPoleInTheWay(state);
    const block = blockLayout(state, 'near')!;
    const limo: VehicleEntity = {
      id: 'limo', archetype: 'luxury', modelVariant: 'limousine', fuelType: 'gasoline',
      tankCapacity: 80, currentFuel: 20,
      request: {
        mode: 'LITERS', targetValue: 40, calculatedLiters: 40, calculatedPrice: 0,
        dispensedLiters: 0, isFinished: false
      },
      patience: 40, maxPatience: 40, satisfaction: 100,
      state: 'ROAD_APPROACH', targetPumpId: null, assignedActor: null,
      worldPosition: [block.entry.x, 0, block.laneZ], targetWaypoint: null, route: [],
      heading: 0, speed: 1, routeProgress: 0, waitingTimeSeconds: 0,
      shoppingIntent: false
    };
    state.vehicles = { limo };
    const effects = createEffects();

    runSimulationTick(state, 0.05, effects);

    expect(['EXIT', 'DESPAWN']).toContain(limo.state);
    expect(effects.notifications).toContainEqual(expect.objectContaining({
      title: 'Manevra Alanı Yetersiz',
      message: expect.stringContaining('Limuzin')
    }));
  });

  it('says nothing about a station that is simply closed or simply healthy', () => {
    const healthy = station();
    expect(run(healthy, 60).titles).not.toContain('Yol Kapalı');

    const shut = station();
    plantPoleInTheWay(shut);
    shut.station.open = false;
    expect(run(shut, 60).titles).not.toContain('Yol Kapalı');
  });

  it('refuses a structure that closes the way to a pump bay, by name', () => {
    const state = station();
    const at = snapPlacement(state, 'light_pole', [6.5, 4.5]);
    const verdict = evaluatePlacement(state, 'light_pole', at, 0);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('pompalara giden yolu');
  });

  it('keeps the tanker’s way to the farm open — the pole beside the tank farm', () => {
    // Emre, 2026-09-09: "yakıt tankının yanına aydınlatma direği koyduğumuzda
    // tanker gelmiyor, yolda gözükmüyor". The berth is behind the farm; a pole
    // in front of it took the lorry's only way round. The rule now says so
    // before the pole is planted, and a save that already has one is warned.
    // Emre's pump sold petrol and diesel; the rule only minds the fuels a
    // pump can actually put in a car.
    const state = station();
    state.pumps.pump_1.supportedFuels = ['gasoline', 'diesel', 'lpg'];
    const at = snapPlacement(state, 'light_pole', [13.5, 9.5]);
    const verdict = evaluatePlacement(state, 'light_pole', at, 0);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('tankerin yolunu kapatıyor');

    // Planted anyway (an old save): some fuel's lorry has no route — the three
    // berths sit abreast along the farm, so a pole can take one and spare
    // another — and the watch says so.
    plantInTheWay(state, 'light_pole', [13.5, 9.5]);
    const fuels = ['gasoline', 'diesel', 'lpg'] as const;
    const blocked = fuels.find((f) => tankerRoute(state, f) === null);
    expect(blocked, 'a fuel whose berth the pole took').toBeDefined();
    expect(blockedWays(state, 'near')).toContain('TANKER');
    expect(run(state, 60).titles).toContain('Yol Kapalı');

    // An order for that fuel never gets a lorry on the road...
    placeFuelOrder(state, blocked!, 500, createEffects());
    const order = state.fuelOrders[state.fuelOrders.length - 1];
    expect(order.fuelType).toBe(blocked);
    order.remainingSeconds = 1;
    run(state, 10);
    expect(order.truck).toBeUndefined();

    // ...and does the moment the pole is gone.
    delete state.buildings.light_pole;
    expect(tankerRoute(state, blocked!)).not.toBeNull();
    run(state, 10);
    expect(order.truck).toBeDefined();
  });

  it('reports the way back open once the obstacle is gone, and customers return', () => {
    const state = station();
    plantPoleInTheWay(state);
    run(state, 30);
    expect(state.dayState.entryWarnedDay).toBe(state.dayState.currentDay);

    delete state.buildings.light_pole;
    const { titles, arrivals } = run(state, 120);
    expect(titles).toContain('Yol Açıldı');
    expect(arrivals).toBeGreaterThan(0);
  });
});
