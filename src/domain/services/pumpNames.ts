/**
 * What a pump is called to the player.
 *
 * Ids are for the code — pump_1 for the one the station starts with, then
 * random strings. A player reads "Pompa 3" (Emre, 2026-09-09: "pump_1"
 * looked wrong everywhere it showed). The number is given once, when the
 * pump is bought, and travels with it when it is moved; a save from before
 * numbers falls back to the order the pumps were put down in.
 */

import { GameState, PumpEntity } from '../types/gameState';

export function pumpNumber(state: GameState, pump: PumpEntity): number {
  if (pump.number !== undefined) return pump.number;
  return Object.keys(state.pumps).indexOf(pump.id) + 1;
}

export function pumpName(state: GameState, pumpOrId: PumpEntity | string): string {
  const pump = typeof pumpOrId === 'string' ? state.pumps[pumpOrId] : pumpOrId;
  if (!pump) return 'Pompa';
  return `Pompa ${pumpNumber(state, pump)}`;
}

/** The number the next pump bought will carry: one past the highest standing. */
export function nextPumpNumber(state: GameState): number {
  const pumps = Object.values(state.pumps);
  return pumps.reduce((max, p) => Math.max(max, pumpNumber(state, p)), 0) + 1;
}
