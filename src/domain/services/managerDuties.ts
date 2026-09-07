/**
 * The manager's job description, grade by grade.
 *
 * A duty is done when two things are true: the manager's grade includes it,
 * and the player has not switched it off. The toggles live in
 * managerSettings and default to on, so a freshly hired manager arrives with
 * the whole job and the player takes away what they do not want. The grade
 * gate is the harder wall: a duty the tier has not unlocked is not done
 * however the toggle reads, and the panel shows it locked.
 */

import { GAME_CONFIG, ManagerDuty, ManagerTierConfig } from '../../config/gameConfig';
import { GameState, ManagerAutomationSettings } from '../types/gameState';

export const MANAGER_MAX_LEVEL = GAME_CONFIG.employees.manager.tiers.length;

/** The grade of the manager on the books; 1 for a save that never had grades. */
export function managerLevel(state: GameState): number {
  const level = state.station.managerLevel ?? 1;
  return Math.min(MANAGER_MAX_LEVEL, Math.max(1, Math.floor(level)));
}

export function managerTier(state: GameState): ManagerTierConfig {
  return managerTierAt(managerLevel(state));
}

export function managerTierAt(level: number): ManagerTierConfig {
  const tiers = GAME_CONFIG.employees.manager.tiers;
  return tiers[Math.min(tiers.length, Math.max(1, level)) - 1];
}

/** What the manager costs per day at their current grade. */
export function managerDailyWage(state: GameState): number {
  if (!state.station.managerId) return 0;
  return managerTier(state).dailyWage;
}

/** The toggle in managerSettings that each duty answers to. */
export const MANAGER_DUTY_SETTING: Record<ManagerDuty, keyof ManagerAutomationSettings> = {
  collectTills: 'autoCollectTills',
  fuelOrder: 'autoFuelOrder',
  assignAttendants: 'autoAssignAttendants',
  maintenance: 'autoMaintenance',
  pricing: 'autoPricing',
  nightGridFill: 'nightGridFill',
  cleanStation: 'autoClean',
  repair: 'autoRepair',
  dealStock: 'dealStockUp'
};

/** The forecourt is swept once it has slipped below this. */
export const MANAGER_CLEAN_BELOW = 50;

/** Every duty, in the order the panel lists them: the grade that first offers each, then by name. */
export const MANAGER_DUTIES: ManagerDuty[] = [
  'collectTills',
  'fuelOrder',
  'assignAttendants',
  'maintenance',
  'pricing',
  'nightGridFill',
  'cleanStation',
  'repair',
  'dealStock'
];

/** The lowest grade that does this duty. */
export function dutyMinLevel(duty: ManagerDuty): number {
  const tier = GAME_CONFIG.employees.manager.tiers.find((t) => t.duties.includes(duty));
  return tier?.level ?? Number.POSITIVE_INFINITY;
}

export function dutyUnlocked(state: GameState, duty: ManagerDuty): boolean {
  return managerTier(state).duties.includes(duty);
}

/** Whether the player has this duty switched on. Absent reads as on. */
export function dutyEnabled(settings: ManagerAutomationSettings, duty: ManagerDuty): boolean {
  return settings[MANAGER_DUTY_SETTING[duty]] !== false;
}

/** Whether the manager will actually do this: on the books, graded for it, and told to. */
export function dutyActive(state: GameState, duty: ManagerDuty): boolean {
  if (!state.station.managerId) return false;
  return dutyUnlocked(state, duty) && dutyEnabled(state.managerSettings, duty);
}
