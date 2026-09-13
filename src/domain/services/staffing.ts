import type { GameState } from '../types/gameState';

/**
 * How many pump attendants a station can take on: one for every pump, and one
 * for every charging post — a post is a pump with a plug, and the same hand
 * serves it (Emre, 2026-09-07).
 *
 * Emre, 2026-09-13: "pompa sayısı kadar pompacı alma olsun, şu an sınırsız
 * alınıyor". The hire only asked whether the chosen pump already had someone
 * on it. An attendant taken off a pump, or left behind when a pump was sold,
 * stayed on the payroll with no pump at all, the pump read as unmanned, and
 * another could be hired for it — as many times as the player liked.
 */
export function attendantPlaces(state: GameState): number {
  const posts = Object.values(state.buildings).filter(
    (b) => b.type === 'ev_charger_ac' || b.type === 'ev_charger_dc'
  ).length;
  return Object.keys(state.pumps).length + posts;
}

/** Every attendant on the payroll, whether or not they stand at a pump. */
export function attendantsOnPayroll(state: GameState): number {
  return Object.values(state.employees).filter((e) => e.role === 'PUMP_ATTENDANT').length;
}

/**
 * Attendants on the payroll with no pump or post to stand at: taken off one,
 * or left behind when theirs was sold. They hold a place all the same.
 */
export function attendantsOffPost(state: GameState): number {
  return Object.values(state.employees).filter(
    (e) =>
      e.role === 'PUMP_ATTENDANT' &&
      !(e.assignedPumpId && (state.pumps[e.assignedPumpId] || state.buildings[e.assignedPumpId]))
  ).length;
}

/** True when there is no place left for another attendant. */
export function attendantPlacesFull(state: GameState): boolean {
  return attendantsOnPayroll(state) >= attendantPlaces(state);
}
