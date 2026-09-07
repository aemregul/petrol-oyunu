/**
 * The buildings people walk into: what they charge, where their door is,
 * where a car parks to reach them, and the till the money lands in.
 *
 * Kept apart from the engine because none of it needs a tick to answer — the
 * panel asks the same questions the simulation does, and both should get the
 * same answer from the same place. Coordinates are grid units throughout,
 * like the rest of the simulation.
 */

import { BuildingEntity, GameState, VehicleArchetype } from '../types/gameState';
import { GAME_CONFIG, FacilityConfig, FacilityTariff } from '../../config/gameConfig';
import { TransactionService } from './TransactionService';

export function facilityConfig(type: string): FacilityConfig | null {
  return GAME_CONFIG.facilities[type] ?? null;
}

export function isFacility(type: string): boolean {
  return type in GAME_CONFIG.facilities;
}

/** The price currently up on the card, for a facility that has one. */
export function facilityTariff(building: BuildingEntity): FacilityTariff | null {
  const conf = facilityConfig(building.type);
  if (!conf?.tariffs?.length) return null;
  const index = building.tariff ?? conf.defaultTariff ?? 0;
  return conf.tariffs[Math.min(conf.tariffs.length - 1, Math.max(0, index))];
}

/** The price that comes after the current one, round the card. */
export function nextTariffIndex(building: BuildingEntity): number | null {
  const conf = facilityConfig(building.type);
  if (!conf?.tariffs?.length) return null;
  const index = building.tariff ?? conf.defaultTariff ?? 0;
  return (index + 1) % conf.tariffs.length;
}

/** How much of the building's goodwill the price it charges leaves standing. */
export function facilityMoralFactor(building: BuildingEntity): number {
  return facilityTariff(building)?.moral ?? 1;
}

function byLevel(table: number[] | undefined, level: number): number {
  if (!table || table.length === 0) return 1;
  return table[Math.min(table.length - 1, Math.max(0, level - 1))];
}

export function facilityLevelIncome(building: BuildingEntity): number {
  return byLevel(facilityConfig(building.type)?.levelIncome, building.level);
}

export function facilityLevelDemand(building: BuildingEntity): number {
  return byLevel(facilityConfig(building.type)?.levelDemand, building.level);
}

/** Beds at a hotel of this level; zero for anything that is not one. */
export function facilityRooms(building: BuildingEntity): number {
  const rooms = facilityConfig(building.type)?.rooms;
  if (!rooms) return 0;
  return byLevel(rooms, building.level);
}

/**
 * The building's satisfaction effect as the panel shows it: in "points",
 * which is the service-score contribution over twenty, so a fresh free toilet
 * reads +0.15 and one that charges ten lira reads +0.00.
 */
export function facilityMoralPoints(building: BuildingEntity): number {
  const effect = GAME_CONFIG.buildingEffects[building.type]?.satisfaction ?? 0;
  const scale = 1 + 0.25 * (building.level - 1);
  const condition = 0.5 + 0.5 * (building.health / 100);
  return (effect * scale * condition * facilityMoralFactor(building)) / 20;
}

