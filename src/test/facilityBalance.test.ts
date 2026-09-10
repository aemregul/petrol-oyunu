import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { createEffects, runSimulationTick } from '../domain/services/simulationEngine';
import { evaluatePlacement } from '../domain/services/placement';
import { GAME_CONFIG } from '../config/gameConfig';
import { stationBounds } from '../domain/services/land';
import { GameState, BuildingEntity } from '../domain/types/gameState';

/**
 * What the facilities earn, pinned (Emre, 2026-09-08; re-measured 2026-09-10).
 *
 * Measured at the starting station: one pump, one attendant, level 12, a day
 * with no road events, averaged over three days. There are two kinds of
 * building here and they earn in two different ways.
 *
 *  - The forecourt services — wash, tyres, oil — sell to the car at the pump,
 *    on the way out. They need no car park and never did.
 *  - The buildings people WALK INTO — shop, café, restaurant, toilet, hotel —
 *    are paid at their own door, one visitor at a time. Two things bring that
 *    visitor: a driver who leaves the car at the pump and walks over (one in
 *    five, PUMP_WALK_SHARE), and a driver who came for the building alone and
 *    parks. The second needs a car park.
 *
 * Money for a visit that never happened is gone (Emre, 2026-09-10): a driver
 * who finds no bay drives out and spends nothing, the way anyone does at a
 * full car park. So a walk-in building without a park still covers its keep
 * off pump trade, but slowly — and a park is the upgrade that pays it off in
 * a season or two. The hotel is the one that cannot live on pump trade at
 * all, and that is the point of it: nobody checks in leaving the car at a
 * pump. The toilet is kept for goodwill rather than the till.
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

function facilityDayNet(
  type: string,
  options: { park?: boolean } = {}
): { net: number; price: number; served: number; fromPump: number; fromPark: number } {
  const s = station();
  // The park goes down first, at the very back, so the facility gets the spot
  // it would have had anyway and the two measurements stay comparable.
  if (options.park && !place(s, 'park', 'car_park')) throw new Error('no room for a park');
  if (!place(s, 'x', type)) throw new Error(`no room for ${type}`);

  let revenue = 0;
  let cost = 0;
  let served = 0;
  let fromPump = 0;
  let fromPark = 0;
  for (let day = 0; day < SAMPLE_DAYS; day++) {
    runDay(s);
    const t = s.dayState.todayStats;
    revenue += t.marketRevenue;
    cost += t.marketCost;
    served += t.customersServed;
    fromPump += s.buildings.x.todayVisitsFromPump ?? 0;
    fromPark += s.buildings.x.todayVisitsFromPark ?? 0;
    Object.assign(t, { marketRevenue: 0, marketCost: 0, customersServed: 0 });
    Object.assign(s.buildings.x, { todayVisitsFromPump: 0, todayVisitsFromPark: 0 });
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
    served: served / SAMPLE_DAYS,
    fromPump: fromPump / SAMPLE_DAYS,
    fromPark: fromPark / SAMPLE_DAYS
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

  // The wash, the tyre bay and the oil bay sell at the pump. A car park adds
  // nothing to them, so they are the buildings a station can put up first.
  it.each([
    ['car_wash', 90],
    ['tyre_service', 55],
    ['oil_change', 60]
  ])('%s sells at the pump and pays for itself within %i days, park or no park', (type, maxDays) => {
    const { net, price, served } = facilityDayNet(type);
    expect(served).toBeGreaterThan(8);
    expect(net).toBeGreaterThan(0);
    expect(price / net).toBeLessThan(maxDays);
  });

  // A shop with no park lives on the one-in-five drivers who leave the car at
  // the pump and walk in. There is no ceiling on the payback here on purpose:
  // at the starting station that is a couple of visits a day and the answer
  // runs into the hundreds of days, which is exactly why a park is worth
  // buying. What must hold is that the trade is real — money over the upkeep,
  // and visitors who walked in from the pump rather than a figure credited
  // for a visit nobody made.
  it.each(['mini_market', 'cafe', 'restaurant'])(
    '%s covers its keep on pump trade alone, with no park at all',
    (type) => {
      const { net, served, fromPump, fromPark } = facilityDayNet(type);
      expect(served).toBeGreaterThan(8);
      expect(net).toBeGreaterThan(0);
      expect(fromPump).toBeGreaterThanOrEqual(1);
      expect(fromPark).toBe(0);
    }
  );

  it('keeps the toilet out of the red without asking it to pay for itself', () => {
    // Bought for the goodwill, not the till: it need only not lose money.
    expect(facilityDayNet('toilet').net).toBeGreaterThan(0);
  });

  it('leaves the hotel needing a car park, because nobody checks in from a pump', () => {
    // The one building the walk-from-the-pump trade cannot feed. Its keep is
    // real and its rooms stay empty until there is somewhere to leave the car.
    expect(facilityDayNet('hotel').net).toBeLessThan(0);
    expect(facilityDayNet('hotel', { park: true }).net).toBeGreaterThan(0);
  });

  // And this is what the park is for: the drivers who came for the building
  // and nothing else can finally get to its door.
  it.each([
    ['mini_market', 80],
    ['cafe', 130],
    ['restaurant', 90],
    ['hotel', 260],
    ['toilet', 400]
  ])('%s pays for itself within %i days once cars can park', (type, maxDays) => {
    const bare = facilityDayNet(type);
    const parked = facilityDayNet(type, { park: true });
    expect(parked.net).toBeGreaterThan(bare.net);
    expect(parked.fromPark).toBeGreaterThanOrEqual(1);
    expect(parked.price / parked.net).toBeLessThan(maxDays);
  });
});
