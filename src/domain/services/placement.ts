/**
 * Build placement rules: where a structure may legally go on the forecourt.
 *
 * Positions are grid coordinates and mark the CENTRE of a footprint, matching
 * how BuildPreviewMesh and BuildingMesh draw them.
 */

import { GameState } from '../types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
import { isFootprintOnOwnedLand, ownedBounds, pavedFrontage } from './land';
import {
  LAYOUT,
  DrivewayRole,
  DrivewaySide,
  WIDE_DRIVEWAY_WIDTH,
  drivewayMouths,
  drivewayRole,
  drivewaySideAt,
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
 * What a rest complex takes the place of. It is one roof over the shop, the
 * restaurant, the café and the toilets, so building one absorbs whichever of
 * those the player already has on that block rather than standing beside them.
 *
 * It can also be bought outright, with none of them present — that is what the
 * price is for, and it is how the block across the road gets served without
 * having to build the whole parade over there first.
 */
export const REST_COMPLEX_ABSORBS = ['mini_market', 'restaurant', 'cafe', 'toilet'];

/** The buildings a rest complex placed on this side would replace. */
export function absorbedByRestComplex(
  state: GameState,
  side: DrivewaySide
): Array<{ id: string; name: string }> {
  return Object.values(state.buildings)
    .filter(
      (b) =>
        REST_COMPLEX_ABSORBS.includes(b.type) && drivewaySideAt(b.position[1]) === side
    )
    .map((b) => ({ id: b.id, name: GAME_CONFIG.buildings[b.type]?.name ?? b.type }));
}

/** How far outside the plot a roadside sign may stand, in grid units. */
export const PYLON_REACH = 2;

/**
 * A sign may sit on the plot or just outside it, but not out in the country
 * and never on the carriageway — a sign in the middle of the road is not
 * advertising, it is an obstruction.
 */
function evaluateRoadsideSign(state: GameState, footprint: Footprint): PlacementResult {
  const owned = ownedBounds(state.station.plots.ownedParcels);

  const outside =
    Math.max(
      owned.minX - footprint.minX,
      footprint.maxX - owned.width,
      owned.minZ - footprint.minZ,
      footprint.maxZ - owned.height
    );

  if (outside > PYLON_REACH) {
    return { valid: false, reason: `Tabela arsanın en fazla ${PYLON_REACH} birim dışına kurulabilir.` };
  }

  // Keep it off both carriageways and the median between them.
  const roadTop = LAYOUT.roadZ + LAYOUT.roadHalfWidth;
  const roadBottom =
    LAYOUT.roadZ - 2 * LAYOUT.roadHalfWidth - LAYOUT.medianWidth - LAYOUT.roadHalfWidth;
  if (footprint.minZ < roadTop && footprint.maxZ > roadBottom) {
    return { valid: false, reason: 'Tabela yolun üzerine kurulamaz.' };
  }

  for (const taken of occupiedFootprints(state)) {
    if (overlaps(footprint, taken.footprint)) {
      return { valid: false, reason: `${taken.name} ile çakışıyor.` };
    }
  }

  return { valid: true };
}

/** True when this footprint has at least one pump island under it. */
function coversAPump(state: GameState, footprint: Footprint): boolean {
  return Object.values(state.pumps).some((pump) =>
    overlaps(
      footprint,
      getFootprint(pump.position, GAME_CONFIG.buildings.pump_standard.size, pump.rotation)
    )
  );
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

  // One tank per fuel: capacity grows by upgrading the tank that stands, not
  // by carpeting the plot with packages.
  if (
    buildingType.startsWith('tank_') &&
    Object.values(state.buildings).some((b) => b.type === buildingType)
  ) {
    return { valid: false, reason: 'Maksimum alım sayısına ulaşıldı — tankı yükseltin.' };
  }

  const role = drivewayRole(buildingType);
  if (role) return evaluateDriveway(state, role, position);

  const footprint = getFootprint(position, catalog.size, rotation);

  // Signage is meant to be read from the carriageway, so it may stand at the
  // boundary or a little past it — the price board's own default spot is out
  // on the verge, which is nobody's parcel. Neither may stand in the road.
  if (buildingType === 'pylon_sign' || buildingType === 'price_sign') {
    return evaluateRoadsideSign(state, footprint);
  }

  if (!isFootprintOnOwnedLand(state.station.plots.ownedParcels, footprint)) {
    return { valid: false, reason: 'Burası sahip olduğunuz arsanın dışında.' };
  }

  if (!isFootprintOnOwnedLand(state.station.plots.pavedParcels, footprint)) {
    return { valid: false, reason: 'Önce bu parsele beton dökmelisiniz.' };
  }

  // A canopy is a roof: the whole point of it is to stand over the pump
  // island, so it is the one structure allowed to share ground with what is
  // already there. Everything else has to find its own space.
  if (buildingType !== 'canopy') {
    // A rest complex is built *over* the units it replaces, so those are not
    // obstacles to it — refusing the placement would mean the player had to
    // demolish the parade first and lose the money twice.
    const absorbed = new Set(
      buildingType === 'rest_complex'
        ? absorbedByRestComplex(state, drivewaySideAt(position[1])).map((b) => b.id)
        : []
    );

    for (const taken of occupiedFootprints(state)) {
      if (absorbed.has(taken.id)) continue;
      if (overlaps(footprint, taken.footprint)) {
        return { valid: false, reason: `${taken.name} ile çakışıyor.` };
      }
    }
  } else if (!coversAPump(state, footprint)) {
    return { valid: false, reason: 'Sundurma bir pompanın üzerine kurulmalı.' };
  }

  return { valid: true };
}

