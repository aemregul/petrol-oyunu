import { DepartureReason, GameState } from '../types/gameState';

/**
 * The day-end report (players, 2026-09-13): the cars that came, the ones
 * served and the ones lost, and what the day earned against what it cost.
 * Pure arithmetic over the state, so the report's numbers can be pinned in a
 * test and the net it shows is the net the books record.
 */

type DayStats = GameState['dayState']['todayStats'];

/** A driver who paid for fuel or a charge, however they felt about it. */
const SERVED_REASONS: ReadonlySet<DepartureReason> = new Set<DepartureReason>([
  'SERVED_TIP',
  'SERVED_GREAT',
  'SERVED_OK',
  'SERVED_POOR'
]);

export interface DayBooks {
  income: { fuel: number; market: number; tips: number; total: number };
  expenses: {
    fuel: number;
    market: number;
    wages: number;
    upkeep: number;
    energy: number;
    repairs: number;
    loans: number;
    total: number;
  };
  net: number;
}

/**
 * Income against expenses for one day's figures. Settling the day folds the
 * grid's bill into upkeep; it is drawn back out here so the report can name
 * it, and a day not yet settled still counts what the batteries cost so far.
 */
export function dayBooks(stats: DayStats): DayBooks {
  const energy = Math.round(stats.energyCost ?? 0);
  const upkeep = Math.max(0, stats.upkeep - energy);

  const income = {
    fuel: stats.fuelRevenue,
    market: stats.marketRevenue,
    tips: stats.tips,
    total: stats.fuelRevenue + stats.marketRevenue + stats.tips
  };
  const expenses = {
    fuel: stats.fuelCost,
    market: stats.marketCost,
    wages: stats.wages,
    upkeep,
    energy,
    repairs: stats.repairs,
    loans: stats.loanPayments,
    total:
      stats.fuelCost + stats.marketCost + stats.wages + upkeep + energy + stats.repairs + stats.loanPayments
  };

  return { income, expenses, net: income.total - expenses.total };
}

export interface DayReport extends DayBooks {
  day: number;
  /** Drivers who chose to stop; null for a day begun before they were counted. */
  arrivals: number | null;
  /** Paid for fuel or a charge. */
  served: number;
  /** Came for a building and had the visit. */
  visited: number;
  /** Left without what they came for, from the road or off the forecourt. */
  lost: number;
  /** The reasons behind `lost`, most common first. */
  lostBy: Array<{ why: DepartureReason; count: number }>;
  /** Customers still on the plot, who carry on into the next morning. */
  stillHere: number;
  averageScore: number | null;
  cash: { opening: number | null; now: number };
  reputation: { opening: number | null; now: number };
  missedLoanPayments: number;
}

export function dayReport(state: GameState): DayReport {
  const stats = state.dayState.todayStats;
  const departures = stats.departures;

  const lostBy: DayReport['lostBy'] = [];
  let lost: number;
  if (departures) {
    for (const [why, count] of Object.entries(departures) as Array<[DepartureReason, number]>) {
      if (!count || SERVED_REASONS.has(why) || why === 'VISITED') continue;
      lostBy.push({ why, count });
    }
    lostBy.sort((a, b) => b.count - a.count);
    lost = lostBy.reduce((sum, entry) => sum + entry.count, 0);
  } else {
    // A day begun before departures were tallied has only the two old counters.
    lost = stats.customersLost + (stats.customersTurnedAway ?? 0);
  }

  const stillHere = Object.values(state.vehicles).filter(
    (v) => v.state !== 'PASSING' && v.state !== 'DESPAWN' && !v.departureReason
  ).length;

  return {
    ...dayBooks(stats),
    day: state.dayState.currentDay,
    arrivals: stats.arrivals ?? null,
    served: stats.customersServed,
    visited: departures?.VISITED ?? 0,
    lost,
    lostBy,
    stillHere,
    averageScore: stats.customersServed > 0 ? stats.serviceScoreSum / stats.customersServed : null,
    cash: { opening: stats.openingCash ?? null, now: state.player.cash },
    reputation: { opening: stats.openingReputation ?? null, now: state.player.reputation },
    missedLoanPayments: stats.missedLoanPayments ?? 0
  };
}
