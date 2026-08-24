/**
 * Build placement rules: where a structure may legally go on the forecourt.
 *
 * Positions are grid coordinates and mark the CENTRE of a footprint, matching
 * how BuildPreviewMesh and BuildingMesh draw them.
 */

import { GameState } from '../types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
import { isFootprintOnOwnedLand } from './land';

export interface Footprint {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface PlacementResult {
  valid: boolean;
  reason?: string;
}

export function getFootprint(
  position: [number, number],
  size: [number, number],
  rotation: number
): Footprint {
  // A quarter turn swaps the footprint's width and depth.
  const turned = rotation === 90 || rotation === 270;
  const width = turned ? size[1] : size[0];
  const depth = turned ? size[0] : size[1];

  return {
    minX: position[0] - width / 2,
    minZ: position[1] - depth / 2,
    maxX: position[0] + width / 2,
    maxZ: position[1] + depth / 2
  };
}

function overlaps(a: Footprint, b: Footprint): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

/** Every footprint already occupied on the lot. */
export function occupiedFootprints(
  state: GameState,
  ignoreId?: string
): Array<{ id: string; name: string; footprint: Footprint }> {
  const taken: Array<{ id: string; name: string; footprint: Footprint }> = [];

  for (const building of Object.values(state.buildings)) {
    if (building.id === ignoreId) continue;
    const conf = GAME_CONFIG.buildings[building.type];
    taken.push({
      id: building.id,
      name: conf?.name || building.type,
      footprint: getFootprint(building.position, building.size, building.rotation)
    });
  }

  for (const pump of Object.values(state.pumps)) {
    if (pump.id === ignoreId) continue;
    taken.push({
      id: pump.id,
      name: 'Pompa',
      footprint: getFootprint(
        pump.position,
        GAME_CONFIG.buildings.pump_standard.size,
        pump.rotation
      )
    });
  }

  return taken;
}

/**
 * Checks a candidate placement. Plot expansions are exempt from the footprint
 * rules: they buy land rather than occupying it.
 */
export function evaluatePlacement(
  state: GameState,
  buildingType: string,
  position: [number, number],
  rotation: number
): PlacementResult {
  const catalog = GAME_CONFIG.buildings[buildingType];
  if (!catalog) return { valid: false, reason: 'Bilinmeyen yapı türü.' };

  if (state.player.level < catalog.unlockLevel) {
    return { valid: false, reason: `Seviye ${catalog.unlockLevel} gerekiyor.` };
  }

  const footprint = getFootprint(position, catalog.size, rotation);

  if (!isFootprintOnOwnedLand(state.station.plots.ownedParcels, footprint)) {
    return { valid: false, reason: 'Burası sahip olduğunuz arsanın dışında.' };
  }

  if (!isFootprintOnOwnedLand(state.station.plots.pavedParcels, footprint)) {
    return { valid: false, reason: 'Önce bu parsele beton dökmelisiniz.' };
  }

  for (const taken of occupiedFootprints(state)) {
    if (overlaps(footprint, taken.footprint)) {
      return { valid: false, reason: `${taken.name} ile çakışıyor.` };
    }
  }

  return { valid: true };
}