/** A point in the building's own frame, turned the way the building is. */
function turned(
  building: Pick<BuildingEntity, 'position' | 'rotation'>,
  local: [number, number]
): [number, number] {
  const theta = ((building.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [
    building.position[0] + local[0] * cos + local[1] * sin,
    building.position[1] - local[0] * sin + local[1] * cos
  ];
}

/**
 * Where a visitor goes in: the middle of the front face, a step outside it.
 *
 * The kit models and the hand-built restaurant do not agree on which way is
 * the front. The models face -z in their own frame, toward the road when the
 * building stands unturned on the near block; the restaurant's glazed front
 * and terrace were built on +z.
 */
export function facilityDoor(building: BuildingEntity): [number, number, number] {
  const depth = building.size[1];
  const front = building.type === 'restaurant' ? depth / 2 + 0.35 : -(depth / 2 + 0.35);
  const [x, z] = turned(building, [0, front]);
  return [x, 0, z];
}

/** Which park a vehicle of this shape belongs in. */
export function parkingTypeFor(vehicle: {
  archetype: VehicleArchetype;
  modelVariant?: string;
}): 'car_park' | 'truck_park' {
  const big =
    vehicle.archetype === 'truck' ||
    vehicle.archetype === 'bus' ||
    vehicle.modelVariant === 'truck-with-trailer' ||
    vehicle.modelVariant === 'bus';
  return big ? 'truck_park' : 'car_park';
}

/**
 * Bays across a park, counted the way the paint on the ground is: a car needs
 * about 2.7 world units of width, a lorry about 4.4.
 */
export function parkingBayCount(building: Pick<BuildingEntity, 'type' | 'size'>): number {
  const bayWidth = building.type === 'truck_park' ? 4.4 : 2.7;
  return Math.max(1, Math.round((building.size[0] * 2) / bayWidth));
}

/**
 * One bay of a park: where the car stands, which way it faces, and the spot
 * behind the bay it drives in from and backs out to.
 *
 * The bays run across the park's width and the kerb is along its -z edge, so
 * a car noses in toward -z and its tail is toward +z — all in the park's own
 * frame, then turned the way the park is.
 */
export function parkingBay(
  building: Pick<BuildingEntity, 'type' | 'size' | 'position' | 'rotation'>,
  index: number,
  body: { length: number }
): { pose: [number, number, number]; heading: number; runUp: [number, number, number] } {
  const width = building.size[0];
  const depth = building.size[1];
  const count = parkingBayCount(building);
  const step = width / count;
  const localX = -width / 2 + step * (Math.min(count - 1, Math.max(0, index)) + 0.5);
  // Nose just short of the stop line painted across the head of the bays.
  const localZ = -0.44 * depth + body.length;

  const [x, z] = turned(building, [localX, localZ]);
  const [rx, rz] = turned(building, [localX, depth / 2 + 1.6]);
  const theta = ((building.rotation || 0) * Math.PI) / 180;

  return {
    pose: [x, 0, z],
    // Facing the park's own -z, whichever way the park has been turned.
    heading: Math.atan2(-Math.sin(theta), -Math.cos(theta)),
    runUp: [rx, 0, rz]
  };
}

/**
 * What one visit is worth before the day's luck: the price on the card, or
 * the driver's basket for a shop, or the catalogue's figure — grown by level.
 */
export function facilitySpend(building: BuildingEntity, archetype: VehicleArchetype): number {
  const conf = facilityConfig(building.type);
  if (!conf) return 0;

  const tariff = facilityTariff(building);
  let base: number;
  if (tariff) {
    base = tariff.price;
  } else if (building.type === 'mini_market') {
    base = GAME_CONFIG.customerTypes[archetype]?.marketAvgBasket ?? conf.avgSpend;
  } else {
    base = conf.avgSpend;
  }

  return base * facilityLevelIncome(building);
}

/** Books a sale into the building's till and the day's figures. */
export function creditFacility(state: GameState, building: BuildingEntity, amount: number): void {
  if (amount <= 0) return;
  const conf = facilityConfig(building.type);

  building.till = (building.till ?? 0) + amount;
  building.todayRevenue = (building.todayRevenue ?? 0) + amount;
  state.dayState.todayStats.marketRevenue += amount;
  state.dayState.todayStats.marketCost += Math.round(amount * (conf?.costRatio ?? 0.5));
}

/** Everything sitting uncollected across the station. */
export function tillTotal(state: GameState): number {
  return Object.values(state.buildings).reduce((sum, b) => sum + (b.till ?? 0), 0);
}

/**
 * Empties one building's till into the station's cash. Returns what moved,
 * which is zero when there was nothing to move.
 */
export function collectTill(state: GameState, buildingId: string): number {
  const building = state.buildings[buildingId];
  if (!building) return 0;

  const amount = Math.round(building.till ?? 0);
  if (amount <= 0) return 0;

  const name = GAME_CONFIG.buildings[building.type]?.name ?? building.type;
  const tx = TransactionService.executeCashTransaction(state, {
    type: 'FACILITY_INCOME',
    amount,
    description: `${name} kasası toplandı`
  });
  if (!tx.success) return 0;

  building.till = 0;
  return amount;
}

/** The manager's round: every till at once, as one line in the books. */
export function collectAllTills(state: GameState): { total: number; buildings: number } {
  let total = 0;
  let buildings = 0;
  const names: string[] = [];

  for (const building of Object.values(state.buildings)) {
    const amount = Math.round(building.till ?? 0);
    if (amount <= 0) continue;
    total += amount;
    buildings++;
    names.push(GAME_CONFIG.buildings[building.type]?.name ?? building.type);
  }
  if (total <= 0) return { total: 0, buildings: 0 };

  const tx = TransactionService.executeCashTransaction(state, {
    type: 'FACILITY_INCOME',
    amount: total,
    description: `Müdür tesis kasalarını topladı (${names.join(', ')})`
  });
  if (!tx.success) return { total: 0, buildings: 0 };

  for (const building of Object.values(state.buildings)) {
    if ((building.till ?? 0) > 0) building.till = 0;
  }
  return { total, buildings };
}
