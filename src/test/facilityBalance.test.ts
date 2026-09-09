import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';
import { evaluatePlacement } from '../domain/services/placement';
import { GAME_CONFIG } from '../config/gameConfig';
import { stationBounds } from '../domain/services/land';
import { GameState, BuildingEntity } from '../domain/types/gameState';

/**
 * What the facilities earn, pinned (Emre, 2026-09-08). Measured at the
 * starting station — one pump, one attendant, no park — every facility
 * used to lose money against its own upkeep: three visits a day at 2024
 * prices. Spends are now 2026 prices, more drivers go in, and a driver who
 * cannot park still buys most of what they came for through the window. So
 * this is the floor: each building covers its keep on day one and pays for
 * itself in a season; a park the cars can reach, and the traffic a grown
 * station pulls, shorten that several times over. The toilet is the one
 * kept for goodwill rather than the till — it need only not lose money.
 */

let seed = 5;
let restore: (() => void) | null = null;
beforeEach(() => {
  seed = 5;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  });
  restore = () => spy.mockRestore();
});
afterEach(() => restore?.());

function attendant(state: GameState, id: string, pumpId: string): void {
  const tier = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];
  state.employees[id] = {
    id, name: id, role: 'PUMP_ATTENDANT', level: 1, wage: tier.dailyWage, assignedPumpId: pumpId,
    state: 'IDLE', serviceCount: 0, currentVehicleId: null, actionTimerSeconds: 0, worldPosition: [0, 0, 0]
  } as never;
}

/**
 * Puts the thing down at the back of the plot, where it blocks nobody.
 *
 * Meant literally now: the placement rules refuse a spot that would take the
 * tanker's berth or the customers' way in (Emre, 2026-09-09). A building the
 * starting plot cannot hold without doing one of those gets a third column of
 * land and goes at the back of that.
 */
function place(state: GameState, id: string, type: string): boolean {
  if (placeScanning(state, id, type, 15)) return true;
  for (const key of ['2,0', '2,1']) {
    state.station.plots.ownedParcels.push(key);
    state.station.plots.pavedParcels.push(key);
  }
  const bounds = stationBounds(state.station.plots.ownedParcels);
  state.station.plots.width = bounds.width;
  state.station.plots.height = bounds.height;
  return placeScanning(state, id, type, state.station.plots.width - 1);
}

function placeScanning(state: GameState, id: string, type: string, fromX: number): boolean {
  for (let z = 13; z >= 2; z -= 0.5) {
    for (let x = fromX; x >= 2; x -= 0.5) {
      if (!evaluatePlacement(state, type, [x, z], 0).valid) continue;
      const b: BuildingEntity = {
        id, type, level: 1, position: [x, z], rotation: 0, size: GAME_CONFIG.buildings[type].size,
        health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
      };
      const fc = GAME_CONFIG.facilities[type];
      if (fc) Object.assign(b, { till: 0, todayRevenue: 0, todayVisits: 0, tariff: fc.defaultTariff ?? 0 });
      state.buildings[id] = b;
      if (type === 'mini_market') { state.market.active = true; state.market.stock = 500; }
      return true;
    }
  }
  return false;
}

function runDay(state: GameState): void {
  const effects = createEffects();
  for (let i = 0; i < 200000 && !effects.dayEnded; i++) runSimulationTick(state, 0.1, effects);
}

function station(): GameState {
  const s = createInitialGameState();
  s.dayState.timeSpeed = 1;
  s.player.cash = 300000;
  s.player.level = 12;
  s.player.reputation = 4;
  attendant(s, 'e1', 'pump_1');
  // A day without the road's events: this measures the buildings, not the luck.
  s.dayState.eventsToday = 99;
  return s;
}

/**
 * The facility's own day: what it took less what that cost, less its keep.
 *
 * Averaged over three days. One day is a dozen customers, and a dozen coin
 * flips put the same market anywhere between forty and a hundred days of
 * payback — whichever way the road's dice fell. Three days is still a small
 * sample, but it measures the building rather than the morning.
 */
const SAMPLE_DAYS = 3;

function facilityDayNet(type: string): { net: number; price: number; served: number } {
  const s = station();
  // No park: this is the floor. Every visit is booked through the window
  // at the facility's no-park share; a park the cars can reach lifts it.
  if (!place(s, 'x', type)) throw new Error(`no room for ${type}`);

  let revenue = 0;
  let cost = 0;
  let served = 0;
  for (let day = 0; day < SAMPLE_DAYS; day++) {
    runDay(s);
    const t = s.dayState.todayStats;
    revenue += t.marketRevenue;
    cost += t.marketCost;
    served += t.customersServed;
    Object.assign(t, { marketRevenue: 0, marketCost: 0, customersServed: 0 });
    // Overnight: the tanks are refilled, or the sample measures a station
    // running dry rather than the building beside its pumps.
    for (const tank of Object.values(s.tanks)) tank.stock = tank.capacity;
    s.dayState.gameTime = 6;
    s.dayState.isDayEnding = false;
    s.dayState.isDayActive = true;
  }
  const upkeep = GAME_CONFIG.buildings[type].dailyUpkeep;
  return {
    net: (revenue - cost) / SAMPLE_DAYS - upkeep,
    price: GAME_CONFIG.buildings[type].price,
    served: served / SAMPLE_DAYS
  };
}

describe('facilities at 2026 prices', () => {
  it('charges what the street does', () => {
    expect(GAME_CONFIG.facilities.mini_market.avgSpend).toBe(300);
    expect(GAME_CONFIG.facilities.cafe.avgSpend).toBe(200);
    expect(GAME_CONFIG.facilities.restaurant.avgSpend).toBe(600);
    expect(GAME_CONFIG.facilities.hotel.tariffs?.map((t) => t.price)).toEqual([2000, 3000, 4500]);
    expect(GAME_CONFIG.facilities.toilet.tariffs?.map((t) => t.price)).toEqual([0, 15, 25]);
    // A toilet opens charging ₺15; free is a choice, not the default.
    expect(GAME_CONFIG.facilities.toilet.defaultTariff).toBe(1);
    expect(GAME_CONFIG.buildingEffects.oil_change.service?.avgSpend).toBe(2500);
    expect(GAME_CONFIG.buildingEffects.tyre_service.service?.avgSpend).toBe(1500);
    expect(GAME_CONFIG.buildingEffects.car_wash.service?.avgSpend).toBe(600);
  });

  it.each([
    ['toilet', 3000],
    ['mini_market', 90],
    ['cafe', 180],
    ['restaurant', 180],
    ['hotel', 400],
    ['car_wash', 60],
    ['tyre_service', 60],
    ['oil_change', 40]
  ])('%s pays its keep and, without a park, pays for itself within %i days', (type, maxDays) => {
    const { net, price, served } = facilityDayNet(type);
    expect(served).toBeGreaterThan(8);
    expect(net).toBeGreaterThan(0);
    expect(price / net).toBeLessThan(maxDays);
  });
});
