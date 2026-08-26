/**
 * Build placement rules: where a structure may legally go on the forecourt.
 *
 * Positions are grid coordinates and mark the CENTRE of a footprint, matching
 * how BuildPreviewMesh and BuildingMesh draw them.
 */

import { GameState } from '../types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
import { isFootprintOnOwnedLand, pavedFrontage } from './land';
import {
  BlockLayout,
  DrivewayRole,
  LANE_HALF_WIDTH,
  blockLayout,
  drivewaySideAt,
  WIDE_DRIVEWAY_WIDTH,
  drivewayMouths,
  drivewayRole,
  drivewayZ,
  frontageRow
} from './simulationEngine';

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
 * Pulls a candidate position onto the line the thing being built can actually
 * live on. Ordinary structures go wherever the pointer is; a driveway ramp is
 * pinned to a verge and only slides along the frontage, so dragging it up and
 * down the plot moves nothing.
 *
 * Which verge it lands on follows the pointer across the road: aim at the far
 * block and the ramp snaps to that block's own frontage.
 */
export function snapPlacement(
  state: GameState,
  buildingType: string,
  position: [number, number]
): [number, number] {
  const role = drivewayRole(buildingType);
  if (!role) return position;

  const side = drivewaySideAt(position[1]);
  const z = drivewayZ(side);
  const frontage = pavedFrontage(state.station.plots.pavedParcels, frontageRow(side));
  const half = WIDE_DRIVEWAY_WIDTH / 2;
  const x = Math.round(position[0]);

  if (!frontage) return [x, z];

  // Keep the whole mouth on concrete; a frontage narrower than the ramp
  // centres it and lets the validity check refuse the build.
  const min = frontage.minX + half;
  const max = frontage.maxX - half;
  return [max < min ? (frontage.minX + frontage.maxX) / 2 : clamp(x, min, max), z];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Where a wide ramp may go. It ignores the footprint rules entirely: it lives
 * on the verge, which is nobody's parcel, and the only thing it has to clear
 * is the other mouth on its own side of the road. They may sit flush against
 * each other or at opposite ends of the frontage — anywhere but overlapping.
 */
function evaluateDriveway(
  state: GameState,
  role: DrivewayRole,
  position: [number, number]
): PlacementResult {
  const side = drivewaySideAt(position[1]);

  if (Math.abs(position[1] - drivewayZ(side)) > 0.01) {
    return { valid: false, reason: 'Rampa yalnızca yol kenarına yerleşir.' };
  }

  if (side === 'far' && state.station.roadLevel < 2) {
    return { valid: false, reason: 'Yolun karşısı ancak çift şeritli yolla açılır.' };
  }

  const frontage = pavedFrontage(state.station.plots.pavedParcels, frontageRow(side));
  if (!frontage) {
    return { valid: false, reason: 'Önce yola bakan parsele beton dökmelisiniz.' };
  }

  const half = WIDE_DRIVEWAY_WIDTH / 2;
  if (position[0] - half < frontage.minX || position[0] + half > frontage.maxX) {
    return { valid: false, reason: 'Rampa betonun dışına taşıyor.' };
  }

  const other = drivewayMouths(state, side)[role === 'entry' ? 'exit' : 'entry'];
  if (Math.abs(position[0] - other.x) < half + other.width / 2 - 0.01) {
    return { valid: false, reason: 'Diğer rampanın üstüne geliyor.' };
  }

  return { valid: true };
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

  const role = drivewayRole(buildingType);
  if (role) return evaluateDriveway(state, role, position);

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
