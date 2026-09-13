import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { useGameStore } from '../store/gameStore';
import { ATTENDANT_HIRE_LEVEL, GAME_CONFIG } from '../config/gameConfig';
import { chainStatus } from '../domain/services/missionChain';
import {
  applyLevelProgression,
  createEffects,
  generateDailyMissions,
  litersOnOrder,
  orderableLiters,
  runSimulationTick,
  wholesaleNow
} from '../domain/services/simulationEngine';
import { evaluatePlacement } from '../domain/services/placement';
import { TransactionService } from '../domain/services/TransactionService';
import { BuildingEntity, GameState } from '../domain/types/gameState';

/**
 * Emre, 2026-09-12: "seviye çok hızlı atlanıyor ancak yapı yapmaya para
 * yetmiyor … pompa 3. seviyede açılıyor, biz 8'e kadar 2. pompayı yaptıracak
 * para biriktiremiyoruz". Measured on a fresh save played carefully: the
 * second pump the mission chain offers at level 3 was affordable only at level
 * 7 or 8, forty to ninety minutes on, and level 10 came in an hour and a half.
 * The money was left as it was — the game is not meant to get easier — and the
 * levels were spaced out to it instead.
 */

afterEach(() => vi.restoreAllMocks());

function seeded(start: number): void {
  let seed = start >>> 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  });
}

/** The first spot the placement rules allow, working in from the back of the plot. */
function place(state: GameState, type: string): boolean {
  for (let z = state.station.plots.height - 1; z >= 2; z -= 0.5) {
    for (let x = state.station.plots.width - 1; x >= 2; x -= 0.5) {
      if (!evaluatePlacement(state, type, [x, z], 0).valid) continue;
      const conf = GAME_CONFIG.buildings[type];
      state.buildings[`b_${type}`] = {
        id: `b_${type}`, type, level: 1, position: [x, z], rotation: 0, size: conf.size,
        health: 100, constructionState: 'ACTIVE', builtAtTimestamp: 0
      } as BuildingEntity;
      return true;
    }
  }
  return false;
}

interface Moment {
  level: number;
  xp: number;
  day: number;
}

/**
 * A fresh save played the way the chain asks. Every car is served — a stand-in
 * attendant does the pouring the player does by hand, and draws a wage only
 * once the game lets one be hired. Tankers are ordered as far as the till
 * allows, the forecourt is swept, a worn pump is mended, every goal is
 * claimed, and whatever the chain asks for is bought as soon as the money is
 * there, keeping back half of yesterday's fuel bill before anything dear.
 */
function playUntilSecondPump(maxDays: number): { pump: Moment | null; secondLevelDay: number | null } {
  let s = createInitialGameState();
  s.dayState.timeSpeed = 1;
  s.player.statistics.priceChanges = 1;
  s.employees = {
    me: {
      id: 'me', name: 'Oyuncu', role: 'PUMP_ATTENDANT', level: 1, wage: 0, assignedPumpId: 'pump_1',
      state: 'IDLE', serviceCount: 0, currentVehicleId: null, actionTimerSeconds: 0, worldPosition: [12, 0, 10]
    }
  } as never;
  s.pumps.pump_1.employeeId = 'me';
  generateDailyMissions(s);

  function act<T>(fn: (api: ReturnType<typeof useGameStore.getState>) => T): T {
    useGameStore.setState({ gameState: s });
    const out = fn(useGameStore.getState());
    s = useGameStore.getState().gameState;
    return out;
  }

  const tier = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];
  let hired = false;
  let fuelBillToday = 0;
  let fuelBillYesterday = 0;
  let secondLevelDay: number | null = null;
  const reserve = (cost: number) => (cost <= 5000 ? 2000 : Math.max(10000, fuelBillYesterday / 2));
  const lastDay = s.dayState.currentDay + maxDays;

  for (let tick = 1; s.dayState.currentDay < lastDay; tick++) {
    const effects = createEffects();
    runSimulationTick(s, 0.2, effects);
    if (effects.dayEnded) {
      act((a) => {
        a.endDayAndShowReport();
        a.startNextDay();
      });
      fuelBillYesterday = fuelBillToday;
      fuelBillToday = 0;
    }
    if (secondLevelDay === null && s.player.level >= 2) secondLevelDay = s.dayState.currentDay;
    // The player looks up from the pump once a game hour.
    if (tick % 50 !== 0) continue;

    const tank = s.tanks.gasoline;
    if (tank.stock + litersOnOrder(s, 'gasoline') < tank.capacity / 2) {
      const fuel = GAME_CONFIG.fuels.gasoline;
      const till = Math.floor((s.player.cash - 1000 - fuel.deliveryFee) / wholesaleNow(s, 'gasoline') / 100) * 100;
      const liters = Math.min(Math.floor(orderableLiters(s, 'gasoline') / 100) * 100, till);
      const before = s.player.cash;
      if (liters >= fuel.orderMinLiters && act((a) => a.orderFuel('gasoline', liters))) {
        fuelBillToday += before - s.player.cash;
      }
    }
    if (s.station.cleanliness < 70) act((a) => a.cleanStation());
    if (s.pumps.pump_1.state === 'BROKEN' || s.pumps.pump_1.health < 40) act((a) => a.repairPump('pump_1'));
    for (const mission of s.missions) {
      if (mission.completed && !mission.claimed) act((a) => a.claimMissionReward(mission.id));
    }

    const status = chainStatus(s);
    if (status && !status.locked) {
      const { id, builds } = status.step;
      if (id === 'hire_attendant' && !hired && s.player.cash >= tier.hireCost + reserve(tier.hireCost)) {
        TransactionService.executeCashTransaction(s, { type: 'WAGE_PAYMENT', amount: -tier.hireCost, description: 'Pompacı' });
        (s.employees as Record<string, { wage: number }>).me.wage = tier.dailyWage;
        hired = true;
      } else if (id === 'second_pump') {
        const price = GAME_CONFIG.buildings.pump_standard.price;
        if (s.player.cash >= price + reserve(price)) {
          return { pump: { level: s.player.level, xp: s.player.xp, day: s.dayState.currentDay }, secondLevelDay };
        }
      } else if (builds && !status.complete) {
        const price = GAME_CONFIG.buildings[builds].price;
        if (s.player.cash >= price + reserve(price) && place(s, builds)) {
          TransactionService.executeCashTransaction(s, { type: 'BUILD', amount: -price, description: builds });
          s.player.xp += Math.min(150, Math.round((price / 1000) * 3));
          applyLevelProgression(s, createEffects());
        }
      }
    }
    for (let claimed = 0; claimed < 5; claimed++) {
      const open = chainStatus(s);
      if (!open?.complete || (open.step.id === 'hire_attendant' && !hired)) break;
      act((a) => a.claimChainReward());
    }
  }
  return { pump: null, secondLevelDay };
}

describe('levels and money keep pace', () => {
  it('lets a careful player afford the second pump within the level after the one that offers it', () => {
    seeded(11);
    const { pump, secondLevelDay } = playUntilSecondPump(30);

    // The first level still comes on the first day: the opening is not slowed.
    expect(secondLevelDay).toBe(1);
    expect(pump, 'the second pump was never affordable').not.toBeNull();
    // Offered once the attendant is hired, at level 3; bought before level 5.
    // It was bought at level 7.
    expect(pump!.level).toBeGreaterThanOrEqual(ATTENDANT_HIRE_LEVEL);
    expect(pump!.level).toBeLessThan(5);
  }, 60_000);
});
