/**
 * What the catalogue will sell, and for how much, given what the station
 * already has (Emre, 2026-09-08: "sınırsız alınma olmasın", "bir sonrakinde
 * artsın").
 *
 * Two rules, both read from GAME_CONFIG.buildingRules: a cap on how many of
 * a thing may stand — per block, or on the whole station — and a price that
 * climbs with every unit already bought. The rest complex counts as the
 * shop, the restaurant, the café and the toilets of its block, because it is.
 */

import { GAME_CONFIG } from '../../config/gameConfig';
import { GameState } from '../types/gameState';
import { DrivewaySide, drivewaySideAt } from './simulationEngine';
import { REST_COMPLEX_ABSORBS } from './placement';

/** How many of this type stand on the station, or on one block of it. */
export function ownedCount(state: GameState, type: string, side?: DrivewaySide): number {
  const onSide = (z: number) => side === undefined || drivewaySideAt(z) === side;
  if (type === 'pump_standard') {
    return Object.values(state.pumps).filter((p) => onSide(p.position[1])).length;
  }
  const standsFor = REST_COMPLEX_ABSORBS.includes(type) ? [type, 'rest_complex'] : [type];
  return Object.values(state.buildings).filter(
    (b) => standsFor.includes(b.type) && onSide(b.position[1])
  ).length;
}

/** The catalogue price of the next unit, given how many are already owned. */
export function unitPrice(state: GameState, type: string): number {
  const catalog = GAME_CONFIG.buildings[type];
  if (!catalog) return 0;
  const rule = GAME_CONFIG.buildingRules[type];
  const growth = rule?.priceGrowth ?? GAME_CONFIG.economy.priceGrowthPerUnit;
  const owned = ownedCount(state, type);
  if (owned === 0) return catalog.price;
  return Math.round((catalog.price * Math.pow(growth, owned)) / 100) * 100;
}

/**
 * Why another one of these may not be built on this block, or null if it
 * may. The wording names the cap so the player knows whether the other
 * block is still open to them.
 */
export function buildLimitReason(state: GameState, type: string, side: DrivewaySide): string | null {
  const rule = GAME_CONFIG.buildingRules[type];
  if (!rule) return null;
  if (rule.maxTotal !== undefined && ownedCount(state, type) >= rule.maxTotal) {
    return rule.maxTotal === 1
      ? 'İstasyonda bundan yalnızca bir tane olabilir.'
      : `İstasyon sınırı: en fazla ${rule.maxTotal} tane.`;
  }
  if (rule.maxPerSide !== undefined && ownedCount(state, type, side) >= rule.maxPerSide) {
    return rule.maxPerSide === 1
      ? 'Bu arsada bundan zaten var; karşı arsaya kurulabilir.'
      : `Arsa sınırı: bu arsada en fazla ${rule.maxPerSide} tane.`;
  }
  return null;
}

/** Whether any block at all could still take one — what the catalogue card shows. */
export function catalogLimitReason(state: GameState, type: string): string | null {
  const near = buildLimitReason(state, type, 'near');
  const far = buildLimitReason(state, type, 'far');
  if (!near || !far) return null;
  const rule = GAME_CONFIG.buildingRules[type];
  if (rule?.maxTotal !== undefined) return near;
  return `Her iki arsada da sınır dolu (arsa başına ${rule?.maxPerSide ?? 1}).`;
}
