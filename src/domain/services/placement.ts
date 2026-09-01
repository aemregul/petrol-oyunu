/**
 * Build placement rules: where a structure may legally go on the forecourt.
 *
 * Positions are grid coordinates and mark the CENTRE of a footprint, matching
 * how BuildPreviewMesh and BuildingMesh draw them.
 */

import { GameState } from '../types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
import { FAR_SIDE_FRONT, isFootprintOnOwnedLand, ownedBounds, pavedFrontage } from './land';
import {
  LAYOUT,
  FORECOURT_FRONT,
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
    const footprint = getFootprint(building.position, building.size, building.rotation);

    // A ramp lives on the verge and only kisses the concrete. Its sliver past
    // the frontage line must not count as occupied ground, or the far block's
    // flush front row would be refused beside a ramp while the near one is
    // not — the two lines the sliver is clamped to are the same ones the
    // frontage rule below builds from.
    if (drivewayRole(building.type)) {
      if (building.position[1] > FAR_SIDE_FRONT) {
        footprint.maxZ = Math.min(footprint.maxZ, FORECOURT_FRONT);
      } else {
        footprint.minZ = Math.max(footprint.minZ, FAR_SIDE_FRONT);
      }
    }

    taken.push({
      id: building.id,
      name: conf?.name || building.type,
      footprint
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
/**
 * Where the price board may stand: the planted frontage between the two
 * mouths, and nowhere else.
 *
 * It is the one structure whose whole job is to be read from the carriageway
 * before a driver has decided to pull in, so it belongs on the verge in the
 * gap between the ramps — never back on the concrete, where it faces the
 * forecourt instead of the road and takes up a bay's worth of ground.
 */
function evaluatePriceSign(state: GameState, footprint: Footprint): PlacementResult {
  const mouths = drivewayMouths(state, 'near');

  // Clear of both ramps, whichever way round they happen to be.
  const left = mouths.entry.x < mouths.exit.x ? mouths.entry : mouths.exit;
  const right = mouths.entry.x < mouths.exit.x ? mouths.exit : mouths.entry;
  const gapMin = left.x + left.width / 2;
  const gapMax = right.x - right.width / 2;

  if (footprint.minX < gapMin || footprint.maxX > gapMax) {
    return { valid: false, reason: 'Fiyat tabelası iki rampanın arasında durmalı.' };
  }

  // Between the kerb and the concrete: the verge, and only the verge. Measured
  // at the board's centre rather than its back edge, because the verge is
  // narrower than the board's own cell — standing on its mark, it already
  // overhangs the concrete line by half of one.
  const roadEdge = LAYOUT.roadZ + LAYOUT.roadHalfWidth;
  if (footprint.minZ < roadEdge) {
    return { valid: false, reason: 'Tabela yolun üzerine kurulamaz.' };
  }
  if ((footprint.minZ + footprint.maxZ) / 2 > FORECOURT_FRONT) {
    return { valid: false, reason: 'Fiyat tabelası betona değil, yol kenarındaki peyzaja kurulur.' };
  }

  for (const taken of occupiedFootprints(state)) {
    if (overlaps(footprint, taken.footprint)) {
      return { valid: false, reason: `${taken.name} ile çakışıyor.` };
    }
  }

  return { valid: true };
}

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

/**
 * Pulls a candidate position onto the line the thing being built can actually
 * live on. Ordinary structures go wherever the pointer is; a driveway ramp is
 * pinned to a verge and only slides along the frontage, so dragging it up and
 * down the plot moves nothing.
 *
 * Which verge it lands on follows the pointer across the road: aim at the far
 * block and the ramp snaps to that block's own frontage.
 */
/**
 * Puts one axis of a footprint's centre where its edges land on grid lines.
 *
 * Positions mark the centre, so an even footprint centres on a line and an odd
 * one centres in the middle of a square. Rounding every centre to a whole
 * number regardless — which is what the pointer used to do — left every odd
 * building straddling two squares, half a cell off the concrete at each end.
 */
function snapToGrid(value: number, extent: number): number {
  const offset = (extent % 2) / 2;
  return Math.round(value - offset) + offset;
}

export function snapPlacement(
  state: GameState,
  buildingType: string,
  position: [number, number],
  rotation = 0
): [number, number] {
  const role = drivewayRole(buildingType);
  if (!role) {
    const catalog = GAME_CONFIG.buildings[buildingType];
    if (!catalog) return position;

    // The price board is verge furniture, like the ramps either side of it:
    // only where along the frontage it stands is the player's to choose. Left
    // to the ordinary snap it rounded off the narrow verge and onto the
    // concrete, which is both the wrong place for it and a spot the rules
    // then refused.
    if (buildingType === 'price_sign') {
      const mouths = drivewayMouths(state, 'near');
      const left = mouths.entry.x < mouths.exit.x ? mouths.entry : mouths.exit;
      const right = mouths.entry.x < mouths.exit.x ? mouths.exit : mouths.entry;
      const halfWidth = catalog.size[0] / 2;

      const min = left.x + left.width / 2 + halfWidth;
      const max = right.x - right.width / 2 - halfWidth;
      const x = snapToGrid(position[0], catalog.size[0]);

      return [
        max < min ? (min + max) / 2 : clamp(x, min, max),
        // The last row that keeps the board wholly clear of the concrete.
        FORECOURT_FRONT - catalog.size[1] / 2
      ];
    }

    // A quarter turn swaps which side of the footprint faces which axis.
    const turned = rotation === 90 || rotation === 270;
    return [
      snapToGrid(position[0], turned ? catalog.size[1] : catalog.size[0]),
      snapToGrid(position[1], turned ? catalog.size[0] : catalog.size[1])
    ];
  }

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

  // Storage is one farm and, at the top of its ladder, one expansion beside
  // it. Capacity grows by upgrading what stands, not by carpeting the plot.
  if (
    (buildingType === 'tank_farm' || buildingType === 'tank_expansion') &&
    Object.values(state.buildings).some((b) => b.type === buildingType)
  ) {
    return { valid: false, reason: 'Maksimum alım sayısına ulaşıldı.' };
  }
  if (buildingType === 'tank_expansion') {
    const farm = Object.values(state.buildings).find((b) => b.type === 'tank_farm');
    if (!farm || farm.level < 3) {
      return { valid: false, reason: 'Önce ana Yakıt Tank Sahası Sv3 olmalı.' };
    }
  }

  const role = drivewayRole(buildingType);
  if (role) return evaluateDriveway(state, role, position);

  const footprint = getFootprint(position, catalog.size, rotation);

  // Signage is meant to be read from the carriageway, so it may stand at the
  // boundary or a little past it — the price board's own default spot is out
  // on the verge, which is nobody's parcel. Neither may stand in the road.
  if (buildingType === 'price_sign') {
    return evaluatePriceSign(state, footprint);
  }

  if (buildingType === 'pylon_sign') {
    return evaluateRoadsideSign(state, footprint);
  }

  if (!isFootprintOnOwnedLand(state.station.plots.ownedParcels, footprint)) {
    return { valid: false, reason: 'Burası sahip olduğunuz arsanın dışında.' };
  }

  if (!isFootprintOnOwnedLand(state.station.plots.pavedParcels, footprint)) {
    return { valid: false, reason: 'Önce bu parsele beton dökmelisiniz.' };
  }

  // The strip between the road and the concrete line is frontage — verge
  // grass, the ramps and the roadside signs — not forecourt. Both blocks are
  // guarded: the near strip outright, and the far block's road-facing edge,
  // which the parcel checks alone cannot police because parcelAt folds the
  // whole road corridor into row 0. Signs and ramps returned earlier, so this
  // refuses only ordinary structures.
  const overFrontage =
    drivewaySideAt(position[1]) === 'near'
      ? footprint.minZ < FORECOURT_FRONT
      : footprint.maxZ > FAR_SIDE_FRONT;
  if (overFrontage) {
    return { valid: false, reason: 'Yol banketi inşaata kapalı; betonun gerisine kurun.' };
  }

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

  return { valid: true };
}

