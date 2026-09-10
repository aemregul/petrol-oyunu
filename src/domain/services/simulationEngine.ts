/**
 * Project Highway - Simulation Engine
 *
 * Every function here mutates a GameState draft in place and pushes its side
 * effects (notifications, sound cues) into a SimEffects collector. Nothing in
 * this module reads or writes the Zustand store, so a single simulation tick
 * can advance the whole world and the store commits the result exactly once.
 */

import {
  GameEventEffects,
  GameState,
  VehicleEntity,
  PumpEntity,
  EmployeeEntity,
  GameNotification,
  NotificationDraft,
  FuelType,
  VehicleArchetype,
  VehicleState,
  PumpState,
  OrderState,
  EmployeeState,
  MissionMetric,
  MissionEntity,
  BuildingEntity,
  FuelOrderEntity,
  ActiveGameEvent
} from '../types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
import {
  routeAround,
  routeAroundOrNull,
  canReach,
  wallRects,
  pumpRects,
  legIsClear,
  inRects,
  detour,
  straighten,
  FLAT_TYPES,
  KERB_LINE_PROPS,
  Rect as PathRect
} from './pathfinding';
import {
  facilityConfig,
  isFacility,
  facilityTariff,
  facilityMoralFactor,
  facilityLevelDemand,
  facilityRooms,
  facilityDoor,
  facilitySpend,
  creditFacility,
  collectAllTills,
  parkingBay,
  parkingBayCount,
  parkingTypeFor
} from './facilities';
import {
  GAME_EVENTS,
  GameEventConfig,
  DAILY_MISSION_TEMPLATES
} from '../../config/eventConfig';
import {
  availableFuelLiters,
  reconcileFuelReservations,
  TransactionService
} from './TransactionService';
import { VehicleStateMachine } from '../stateMachines/vehicleStateMachine';
import { PumpStateMachine } from '../stateMachines/pumpStateMachine';
import { OrderStateMachine } from '../stateMachines/orderStateMachine';
import { EmployeeStateMachine } from '../stateMachines/employeeStateMachine';
import {
  calculatePriceAttractiveness,
  calculateHourlyTrafficMultiplier,
  calculateReputationTrafficMultiplier,
  calculateServiceScore,
  calculateCustomerTip,
  calculateManagerAvailableBudget,
  calculateRepairCost,
  clamp
} from '../formulas/economy';
import { dutyActive, managerDailyWage, managerTier, MANAGER_CLEAN_BELOW } from './managerDuties';
import { pumpName } from './pumpNames';
import { FAR_SIDE_FRONT, farSideBounds, onKerbLine, unpavedHoles } from './land';
import { vehicleBodyHalfExtents } from './vehicleBody';
import {
  dieselForGenerator,
  generatorWants,
  gridKwhPerHourFor,
  gridPriceAt,
  isNightTariff,
  solarCellsOn,
  solarFactor,
  roofCells,
  solarCleanCost,
  solarCleanlinessOf
} from './energy';

export type SoundCue =
  | 'click'
  | 'cash'
  | 'alert'
  | 'levelUp'
  | 'pumpStart'
  | 'fuelTick'
  | 'buildPlace';

export interface SimEffects {
  notifications: NotificationDraft[];
  sounds: SoundCue[];
  dayEnded: boolean;
}

export function createEffects(): SimEffects {
  return { notifications: [], sounds: [], dayEnded: false };
}

function notify(
  effects: SimEffects,
  type: GameNotification['type'],
  title: string,
  message: string,
  holdMs?: number
): void {
  effects.notifications.push(holdMs ? { type, title, message, holdMs } : { type, title, message });
}

/** Explain a visually surprising turn-away caused by the vehicle's real body size. */
function notifyNoManeuverRoom(
  vehicle: VehicleEntity,
  effects: SimEffects,
  reputationPenalty: boolean
): void {
  const name =
    vehicle.modelVariant === 'limousine'
      ? 'Limuzin'
      : vehicle.modelVariant === 'bus'
        ? 'Otobüs'
        : vehicle.modelVariant === 'monster-truck'
          ? 'Monster Truck'
          : vehicle.modelVariant === 'truck-with-trailer'
            ? 'Römorklu kamyon'
            : 'Araç';
  notify(
    effects,
    'WARNING',
    'Manevra Alanı Yetersiz',
    `${name}, pompa veya kuyruğa güvenli bir rota bulamadığı için tesisten ayrıldı. ` +
      'Geçişlerin çevresinde daha geniş alan bırakın.' +
      (reputationPenalty
        ? ' (-0.015 İtibar)'
        : ' Seviye 1–5 arasında itibar etkilenmez.')
  );
}

/**
 * How long an event's explanation stays on screen. The card in the corner
 * only names the event; this toast is where "Rafineri Zammı" is explained,
 * and it has to outlive the ordinary four-second pills to be read.
 */
export const EVENT_TOAST_HOLD_MS = 12_000;

function playCue(effects: SimEffects, cue: SoundCue): void {
  if (!effects.sounds.includes(cue)) effects.sounds.push(cue);
}

/* ------------------------------------------------------------------ */
/* Validated state transitions                                         */
/* ------------------------------------------------------------------ */

export function setVehicleState(vehicle: VehicleEntity, next: VehicleState): boolean {
  if (vehicle.state === next) return true;
  const res = VehicleStateMachine.transition(vehicle.id, vehicle.state, next);
  if (res.success) vehicle.state = res.state;
  return res.success;
}

export function setPumpState(pump: PumpEntity, next: PumpState): boolean {
  if (pump.state === next) return true;
  const res = PumpStateMachine.transition(pump.id, pump.state, next);
  if (res.success) pump.state = res.state;
  return res.success;
}

export function setEmployeeState(employee: EmployeeEntity, next: EmployeeState): boolean {
  if (employee.state === next) return true;
  const res = EmployeeStateMachine.transition(employee.id, employee.state, next);
  if (res.success) employee.state = res.state;
  return res.success;
}

function setOrderState(orderId: string, current: OrderState, next: OrderState): OrderState {
  return OrderStateMachine.transition(orderId, current, next).state;
}

/**
 * Frees a pump back to IDLE, walking the RELEASE step when the machine needs
 * it. Which of the two routes applies is asked rather than tried: attempting
 * the direct one first logs a warning about an invalid transition on a path
 * this function is deliberately taking, which buries the real ones.
 */
export function releasePump(pump: PumpEntity): void {
  pump.currentVehicleId = null;
  if (pump.state === 'BROKEN' || pump.state === 'MAINTENANCE') return;

  if (PumpStateMachine.canTransition(pump.state, 'IDLE')) {
    setPumpState(pump, 'IDLE');
    return;
  }
  setPumpState(pump, 'RELEASE');
  setPumpState(pump, 'IDLE');
}

/** Returns an attendant to a clean idle state without leaving a claimed car. */
function resetAttendantJob(employee: EmployeeEntity): void {
  employee.currentVehicleId = null;
  employee.actionTimerSeconds = 0;
  if (employee.state === 'PAYMENT') setEmployeeState(employee, 'RETURN_IDLE');
  if (employee.state === 'RETURN_IDLE') setEmployeeState(employee, 'IDLE');
  else if (employee.state !== 'IDLE' && employee.state !== 'UNASSIGNED') {
    setEmployeeState(employee, 'IDLE');
  }
}

/**
 * Releases a live job before an attendant is fired or moved. A pour already
 * under way becomes the player's job and keeps its reservation; a customer
 * who has not started yet becomes available to the player or another worker.
 */
export function releaseAttendantJob(state: GameState, employee: EmployeeEntity): void {
  const vehicle = employee.currentVehicleId ? state.vehicles[employee.currentVehicleId] : null;
  if (vehicle?.assignedActor === 'EMPLOYEE') {
    vehicle.assignedActor =
      vehicle.state === 'FUELING' || vehicle.state === 'PAYMENT' ? 'PLAYER' : null;
  }
  resetAttendantJob(employee);
}

/* ------------------------------------------------------------------ */
/* World layout                                                        */
/* ------------------------------------------------------------------ */

/**
 * Station layout in grid units. GroundGrid paints the same lanes at world
 * scale (world = grid * 2), so the routes below line up with what is drawn.
 */
export const LAYOUT = {
  /** Highway centreline. The plot's front edge butts up against it. */
  roadZ: -3,
  /** Half a carriageway, in grid units. One lane, one direction. */
  roadHalfWidth: 2.2,
  /** Landscaped central reservation between the two carriageways. */
  medianWidth: 2.6,
  /** Grass between the road kerb and the forecourt, bridged by the driveways. */
  vergeDepth: 1.6,
  /**
   * How far beyond the plot cars join and leave the highway. Far enough to be
   * off the edge of the screen at any normal zoom: appearing halfway down a
   * road the player can see reads as a glitch, not as traffic.
   *
   * 42 kameranın gerçek menziline yetmiyordu (Emre, 2026-09-05): en uzak
   * zoom'da kuşbakışı görüş, pan sınırıyla birlikte arsa kenarının ~50 grid
   * ötesini gösterir ve araçlar yolun ortasında belirip yolun ortasında
   * buharlaşıyordu. 90, o menzilin rahatça dışıdır; yol zaten ±300 çizilir.
   */
  roadMargin: 90,
  /** Wide enough that a truck in the queue does not overlap the car behind. */
  queueSpacing: 3.4,
  /**
   * How far inside the concrete a parked vehicle must stay. Half a vehicle
   * length plus a little, so no bodywork overhangs the apron edge.
   */
  apronMargin: 2.5
} as const;

/**
 * A driveway belongs to the road layout, not to the forecourt: it has to meet
 * the carriageway at one end and the concrete at the other, so it can only
 * ever sit on the verge between them. The wide ramps the player can buy are
 * therefore not free-standing structures — each one *replaces* one of the two
 * default mouths, and slides along the frontage rather than being dropped
 * anywhere on the plot.
 */
export type DrivewayRole = 'entry' | 'exit';

/** Both blocks have their own pair of mouths, one either side of the highway. */
export type DrivewaySide = 'near' | 'far';

const WIDE_RAMPS: Record<string, DrivewayRole> = {
  wide_entry: 'entry',
  wide_exit: 'exit'
};

/** Which mouth a building type stands in for, or null if it is not a ramp. */
export function drivewayRole(buildingType: string): DrivewayRole | null {
  return WIDE_RAMPS[buildingType] ?? null;
}

/**
 * Mouth widths in grid units. A wide ramp is exactly twice the default cut,
 * because that is what it is for: two lanes side by side rather than one lane
 * with a broader apron.
 */
export const DRIVEWAY_WIDTH = 3;
export const WIDE_DRIVEWAY_WIDTH = DRIVEWAY_WIDTH * 2;

/**
 * The one row a driveway may sit on, per side — the middle of its verge. Ramps
 * move along the frontage, never towards or away from the road.
 */
export const DRIVEWAY_Z =
  Math.round((LAYOUT.roadZ + LAYOUT.roadHalfWidth + LAYOUT.vergeDepth / 2) * 1000) / 1000;

/**
 * Where the near forecourt's concrete begins, in grid units: the verge line
 * pushed AWAY from the road onto the next build-cell boundary, so the slab
 * edge always coincides with a snap line. The strip between the plot's front
 * boundary and this line belongs to the frontage — verge grass, the ramps and
 * the roadside signs — and is neither driven on (frontageKeepOut) nor built
 * on (evaluatePlacement). The far block needs no counterpart: its parcels
 * already start on a cell boundary at FAR_SIDE_FRONT, a matching distance
 * clear of their own kerb.
 */
export const FORECOURT_FRONT = Math.ceil(
  LAYOUT.roadZ + LAYOUT.roadHalfWidth + LAYOUT.vergeDepth
);

const FAR_ROAD_Z = LAYOUT.roadZ - 2 * LAYOUT.roadHalfWidth - LAYOUT.medianWidth;

/**
 * The far verge runs from the far kerb back to the first row of parcels over
 * there, which already starts clear of the road — so it is a shade deeper than
 * the near one, and its centre is not a plain mirror.
 */
export const FAR_DRIVEWAY_Z =
  Math.round(
    ((FAR_ROAD_Z - LAYOUT.roadHalfWidth +
      Math.min(FAR_ROAD_Z - LAYOUT.roadHalfWidth - LAYOUT.vergeDepth, FAR_SIDE_FRONT)) /
      2) *
      1000
  ) / 1000;

/** Which block a z coordinate belongs to. */
export function drivewaySideAt(z: number): DrivewaySide {
  return z < (DRIVEWAY_Z + FAR_DRIVEWAY_Z) / 2 ? 'far' : 'near';
}

export function drivewayZ(side: DrivewaySide): number {
  return side === 'far' ? FAR_DRIVEWAY_Z : DRIVEWAY_Z;
}

/** The parcel row that fronts the road on one side. */
export function frontageRow(side: DrivewaySide): 0 | -1 {
  return side === 'far' ? -1 : 0;
}

interface PlacedRamp {
  type: string;
  position: [number, number];
  /** Absent on the trimmed shape the renderer passes for the ramps alone. */
  size?: [number, number];
}

export type WideRampMap = Record<DrivewaySide, Partial<Record<DrivewayRole, PlacedRamp>>>;

/**
 * The wide ramp standing in for each default mouth, where one was built. A
 * ramp belongs to the block it was placed on, so the two sides are kept apart.
 */
export function wideRamps(buildings?: Record<string, PlacedRamp>): WideRampMap {
  const out: WideRampMap = { near: {}, far: {} };
  for (const building of Object.values(buildings ?? {})) {
    const role = drivewayRole(building.type);
    if (role) out[drivewaySideAt(building.position[1])][role] = building;
  }
  return out;
}

/** Where a mouth sits when the player has not moved it. */
export function defaultDrivewayX(role: DrivewayRole, plotWidth: number): number {
  return role === 'entry' ? 3 : Math.max(6, plotWidth - 3);
}

/**
 * The opening a role takes on one side of the road before anything is built
 * there. The far carriageway runs the other way, so a driver over there meets
 * the two openings in the opposite order: its entrance is the far block's
 * downstream one. Getting this backwards gives a block two entrances and no
 * exit, which is why both the renderer and the save repair read it from here.
 */
export function defaultMouthX(
  role: DrivewayRole,
  side: DrivewaySide,
  plotWidth: number
): number {
  const upstream: DrivewayRole =
    side === 'far' ? (role === 'entry' ? 'exit' : 'entry') : role;
  return defaultDrivewayX(upstream, plotWidth);
}

/** One opening in the kerb line: where it is, how wide, and on which verge. */
export interface DrivewayMouth {
  x: number;
  width: number;
  z: number;
}

/**
 * The pair of mouths serving one block: always exactly one way in and one way
 * out, whether the player has widened them or not.
 *
 * The far carriageway runs the other way, so a driver over there meets the two
 * openings in the opposite order — its entrance is the downstream one. Getting
 * that backwards leaves a block with two entrances and no exit.
 */
export function drivewayMouths(
  state: {
    station: { plots: { width: number } };
    buildings?: Record<string, PlacedRamp>;
  },
  side: DrivewaySide = 'near'
): Record<DrivewayRole, DrivewayMouth> {
  const wide = wideRamps(state.buildings)[side];
  const z = drivewayZ(side);
  const plotWidth = state.station.plots.width;

  const mouth = (role: DrivewayRole): DrivewayMouth => {
    const ramp = wide[role];
    return {
      x: ramp ? ramp.position[0] : defaultMouthX(role, side, plotWidth),
      width: ramp ? WIDE_DRIVEWAY_WIDTH : DRIVEWAY_WIDTH,
      z
    };
  };

  return { entry: mouth('entry'), exit: mouth('exit') };
}

/**
 * Where in a mouth a vehicle drives. A default mouth is one lane, so everyone
 * takes the middle; a wide ramp is genuinely two, so arrivals alternate and
 * two vehicles can use it at once instead of falling into single file.
 */
export function drivewayLaneX(mouth: DrivewayMouth, laneIndex: number): number {
  if (mouth.width <= DRIVEWAY_WIDTH) return mouth.x;
  return mouth.x + (laneIndex % 2 === 0 ? -1 : 1) * (mouth.width / 4);
}

/**
 * Lane and driveway positions, derived from the plot the player owns rather
 * than hard-coded. Buying land therefore moves the exit and lengthens the
 * queue without anything else needing to know.
 */
export interface PlotLayout {
  entryX: number;
  exitX: number;
  /** How wide each mouth is cut, which a wide ramp doubles. */
  entryWidth: number;
  exitWidth: number;
  /** Centre of the verge: every driveway sits on this line. */
  drivewayZ: number;
  laneZ: number;
  exitLaneZ: number;
  queueHeadX: number;
  roadEndX: number;
  /** Half a carriageway, in grid units. */
  roadHalfWidth: number;
  /** Centre of the near carriageway — the one that serves this station. */
  roadLaneZ: number;
  /** Centre of the opposite carriageway; only built at road level 2. */
  farRoadLaneZ: number;
}

export function getLayout(state: {
  station: { plots: { width: number; height: number } };
  /** Optional so the renderer can ask for a layout before anything is built. */
  buildings?: Record<string, PlacedRamp>;
}): PlotLayout {
  const { width, height } = state.station.plots;
  const mouths = drivewayMouths(state, 'near');

  // Upgrading mirrors the existing carriageway across a landscaped median
  // rather than widening it, so the near lane never moves and the station
  // keeps its position relative to the road.
  const roadHalfWidth = LAYOUT.roadHalfWidth;
  const roadLaneZ = LAYOUT.roadZ;
  const farRoadLaneZ = LAYOUT.roadZ - 2 * roadHalfWidth - LAYOUT.medianWidth;

  return {
    roadHalfWidth,
    roadLaneZ,
    farRoadLaneZ,
    // A wide ramp takes over its mouth entirely: cars aim at it, the kerb
    // opens for it, and the default ramp is no longer drawn.
    entryX: mouths.entry.x,
    exitX: mouths.exit.x,
    entryWidth: mouths.entry.width,
    exitWidth: mouths.exit.width,
    drivewayZ: DRIVEWAY_Z,
    // The circulation lane hugs the road; the return lane runs along the back.
    laneZ: 4,
    exitLaneZ: Math.max(7, height - 3),
    queueHeadX: Math.max(6, Math.min(width - 5, 12)),
    roadEndX: width + 12
  };
}

/**
 * The lanes serving one block of the station.
 *
 * The forecourt and the land across the highway are laid out the same way,
 * mirrored: the carriageway that serves each runs the opposite direction, so
 * over there cars arrive from the other end, queue the other way and leave by
 * the other mouth. Every route below reads its geometry from here rather than
 * assuming the near side, which is what lets the far block run the same game.
 */
/** How far off the circulation lane the queue may wait, in grid units. */
const QUEUE_LAY_BYS = [2, 3.2, 4.4];

/** Half a lane, in grid units: the room a lane is laid out with. */
export const LANE_HALF_WIDTH = 1.4;

/**
 * What a car itself needs either side of its centre, in grid units — measured
 * to the corner of the body, so it holds however the car is turned. Narrower
 * than a lane, and the difference is the gap a lane may still be squeezed into
 * on a forecourt the player has built up.
 */
const CAR_HALF_SPAN = 1.1;

/**
 * How much of the apron behind the kerb belongs to the frontage rather than to
 * the traffic: the price board stands here and its planting beds run either
 * side of it. Nothing drives across this.
 */
const FRONTAGE_DEPTH = 2;

/**
 * Buildings a car drives under rather than into. Everything else is solid, so
 * a lane has to be routed around it.
 *
 * Empty since canopies became part of the pump they cover: a roof carried by
 * the island can no longer stand in a lane on its own.
 */
export const DRIVE_THROUGH_TYPES: string[] = [];

/**
 * The z spans a lane has to keep clear of, counting only what actually stands
 * over the stretch of it the cars drive. A building off to one side of the
 * forecourt is no obstacle to a lane the traffic only ever uses at the other
 * end, and treating it as one leaves nowhere for the lane to go.
 */
function solidSpans(
  state: {
    buildings?: Record<string, PlacedRamp>;
    pumps?: Record<string, { position: [number, number] }>;
  },
  side: DrivewaySide,
  drivenX: [number, number]
): Array<[number, number]> {
  const [fromX, toX] = drivenX[0] <= drivenX[1] ? drivenX : [drivenX[1], drivenX[0]];
  const spans: Array<[number, number]> = [];

  const inTheWay = (x: number, halfWidth: number) =>
    x + halfWidth > fromX - LANE_HALF_WIDTH && x - halfWidth < toX + LANE_HALF_WIDTH;

  for (const building of Object.values(state.buildings ?? {})) {
    if (DRIVE_THROUGH_TYPES.includes(building.type)) continue;
    if (drivewaySideAt(building.position[1]) !== side) continue;
    if (!inTheWay(building.position[0], (building.size?.[0] ?? 2) / 2)) continue;

    const half = (building.size?.[1] ?? 2) / 2;
    spans.push([building.position[1] - half, building.position[1] + half]);
  }

  for (const pump of Object.values(state.pumps ?? {})) {
    if (drivewaySideAt(pump.position[1]) !== side) continue;
    if (!inTheWay(pump.position[0], 1)) continue;
    spans.push([pump.position[1] - 1, pump.position[1] + 1]);
  }

  return spans;
}

/**
 * The first lane position in the list with anything at all to spare, or the
 * one it prefers if none of them has. Used where a lane has a place it belongs
 * and should only move when something is actually standing on it.
 */
function firstClearLaneZ(
  candidates: number[],
  spans: Array<[number, number]>,
  fallback: number
): number {
  const clear = candidates.find((z) => laneClearance(z, spans) > 0);
  if (clear !== undefined) return clear;

  // Nowhere is clear, so take the least bad rather than the first. A lane that
  // grazes the corner of a building is not good, but it is a great deal better
  // than one that runs down the middle of it.
  return (
    candidates.reduce(
      (best, z) => (laneClearance(z, spans) > laneClearance(best, spans) ? z : best),
      candidates[0] ?? fallback
    ) ?? fallback
  );
}

/** How much room a lane at this z would have from the nearest solid thing. */
function laneClearance(z: number, spans: Array<[number, number]>): number {
  return spans.reduce(
    (worst, [min, max]) =>
      Math.min(worst, z < min ? min - z : z > max ? z - max : -1),
    Infinity
  );
}

/**
 * Picks the lane position that clears the buildings best. The player puts
 * their office, their shop and their pumps where they like, and a lane that
 * runs through one of them means cars driving through the walls — so the lane
 * moves, rather than the traffic pretending the building is not there.
 */
function clearLaneZ(
  candidates: number[],
  spans: Array<[number, number]>,
  fallback: number
): number {
  // A block can be too shallow to offer any choice at all — a single row of
  // parcels has nowhere to put a return lane but the one place it fits.
  if (candidates.length === 0) return fallback;

  return candidates.reduce((best, z) =>
    laneClearance(z, spans) > laneClearance(best, spans) ? z : best
  );
}

/**
 * Where the queue waits: a lay-by of its own, always further from the road
 * than the lane is.
 *
 * It cannot sit on the lane, because a line of stopped cars there is something
 * every other driver has to give way to. It cannot sit between the lane and
 * the road either, because then an arriving car would have to double back into
 * the traffic still coming in. That leaves the depth of the forecourt, and
 * since the player can put pumps anywhere, the exact offset is chosen against
 * their layout rather than fixed: whichever clears the pump islands best.
 */
function queueLayByZ(
  laneZ: number,
  exitLaneZ: number,
  inward: number,
  pumps: Array<{ position: [number, number]; rotation?: number }>,
  side: DrivewaySide,
  spans: Array<[number, number]>,
  /** The z-spans of the buildings standing over a given stretch of x. */
  buildingSpansOver: (fromX: number, toX: number) => Array<[number, number]>
): number {
  const relevant = pumps.filter((p) => drivewaySideAt(p.position[1]) === side);
  const clearance = (z: number) =>
    Math.min(
      relevant.reduce((worst, p) => Math.min(worst, Math.abs(p.position[1] - z)), Infinity),
      // A line of cars parked inside the shop is as wrong as one driving
      // through it, so the lay-by clears the buildings too.
      laneClearance(z, spans)
    );


  // Emre'nin 2026-09-02 kararı: yola dönük bir pompanın kuyruğu ayrı bir
  // lay-by'da değil, pompanın KENDİ bay hattında bekler — servis alan aracın
  // tam arkasında, gerçek bir istasyondaki gibi. Sıradaki aracın pompaya
  // gidişi de böylece tek bir ileri hamle olur; şeride çıkıp geri dalma
  // dansı biter. Lay-by seçenekleri ancak öyle bir pompa yoksa, ya da hattı
  // bir binadan geçiyorsa devreye girer.
  const flowX = inward === 1 ? 1 : -1;
  const frontBayLines = relevant
    // Ön yüz artık oyuncunun rotasyonundan gelir; kuyruk ancak akış yönüne
    // bakan bir bay'in arkasında dizilebilir (near +x, far -x).
    .filter((p) => {
      const dir = bayApproachDir(p as { rotation?: number });
      return Math.abs(dir[1]) < 0.01 && dir[0] === flowX;
    })
    .map((p) => ({
      z: p.position[1] + pumpBayOffset(p as { rotation?: number })[1],
      bayX: p.position[0],
      // The head slot: one queue step behind the bay, against the flow.
      headX: p.position[0] - flowX * LAYOUT.queueSpacing
    }))
    .filter(
      ({ z, bayX, headX }) =>
        (z - laneZ) * inward > 0.8 &&
        Math.abs(exitLaneZ - z) > 1.5 &&
        // Yalnızca BİNALARA bakılır: bay tanım gereği pompasına bitişiktir,
        // pompaları da sayan span listesi kendi hattını her seferinde veto
        // ediyordu. Ve yalnızca kuyruğun BAŞINDAN bay'e kadar olan parçaya:
        // hattın kuyruğunda duran bir bina kuyruğu kısaltır, hattı iptal
        // etmez.
        laneClearance(z, buildingSpansOver(headX, bayX)) > 0
    )
    .map(({ z }) => z);
  if (frontBayLines.length > 0) {
    // Birden fazla dönük pompa: yola en yakın hat, akışın ilk karşılaştığı.
    return frontBayLines.reduce((best, z) => ((z - best) * inward < 0 ? z : best));
  }

  const options = QUEUE_LAY_BYS.map((offset) => laneZ + inward * offset).filter(
    (z) => Math.abs(exitLaneZ - z) > 1.5
  );
  if (options.length === 0) return laneZ + inward * QUEUE_LAY_BYS[0];

  return options.reduce((best, z) => (clearance(z) > clearance(best) ? z : best));
}

export interface BlockLayout {
  side: DrivewaySide;
  entry: DrivewayMouth;
  exit: DrivewayMouth;
  /** Circulation lane nearest the road, and the return lane at the back. */
  laneZ: number;
  exitLaneZ: number;
  /** Head of the queue, and the step from one slot to the next behind it. */
  queueHeadX: number;
  queueStep: number;
  /**
   * The queue waits in a lay-by of its own rather than on the lane the other
   * cars use. A line of stopped cars sitting in the through lane is something
   * every following driver has to give way to, which locks the forecourt.
   */
  queueZ: number;
  /** Carriageway serving this block, and where cars join and leave it. */
  roadLaneZ: number;
  roadStartX: number;
  roadEndX: number;
  /**
   * How much room the approach lane has from the nearest solid thing, in grid
   * units. Negative means it runs through something — which the layout cannot
   * always avoid, so placement uses this to refuse the building that would
   * cause it rather than letting cars drive through walls.
   */
  laneClear: number;
  /** The concrete a vehicle has to stay on. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Geometry for one block, or null when the player owns no paved land there.
 * The far side only exists once the road carries two carriageways.
 */
export function blockLayout(
  state: {
    station: {
      plots: { width: number; height: number; pavedParcels: string[] };
      roadLevel: number;
    };
    buildings?: Record<string, PlacedRamp>;
    pumps?: Record<string, { position: [number, number] }>;
  },
  side: DrivewaySide
): BlockLayout | null {
  const mouths = drivewayMouths(state, side);
  const roadHalfWidth = LAYOUT.roadHalfWidth;
  const farRoadLaneZ = LAYOUT.roadZ - 2 * roadHalfWidth - LAYOUT.medianWidth;

  const box =
    side === 'far'
      ? farSideBounds(state.station.plots.pavedParcels)
      : { minX: 0, maxX: state.station.plots.width, minZ: 0, maxZ: state.station.plots.height };

  if (!box) return null;
  if (side === 'far' && state.station.roadLevel < 2) return null;

  const width = box.maxX - box.minX;
  const depth = box.maxZ - box.minZ;
  // How far in from the road the two lanes sit, shared by both blocks.
  const headIn = Math.max(6, Math.min(width - 5, 12));
  const pumps = Object.values(state.pumps ?? {});
  const inward = side === 'far' ? -1 : 1;
  const front = side === 'far' ? box.maxZ : box.minZ;

  // Cars only use the return lane between the bays and the exit mouth, so that
  // is the only stretch of it a building can get in the way of.
  const sidePumps = pumps.filter((p) => drivewaySideAt(p.position[1]) === side);
  const bayXs = sidePumps.map((p) => p.position[0]);
  const exitMouthX = mouths.exit.x;
  const spans = solidSpans(state, side, [
    bayXs.length > 0 ? Math.min(...bayXs, exitMouthX) : exitMouthX,
    bayXs.length > 0 ? Math.max(...bayXs, exitMouthX) : exitMouthX
  ]);

  // The return lane runs along the back, but only as far back as it can while
  // still clearing whatever the player has built along it.
  const backSpans = spans.map(
    ([a, b]) =>
      [inward * (a - front) - LANE_HALF_WIDTH, inward * (b - front) + LANE_HALF_WIDTH] as [
        number,
        number
      ]
  );
  const roomiest = clearLaneZ(
    [depth - 3, depth - 4.4, depth - 5.8, depth - 7.2].filter((d) => d >= 7),
    backSpans,
    Math.max(7, depth - 3)
  );

  // Squeezing right up against the back boundary is a last resort, not a
  // preference — it is only reached when everything further forward is
  // occupied, so the usual choice is left exactly as it was.
  const backLane =
    laneClearance(roomiest, backSpans) > 0 || laneClearance(depth - 2, backSpans) <= 0
      ? roomiest
      : depth - 2;

  // The approach lane crosses the whole front of the plot, from the mouth the
  // cars come in at to the far end of the bays, so anything standing along
  // that stretch is in its way. It used to be pinned four units in whatever
  // was built there — which is a lane running through the walls of a shop.
  //
  const defaultHeadX = side === 'far' ? box.maxX - headIn : box.minX + headIn;
  const drivenX: [number, number] = [
    Math.min(mouths.entry.x, mouths.exit.x, defaultHeadX, ...bayXs),
    Math.max(mouths.entry.x, mouths.exit.x, defaultHeadX, ...bayXs)
  ];
  const frontSpans = solidSpans(state, side, drivenX);

  // Kept in front of the return lane: the two must not swap places, or the
  // cars arriving and the cars leaving would be running down each other's
  // side of the forecourt.
  //
  // Unlike the return lane it takes the first position that works rather than
  // the roomiest: the approach lane belongs just inside the mouth, and a lane
  // that drifted deeper into the plot every time something was built near it
  // would rearrange the whole forecourt for no reason. Its own spot is tried
  // first, and only if that is occupied does it hunt for a gap — finely, and
  // measured by what a car actually needs rather than by the width of a lane,
  // because a forecourt built up at the front may leave nothing wider.
  const gaps: number[] = [4];
  const nearestLane = FRONTAGE_DEPTH + CAR_HALF_SPAN;
  for (let d = nearestLane; d < backLane - 2.5; d += 0.4) gaps.push(Number(d.toFixed(1)));

  const frontLane = firstClearLaneZ(
    gaps,
    frontSpans.map(([a, b]) => [
      inward * (a - front) - CAR_HALF_SPAN,
      inward * (b - front) + CAR_HALF_SPAN
    ]),
    4
  );

  // Widened by what a car takes up, so the clearance test asks whether one
  // fits rather than whether its centre line happens to miss the wall — the
  // same measure the lane itself was chosen with.
  const padded = frontSpans.map(
    ([a, b]) => [a - CAR_HALF_SPAN, b + CAR_HALF_SPAN] as [number, number]
  );

  const laneZ = front + inward * frontLane;
  const exitLaneZ = front + inward * backLane;
  const laneClear = laneClearance(laneZ, padded);
  // What stands on a bay line only matters where the queue actually forms:
  // the stretch from the head slot up to the bay. Measured over the whole
  // driven front, a toilet in the far corner vetoed the line (Emre,
  // 2026-09-07) — the queue moved four tenths behind it, the head car turned
  // in at that slight angle and caught its corner on the island, and every
  // slot behind it was inside the toilet's margin, so the queue collapsed
  // onto one spot. A building on the tail merely shortens the queue.
  const buildingSpansOver = (fromX: number, toX: number) =>
    solidSpans({ buildings: state.buildings }, side, [fromX, toX]).map(
      ([a, b]) => [a - CAR_HALF_SPAN, b + CAR_HALF_SPAN] as [number, number]
    );
  const layByZ = queueLayByZ(laneZ, exitLaneZ, inward, pumps, side, padded, buildingSpansOver);

  // The head of the queue stays BEHIND any bay that sits on the queue's own
  // line: a head beyond one is a line whose front car has to squeeze past
  // whoever is being served to take its place, and that squeeze never opens —
  // the queue crawled forever and no car ever actually stood in it. Pumps
  // deep in the plot share no ground with the lay-by, so they leave the head
  // where it has always been.
  const baysOnTheLine = sidePumps
    .filter((p) => Math.abs(p.position[1] - layByZ) < 3)
    .map((p) => p.position[0]);
  const queueHeadX =
    side === 'far'
      ? Math.max(defaultHeadX, ...baysOnTheLine.map((x) => x + LAYOUT.queueSpacing))
      : Math.min(defaultHeadX, ...baysOnTheLine.map((x) => x - LAYOUT.queueSpacing));

  return side === 'far'
    ? {
        side,
        ...mouths,
        laneZ,
        exitLaneZ,
        laneClear,
        queueHeadX,
        queueStep: LAYOUT.queueSpacing,
        queueZ: layByZ,
        roadLaneZ: farRoadLaneZ,
        roadStartX: box.maxX + LAYOUT.roadMargin,
        roadEndX: box.minX - LAYOUT.roadMargin,
        ...box
      }
    : {
        side,
        ...mouths,
        laneZ,
        exitLaneZ,
        laneClear,
        queueHeadX,
        queueStep: -LAYOUT.queueSpacing,
        queueZ: layByZ,
        roadLaneZ: LAYOUT.roadZ,
        roadStartX: box.minX - LAYOUT.roadMargin,
        roadEndX: box.maxX + LAYOUT.roadMargin,
        ...box
      };
}

/**
 * Where the price totem stands: on the verge, midway between the two mouths,
 * facing the road.
 *
 * A real forecourt does not have a choice about this — the board goes where
 * drivers read it from the carriageway before they commit to the turn — so the
 * game does not offer one either. It follows the mouths, which means widening
 * a ramp or buying more frontage moves the board with them.
 */
export function priceSignPosition(state: {
  station: { plots: { width: number; height: number; pavedParcels: string[] }; roadLevel: number };
  buildings?: Record<string, { type: string; position: [number, number]; size?: [number, number] }>;
}): [number, number] {
  const mouths = drivewayMouths(state, 'near');
  return [Math.round(((mouths.entry.x + mouths.exit.x) / 2) * 2) / 2, DRIVEWAY_Z];
}

/**
 * Keeps the totem on its mark until the player moves it themselves. Cheap
 * enough to do every tick, which saves hunting down every action that could
 * move a mouth — buying land, widening a ramp, loading an older save — and
 * getting one of them wrong.
 */
export function syncPriceSign(state: GameState): void {
  const sign = Object.values(state.buildings).find((b) => b.type === 'price_sign');
  if (!sign) return;

  // Once the player has chosen a spot for it, that is the spot. The default is
  // there to save them a decision, not to overrule one they have made.
  if (sign.movedByPlayer) return;

  const [x, z] = priceSignPosition(state);
  if (sign.position[0] !== x || sign.position[1] !== z) {
    sign.position = [x, z];
  }
}

/**
 * The time of day `gameTime` represents.
 *
 * The clock runs from 6 straight through to 30 so that a day is one unbroken
 * increasing number — but anything asking what time it *is* wants 06:00 to
 * 05:59, so it asks here rather than reading the raw value and getting 27.
 */
export function hourOfDay(gameTime: number): number {
  return ((gameTime % 24) + 24) % 24;
}

/** Which block a vehicle belongs to. The median keeps the two sets apart. */
export function vehicleSide(vehicle: { worldPosition: [number, number, number] }): DrivewaySide {
  return drivewaySideAt(vehicle.worldPosition[2]);
}

/** Which block a pump stands on. */
export function pumpSide(pump: { position: [number, number] }): DrivewaySide {
  return drivewaySideAt(pump.position[1]);
}

/** How far to the side of a pump a vehicle parks, in grid units. */
export const PUMP_BAY_OFFSET = 1.4;
/**
 * A charging post is a slim pillar, not a two-sided island: the car pulls up
 * right beside it, on the same slab (Emre, 2026-09-07, after the reference
 * game). Its bay sits this far from the post's centre, in grid units.
 */
export const CHARGER_BAY_OFFSET = 0.9;

/** Whether this service point is a charging post rather than a pump. */
export function isChargerType(type?: string): boolean {
  return type === 'ev_charger_ac' || type === 'ev_charger_dc';
}

/** True when a quarter turn has put a pump's serving faces on the z axis. */
export function pumpFacesAcrossZ(pump: { rotation?: number }): boolean {
  const turn = ((pump.rotation ?? 0) % 360 + 360) % 360;
  return turn === 90 || turn === 270;
}

/**
 * Where a car stands to be served, relative to the island.
 *
 * Emre'nin 2026-09-02 kararı: yapının ÖN YÜZÜ oyuncunundur. Duruş alanı
 * yapının yerel +x yüzüne aittir ve inşaatta yapı hangi yöne çevrildiyse
 * onunla birlikte döner — motor şeride bakıp kendi kararını vermez. Oyuncu
 * pompayı/şarjı çevirerek aracın nereye yanaşacağını kendisi seçer:
 * rot 0 → +x, 90 → -z (yeni oyunun yola dönük pompası), 180 → -x, 270 → +z.
 */
export function pumpBayOffset(pump: { rotation?: number; type?: string }): [number, number] {
  const theta = ((((pump.rotation ?? 0) % 360) + 360) % 360) * (Math.PI / 180);
  const reach = isChargerType(pump.type) ? CHARGER_BAY_OFFSET : PUMP_BAY_OFFSET;
  return [
    Math.round(reach * Math.cos(theta) * 1000) / 1000 + 0,
    Math.round(-reach * Math.sin(theta) * 1000) / 1000 + 0
  ];
}

/**
 * Bay'de duran aracın baktığı doğrultu (birim, eksene hizalı): yapının yerel
 * +z ekseni, rotasyonla dünyaya çevrilmiş. Yanaşma, hazırlık noktası ve
 * ayrılıştaki "önce ileri çık" hamlesi hep bu doğrultuyu kullanır.
 */
export function bayApproachDir(pump: { rotation?: number }): [number, number] {
  const theta = ((((pump.rotation ?? 0) % 360) + 360) % 360) * (Math.PI / 180);
  return [
    Math.round(Math.sin(theta) * 1000) / 1000 + 0,
    Math.round(Math.cos(theta) * 1000) / 1000 + 0
  ];
}

/** Duruş alanının kapladığı zemin: bir araçlık dikdörtgen, grid biriminde. */
export const SERVICE_BAY_TYPES = ['pump_standard', 'ev_charger_ac', 'ev_charger_dc'];

export function serviceBayRect(
  position: [number, number],
  rotation: number,
  size: [number, number] = [2, 3],
  type?: string
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const [ox, oz] = pumpBayOffset({ rotation, type });
  // Uzun kenar, aracın durduğu doğrultuda (bay ofsetine dik eksen).
  const alongX = Math.abs(ox) < 0.01;
  const hx = alongX ? 1.0 : 0.6;
  const hz = alongX ? 0.6 : 1.0;
  const rect = {
    minX: position[0] + ox - hx,
    maxX: position[0] + ox + hx,
    minZ: position[1] + oz - hz,
    maxZ: position[1] + oz + hz
  };

  // İç kenar, yapının kendi ayak izinden başlar: alan adaya yaslıdır ama
  // adayla çakışmaz — yoksa yapı kendi duruş alanıyla "çarpışır"dı.
  const turned = rotation % 180 !== 0;
  const islandHx = (turned ? size[1] : size[0]) / 2;
  const islandHz = (turned ? size[0] : size[1]) / 2;
  if (ox > 0.01) rect.minX = Math.max(rect.minX, position[0] + islandHx);
  if (ox < -0.01) rect.maxX = Math.min(rect.maxX, position[0] - islandHx);
  if (oz > 0.01) rect.minZ = Math.max(rect.minZ, position[1] + islandHz);
  if (oz < -0.01) rect.maxZ = Math.min(rect.maxZ, position[1] - islandHz);

  // A car leaving a post rolls a length ahead before it turns, so the post
  // needs that much open ground in front of its bay. Claimed as part of the
  // bay, so a post cannot be put nose-on to a pump island or a wall.
  if (isChargerType(type)) {
    const [dx, dz] = bayApproachDir({ rotation });
    const ahead = 1.2;
    if (dx > 0.01) rect.maxX += ahead;
    if (dx < -0.01) rect.minX -= ahead;
    if (dz > 0.01) rect.maxZ += ahead;
    if (dz < -0.01) rect.minZ -= ahead;
  }
  return rect;
}

/**
 * How far back along the island a car lines itself up before rolling into a
 * turned pump's bay. Roughly a car length, so the last leg is long enough to
 * settle the heading rather than snapping it on arrival.
 */
const PUMP_APPROACH_RUN = 2.4;

const BASE_DRIVE_SPEED = 3.6; // grid units per game-second

/**
 * Longest step the vehicle update is allowed to take. Everything else in the
 * tick is happy with whatever the frame hands it, but a following distance is
 * only as good as how often it is measured: at four times speed a car covers
 * several metres between frames, and would jump straight through the gap it is
 * supposed to be keeping.
 */
const MAX_VEHICLE_STEP = 0.12;

/**
 * Highway pace. Cars on the carriageway are travelling, not manoeuvring, and
 * the forecourt crawl that suits a pump island looks like a fault out on the
 * road — quite apart from taking all day to cross the map.
 */
const HIGHWAY_SPEED = 2.4;

/** Whether a vehicle is out on the carriageway rather than on the concrete. */
function highwayPace(vehicle: VehicleEntity, block: BlockLayout): number {
  return Math.abs(vehicle.worldPosition[2] - block.roadLaneZ) < 1 ? HIGHWAY_SPEED : 1;
}

/**
 * Keeps a forecourt waypoint on the concrete of its own block. Highway legs
 * deliberately sit outside the plot and never go through here.
 */
function clampToApron(
  block: BlockLayout,
  point: [number, number, number]
): [number, number, number] {
  const m = LAYOUT.apronMargin;
  return [
    clamp(point[0], block.minX + m, Math.max(block.minX + m, block.maxX - m)),
    point[1],
    clamp(point[2], block.minZ + m, Math.max(block.minZ + m, block.maxZ - m))
  ];
}

/**
 * The same, for a waypoint that stands in a driveway's lane.
 *
 * The apron margin is a *parking* figure — half a car length, so no bodywork
 * overhangs the edge — and the outer lane of a mouth at the end of the
 * frontage falls inside it. Clamped by that, the lane collapsed onto the
 * ramp's centre line: cars left a two-lane ramp down the middle of it instead
 * of down one of its lanes, which is the whole point of having widened it.
 * Driving past something only asks for the car's own width, so that is what
 * the lane is held to sideways; the apron margin still governs how deep into
 * the plot the point may sit.
 */
function clampLaneToApron(
  block: BlockLayout,
  point: [number, number, number]
): [number, number, number] {
  const [, y, z] = clampToApron(block, point);
  const min = block.minX + LANE_HALF_WIDTH;
  const max = Math.max(min, block.maxX - LANE_HALF_WIDTH);
  return [clamp(point[0], min, max), y, z];
}

/**
 * Bumper-to-bumper distance a driver holds from whatever is in front, in grid
 * units, and how wide a corridor counts as being in the way. A vehicle is
 * about two units long, so this leaves roughly half a car length of air.
 */
const FOLLOW_DISTANCE = 2.8;
/** Low-speed apron gap: one car body plus a visible bumper margin. */
const FORECOURT_FOLLOW_DISTANCE = 1.9;
const FOLLOW_CORRIDOR = 1.2;

/**
 * Nobody comes closer than this to anybody, whatever direction either is
 * facing. A car is about this wide, so it is the line between passing beside
 * someone and passing through them.
 */
const CAR_CLEARANCE = 1.4;

export { vehicleBodyHalfExtents } from './vehicleBody';

/**
 * The gap in the traffic a driver waits for before joining a carriageway.
 *
 * Deliberately modest. Traffic on the road gives way to a car that has already
 * committed to the merge, so demanding a long gap does not make the join safer
 * — it just means the gap never comes, departures back up across the whole
 * forecourt, and the arrivals behind them stack in the entrance.
 */
const MERGE_GAP = 4;

/**
 * Extra room demanded from traffic COMING UP BEHIND the join point. A passing
 * car travels at highway pace and covers four grid units in the half-second
 * the descent takes — a gap that looked adequate at the kerb closes before
 * the joining car's tail clears the lane. Ahead of the join the plain gap
 * still applies; whoever is already past cannot be driven into.
 */
const MERGE_GAP_BEHIND_PAD = 3;

/**
 * How close to a lane a driver has to be before waiting for a gap in it. Any
 * further out and they would be holding station halfway across the forecourt
 * for traffic they have not reached yet, which backs the whole plot up behind
 * them — a driver waits at the give-way line, not two streets before it.
 */
const MERGE_LOOKAHEAD = 5;

/**
 * Where a driver waiting for that gap actually stops.
 *
 * It used to be one unit off the lane's centre line — which is not beside the
 * carriageway, it is *in* it. A car holding there had its nose in the traffic
 * it was waiting for, close enough to be clipped by it and far enough off the
 * through path that the passing driver had no reason to brake; the pair then
 * sat locked together while the queue built up behind. The give-way line
 * belongs at the kerb, clear of the lane by half a car.
 */
const MERGE_HOLD_LINE = LAYOUT.roadHalfWidth + CAR_CLEARANCE / 2;

/**
 * How long a driver will sit behind an obstruction before edging past it. Two
 * cars crossing paths can each be waiting on the other, and a forecourt that
 * locks up is worse than two cars briefly sharing a metre of tarmac.
 */
const BLOCKED_LIMIT_SECONDS = 5;

/** Below this a driver counts as held up rather than merely following. */
const CRAWL_THROTTLE = 0.4;

/**
 * How long a driver puts up with going nowhere before giving up on the whole
 * visit. Cars crossing each other's paths can form a ring where every one of
 * them is waiting on the next, and no give-way rule can unpick that from the
 * inside — so every state has a way out. Without one the ring simply stays on
 * the forecourt for the rest of the day, and everything queues behind it.
 */
const STUCK_LIMIT_SECONDS = 20;

/** Where a vehicle is pointing, or null when it is not going anywhere. */
function headingVector(vehicle: VehicleEntity): { x: number; z: number } | null {
  const target = vehicle.targetWaypoint;
  if (!target) return null;

  const dx = target[0] - vehicle.worldPosition[0];
  const dz = target[2] - vehicle.worldPosition[2];
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return null;

  return { x: dx / length, z: dz / length };
}

/**
 * How far ahead `other` sits along `vehicle`'s path, or null when it is beside
 * it, behind it, or far enough off the line not to be in the way.
 */
function distanceAhead(
  vehicle: VehicleEntity,
  other: VehicleEntity,
  dir: { x: number; z: number }
): number | null {
  const ox = other.worldPosition[0] - vehicle.worldPosition[0];
  const oz = other.worldPosition[2] - vehicle.worldPosition[2];

  const ahead = ox * dir.x + oz * dir.z;

  // Anything this close is in the way whichever direction either car faces —
  // judging only by what is dead ahead lets two cars cutting across each
  // other's path meet in the middle without either giving way. But a car
  // squarely behind is not in the way at all, and treating it as one has the
  // leader waiting on its own follower while the follower waits on the leader.
  const separation = Math.hypot(ox, oz);
  if (separation < CAR_CLEARANCE && ahead > -CAR_CLEARANCE * 0.4) return separation;

  if (ahead <= 0) return null;

  const lateral = Math.abs(ox * dir.z - oz * dir.x);
  return lateral <= FOLLOW_CORRIDOR ? ahead : null;
}

/**
 * How much of its speed a vehicle may use, given what is in front of it.
 *
 * Every vehicle obeys this — out on the highway, down the ramps and across the
 * forecourt alike — so cars fall in behind one another instead of driving
 * through each other, and a busy station backs up the way a real one does.
 * Easing off rather than stopping dead means a quick car settles in behind a
 * slow one instead of snapping to a halt.
 */
/**
 * Every tanker on the plot or the road, shaped like traffic for the following
 * rules. A lorry is three car-lengths of steel, so it enters the list as
 * three bodies — nose, middle, tail — and a car braking for any of them is a
 * car that no longer drives through the trailer.
 */
function truckBodies(state: GameState): VehicleEntity[] {
  const bodies: VehicleEntity[] = [];

  for (const order of state.fuelOrders) {
    const truck = order.truck;
    if (!truck) continue;

    const dx = Math.sin(truck.heading);
    const dz = Math.cos(truck.heading);
    for (const along of [-1.1, 0, 1.1]) {
      bodies.push({
        id: `truck_${order.id}_${along}`,
        worldPosition: [
          truck.worldPosition[0] + dx * along,
          0,
          truck.worldPosition[2] + dz * along
        ],
        // Only the nose is "going somewhere"; the other two are cargo.
        targetWaypoint: along > 0 ? truck.targetWaypoint : null,
        route: [],
        heading: truck.heading
      } as unknown as VehicleEntity);
    }
  }

  return bodies;
}

/**
 * On the apron a crossing vehicle yields briefly, then eases through. A hard
 * reservation between every pair produced wait rings with three or more cars
 * (A waits for B, B for C, C for A). The small grace keeps crossings readable
 * while guaranteeing that a bus can never hold the whole forecourt hostage.
 */
const FORECOURT_CROSSING_GRACE_SECONDS = 0.75;

function followThrottle(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout
): { throttle: number; gap: number } {
  const dir = headingVector(vehicle);
  if (!dir) return { throttle: 1, gap: Infinity };

  const target = vehicle.targetWaypoint!;
  // The spread costs real time at 20Hz across every car; with no lorry about
  // — which is most of every day — the plain list is the same list.
  const traffic =
    state.fuelOrders.length === 0
      ? Object.values(state.vehicles)
      : [...Object.values(state.vehicles), ...truckBodies(state)];

  // Following distance is really a following *time*: a car travelling at
  // highway pace needs proportionally more room to shed that speed, and a gap
  // that is ample on the forecourt is nothing at all out on the road.
  const pace = highwayPace(vehicle, block);
  const ownBody = vehicleBodyHalfExtents(vehicle);
  const baseDistance = pace > 1 ? FOLLOW_DISTANCE : FORECOURT_FOLLOW_DISTANCE;
  const wanted = (baseDistance + Math.max(0, ownBody.length - 0.9)) * pace;

  // Joining a lane is a different problem from following it: the car that
  // matters is coming along the lane, not sitting in front. A driver pulling
  // out of a bay cannot see it that way and would edge straight into its side.
  //
  // Only traffic coming up from behind counts, because the carriageway is
  // one-way and anything ahead of the join is already leaving.
  const joining = (laneZ: number, hold: number) => {
    const away = Math.abs(vehicle.worldPosition[2] - laneZ);
    return Math.abs(target[2] - laneZ) < 1 && away >= hold && away < MERGE_LOOKAHEAD;
  };

  if (joining(block.roadLaneZ, MERGE_HOLD_LINE)) {
    const flow = Math.sign(block.roadEndX - block.roadStartX);
    const myAway = Math.abs(vehicle.worldPosition[2] - block.roadLaneZ);

    // İniş SERİLEŞTİRİLİR: aynı katılım noktasına inenlerden yalnız şeride en
    // yakın olan yola iner; diğerleri onunkini "kullanılan boşluk" sayar.
    // Tesis içinde araçlar birbirine hayalet olduğundan iki araç aynı bekleme
    // noktasında üst üste durabiliyor ve aynı boşlukta BİRLİKTE inip
    // karayolunda 0.1 arayla kilitli bir çift doğuruyordu. Beraberlik (üst
    // üste duran çift) kimlikle bozulur ki karar her tick aynı çıksın.
    const descentBusy = traffic.some((other) => {
      if (other.id === vehicle.id) return false;
      const merging = other.targetWaypoint;
      if (!merging || merging[0] !== target[0] || merging[2] !== target[2]) return false;
      const theirAway = Math.abs(other.worldPosition[2] - block.roadLaneZ);
      if (theirAway < myAway - 0.05) return true;
      return Math.abs(theirAway - myAway) <= 0.05 && other.id < vehicle.id;
    });

    // Açlık valfi: hiç kimse sonsuza dek kapıda bekletilmez. Yoğun günde
    // konveyör hiç aralık vermeyebilir; birkaç saniye bekleyen sürücü gerçek
    // hayattaki gibi giderek daha dar aralığa burnunu sokar.
    const waited = vehicle.blockedSeconds ?? 0;
    const patience = waited > 10 ? 0.5 : waited > 6 ? 0.75 : 1;

    const noGap =
      descentBusy ||
      traffic.some((other) => {
        if (other.id === vehicle.id) return false;
        if (Math.abs(other.worldPosition[2] - block.roadLaneZ) >= 1) return false;
        const behind = (target[0] - other.worldPosition[0]) * flow;
        return (
          behind > -CAR_CLEARANCE &&
          behind < (MERGE_GAP + (behind > 0 ? MERGE_GAP_BEHIND_PAD : 0)) * patience
        );
      });
    // gap: 0, bilerek — driveInTraffic'in sabırsızlık dürtmesi "önümde yer
    // var" (gap > CAR_CLEARANCE) diyen aracı 5 saniyede bir ileri iter. Yol
    // vermek sabırsızlanılacak bir şey değildir: çizgide dürtülen araç burnu
    // şeritte, akan trafiğin ortasında kalakalıyordu.
    if (noGap) return { throttle: 0, gap: 0 };
  }

  // Forecourt traffic used to become "ghosts" past the kerb so an awkward
  // layout could never form a queue. That avoided one kind of gridlock by
  // introducing two worse ones: customers drove through each other and
  // through delivery lorries. The same deterministic right-of-way rule used
  // at the driveway now applies across the plot. Mutual conflicts are broken
  // by stable id below, while customer cars always yield to the synthetic
  // lorry bodies in `traffic`.

  const toTarget = Math.hypot(
    target[0] - vehicle.worldPosition[0],
    target[2] - vehicle.worldPosition[2]
  );

  let nearest = Infinity;
  const onForecourt = pace <= 1 && Math.abs(vehicle.worldPosition[2] - block.roadLaneZ) >= 1.5;
  const softenCrossing = onForecourt && (vehicle.blockedSeconds ?? 0) >= FORECOURT_CROSSING_GRACE_SECONDS;

  for (const other of traffic) {
    if (other.id === vehicle.id) continue;
    // Marked bays in the same park are closer than the generic traffic
    // corridor. Each car owns a different slot, so the neighbour beside its
    // final approach is not a vehicle ahead and must not stop it short.
    if (
      !other.id.startsWith('truck_') &&
      other.state === 'VISITING' &&
      isParkingNeighbour(vehicle, other)
    ) continue;

    // Routes meet at shared points — the mouth of a ramp, the head of the
    // exit lane. Two cars converging on one from different directions cannot
    // see each other ahead until they are already touching, so at a shared
    // waypoint the one closer to it goes first.
    const merging = other.targetWaypoint;
    if (!softenCrossing && merging && merging[0] === target[0] && merging[2] === target[2]) {
      const theirs = Math.hypot(
        merging[0] - other.worldPosition[0],
        merging[2] - other.worldPosition[2]
      );
      if (theirs < toTarget) nearest = Math.min(nearest, toTarget - theirs);
    }

    const gap = other.id.startsWith('truck_')
      ? truckBodyAhead(vehicle, other, dir)
      : distanceAhead(vehicle, other, dir);
    if (gap === null) continue;
    const otherBody = vehicleBodyHalfExtents(other);
    const bodyAdjustedGap = gap - Math.max(0, otherBody.length - 0.9);
    if (bodyAdjustedGap >= nearest) continue;

    // Two cars nose to nose would both give way and neither would ever move
    // again. One of them has to have right of way, and the id decides so that
    // the choice is the same on every tick.
    const theirDir = headingVector(other);
    const mutual = theirDir !== null && distanceAhead(other, vehicle, theirDir) !== null;
    // Same-lane followers remain solid queues. Only crossing or nose-to-nose
    // traffic gets the short apron grace, and tankers remain solid everywhere.
    if (softenCrossing && mutual && !other.id.startsWith('truck_')) continue;
    if (mutual && vehicle.id < other.id) continue;

    // Whoever gives way holds back by a full car rather than creeping up to
    // the other's bumper, so it is not left sitting across the path of the car
    // it just waved through.
    nearest = mutual ? bodyAdjustedGap - CAR_CLEARANCE : bodyAdjustedGap;
  }

  if (nearest === Infinity) return { throttle: 1, gap: Infinity };
  return { throttle: clamp((nearest - wanted) / wanted, 0, 1), gap: nearest };
}

/** True once a driver has spent longer than anyone would getting nowhere. */
function isWedged(vehicle: VehicleEntity): boolean {
  return (vehicle.blockedSeconds ?? 0) > STUCK_LIMIT_SECONDS;
}

/**
 * Emre'nin 2026-09-02 kuralı: yapılar KATIDIR. Rota ne derse desin, bir
 * aracın gövdesi bina ya da pompa adasının içine giremez — duvara gelen araç
 * orada takılır, içinden sızmaz. Hafif küçültülmüş ayak izi, bay'de pompaya
 * bitişik duran aracın santimlik sürtünmesini takılma saymamak için.
 */
const SOLID_SHRINK = -0.15;

/** Everything on a block a car body may not enter, at solid tolerance. */
function solidRects(
  state: GameState,
  side: DrivewaySide,
  ignoreBuildingId?: string | null
): PathRect[] {
  // Binalar sıfır toleransla katıdır. Küçültme payı yalnız araç dibinde
  // durulan yapılara — pompa adaları VE şarj direkleri: bay'e yanaşan aracın
  // santimlik sürtünmesi takılma sayılmasın. (Şarj direği bina listesinde
  // 0 toleransla dururken, katalog boyutundaki direğe yanaşan her müşteri
  // 3 santimlik köşe teması yüzünden sonsuza dek yarı yolda kalıyordu.)
  const rects: PathRect[] = [];
  for (const building of Object.values(state.buildings)) {
    if (FLAT_TYPES.includes(building.type)) continue;
    // A mast on the kerb line is no wall to press against either, or a car
    // would stop dead against something the route quite rightly ignored.
    if (
      KERB_LINE_PROPS.includes(building.type) &&
      onKerbLine(state.station.plots, building.position, side)
    ) {
      continue;
    }
    // The park this car has a bay in is the one building it may drive into.
    if (building.id === ignoreBuildingId) continue;
    if (drivewaySideAt(building.position[1]) !== side) continue;
    const turned = building.rotation === 90 || building.rotation === 270;
    const hw = (turned ? building.size[1] : building.size[0]) / 2;
    const hd = (turned ? building.size[0] : building.size[1]) / 2;
    const c = SERVICE_BAY_TYPES.includes(building.type) ? SOLID_SHRINK : 0;
    rects.push({
      minX: building.position[0] - hw - c,
      maxX: building.position[0] + hw + c,
      minZ: building.position[1] - hd - c,
      maxZ: building.position[1] + hd + c
    });
  }
  for (const hole of unpavedHoles(state.station.plots, side)) {
    rects.push(hole);
  }
  rects.push(...pumpRects(state, side, undefined, SOLID_SHRINK));
  return rects;
}

export function bodyInSolid(
  state: GameState,
  vehicle: VehicleEntity,
  side: DrivewaySide,
  x: number,
  z: number,
  heading: number
): boolean {
  return bodyInRects(solidRects(state, side, vehicle.parkingBuildingId), vehicle, x, z, heading);
}

/** Whether any corner of the body, posed here, falls inside one of these. */
function bodyInRects(
  rects: PathRect[],
  vehicle: VehicleEntity,
  x: number,
  z: number,
  heading: number
): boolean {
  if (rects.length === 0) return false;

  const body = vehicleBodyHalfExtents(vehicle);
  const ahead = Math.sin(heading);
  const across = Math.cos(heading);
  for (const along of [-body.length, 0, body.length]) {
    for (const beam of [-body.width, body.width]) {
      const cx = x + ahead * along + across * beam;
      const cz = z + across * along - ahead * beam;
      if (inRects(rects, cx, cz)) return true;
    }
  }
  return false;
}

/** Exact oriented-body overlap for the few cars that are standing in place. */
function vehicleBodiesOverlap(a: VehicleEntity, b: VehicleEntity): boolean {
  const frame = (vehicle: VehicleEntity) => ({
    body: vehicleBodyHalfExtents(vehicle),
    ahead: { x: Math.sin(vehicle.heading), z: Math.cos(vehicle.heading) },
    across: { x: Math.cos(vehicle.heading), z: -Math.sin(vehicle.heading) }
  });
  const one = frame(a);
  const two = frame(b);
  const dx = b.worldPosition[0] - a.worldPosition[0];
  const dz = b.worldPosition[2] - a.worldPosition[2];
  const apart = (axis: { x: number; z: number }) => {
    const reach = (f: typeof one) =>
      Math.abs(f.ahead.x * axis.x + f.ahead.z * axis.z) * f.body.length +
      Math.abs(f.across.x * axis.x + f.across.z * axis.z) * f.body.width;
    return Math.abs(dx * axis.x + dz * axis.z) >= reach(one) + reach(two) - 0.04;
  };
  return !(apart(one.ahead) || apart(one.across) || apart(two.ahead) || apart(two.across));
}

const STANDING_TRAFFIC_STATES: VehicleState[] = [
  'AT_PUMP', 'REQUEST', 'FUELING', 'PAYMENT', 'OPTIONAL_SHOP', 'VISITING'
];

/** Adjacent marked bays deliberately sit closer than two long body boxes. */
function isParkingNeighbour(vehicle: VehicleEntity, other: VehicleEntity): boolean {
  return (
    !!vehicle.parkingBuildingId &&
    vehicle.parkingBuildingId === other.parkingBuildingId &&
    vehicle.parkingSlot != null &&
    other.parkingSlot != null &&
    vehicle.parkingSlot !== other.parkingSlot &&
    (vehicle.state === 'TO_PARK' || vehicle.reversing === true)
  );
}

/** Current service traffic, shaped as temporary walls for a local detour. */
function standingVehicleRects(state: GameState, vehicle: VehicleEntity): PathRect[] {
  const own = vehicleBodyHalfExtents(vehicle);
  return Object.values(state.vehicles)
    .filter(
      (other) =>
        other.id !== vehicle.id &&
        STANDING_TRAFFIC_STATES.includes(other.state) &&
        !isParkingNeighbour(vehicle, other)
    )
    .map((other) => {
      const body = vehicleBodyHalfExtents(other);
      const sin = Math.abs(Math.sin(other.heading));
      const cos = Math.abs(Math.cos(other.heading));
      const halfX = sin * body.length + cos * body.width + own.width + 0.15;
      const halfZ = cos * body.length + sin * body.width + own.width + 0.15;
      return {
        minX: other.worldPosition[0] - halfX,
        maxX: other.worldPosition[0] + halfX,
        minZ: other.worldPosition[2] - halfZ,
        maxZ: other.worldPosition[2] + halfZ
      };
    });
}

/** Whether this step newly entered a car that is parked for service. */
function entersStandingVehicle(
  state: GameState,
  vehicle: VehicleEntity,
  before: [number, number, number],
  headingBefore: number
): boolean {
  const previous = { ...vehicle, worldPosition: before, heading: headingBefore };
  return Object.values(state.vehicles).some((other) =>
    other.id !== vehicle.id &&
    STANDING_TRAFFIC_STATES.includes(other.state) &&
    !isParkingNeighbour(vehicle, other) &&
    vehicleBodiesOverlap(vehicle, other) &&
    !vehicleBodiesOverlap(previous, other)
  );
}

/**
 * Whether a car's body stays out of every solid the whole way along one
 * straight leg, facing the way it travels. Sampled from just past the start:
 * where the car already stands is its own business — a long body at the head
 * of the queue may overlap an island's margin, and driving straight out of
 * that is allowed — but nothing it would drive INTO is.
 */
function bodyClearAlong(
  state: GameState,
  vehicle: VehicleEntity,
  side: DrivewaySide,
  from: [number, number],
  to: [number, number]
): boolean {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return true;

  const rects = solidRects(state, side, vehicle.parkingBuildingId);
  if (rects.length === 0) return true;

  const heading = Math.atan2(dx, dz);
  const steps = Math.max(1, Math.ceil(length / 0.4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (bodyInRects(rects, vehicle, from[0] + dx * t, from[1] + dz * t, heading)) return false;
  }
  return true;
}

/**
 * Drives a vehicle for this tick at whatever speed the traffic allows, and
 * reports whether it finished its route. Every moving vehicle goes through
 * here, which is what keeps the spacing rule impossible to forget.
 */
function driveInTraffic(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout,
  dt: number
): boolean {
  const { throttle, gap } = followThrottle(state, vehicle, block);
  const pace = highwayPace(vehicle, block);
  const blockedBefore = vehicle.blockedSeconds ?? 0;

  // Crawling counts as being held up, not just standing still: a car nosing
  // out onto a road that is never empty would otherwise inch along for the
  // rest of the day without ever tripping the valve below.
  vehicle.blockedSeconds = throttle < CRAWL_THROTTLE ? (vehicle.blockedSeconds ?? 0) + dt : 0;

  // The valve exists so two cars in each other's way cannot freeze the
  // forecourt between them — but it must never be the thing that closes the
  // last metre. Nudging a car that is already bumper to bumper does not free
  // anything: it just presses the queue together, a little every few seconds,
  // until the whole line is standing inside itself. When there is genuinely no
  // room, the driver waits for the car in front like anyone else.
  const held = (vehicle.blockedSeconds ?? 0) > BLOCKED_LIMIT_SECONDS && gap > CAR_CLEARANCE;

  // The nudge is a single moment of impatience, not a licence to barge: the
  // clock restarts so the driver goes back to giving way immediately after.
  if (held) vehicle.blockedSeconds = 0;

  // Katı yapı kuralı: adım bir binanın ya da pompa adasının içinde bitecekse
  // atılmaz — araç duvarın dibinde durur ve takılı sayılır. Yalnızca İÇERİ
  // giren adım engellenir; bir şekilde içeride yakalanmış araç (eski kayıt)
  // dışarı çıkabilir.
  const before: [number, number, number] = [...vehicle.worldPosition];
  const headingBefore = vehicle.heading;
  const targetBefore = vehicle.targetWaypoint
    ? ([...vehicle.targetWaypoint] as [number, number, number])
    : null;
  const routeBefore = vehicle.route.map((point) => [...point] as [number, number, number]);
  const wasInside = bodyInSolid(state, vehicle, block.side, before[0], before[2], headingBefore);

  const arrived = driveToward(
    vehicle,
    dt * pace * (held ? Math.max(throttle, CRAWL_THROTTLE) : throttle)
  );

  if (
    !wasInside &&
    bodyInSolid(
      state,
      vehicle,
      block.side,
      vehicle.worldPosition[0],
      vehicle.worldPosition[2],
      vehicle.heading
    )
  ) {
    vehicle.worldPosition = before;
    vehicle.heading = headingBefore;
    // blockedSeconds burada işe yaramaz — bir sonraki tick'in gaz hesabı onu
    // sıfırlıyor. Duvar takılması kendi saatini tutar.
    const stuckBefore = vehicle.solidStuckSeconds ?? 0;
    vehicle.solidStuckSeconds = stuckBefore + dt;
    if (solidRerouteDue(stuckBefore, vehicle.solidStuckSeconds)) {
      rerouteAroundSolid(
        state,
        vehicle,
        block,
        solidRerouteAttempts(vehicle.solidStuckSeconds)
      );
    }
    return false;
  }

  // The follower handles moving traffic without another all-car scan. A car
  // fixed at a pump or park has no route vector, though, and an exiting car's
  // turning rear corner can otherwise clip it. Roll back only that rare step.
  if (entersStandingVehicle(state, vehicle, before, headingBefore)) {
    vehicle.worldPosition = before;
    vehicle.heading = headingBefore;
    vehicle.targetWaypoint = targetBefore;
    vehicle.route = routeBefore;
    vehicle.blockedSeconds = blockedBefore + dt;

    // Waiting is correct for a moment; waiting until the 20-second despawn
    // valve is not. Once the other car has clearly stopped this manoeuvre,
    // retain the destination but redraw the remaining route around its body.
    if (vehicle.blockedSeconds > 1.5) {
      const remaining = [targetBefore, ...routeBefore].filter(
        (point): point is [number, number, number] => point !== null
      );
      const detour = remaining.length
        ? routeAroundOrNull(
            state,
            vehicle,
            block.side,
            remaining,
            { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
            frontageKeepOut(block),
            vehicle.targetPumpId ?? undefined,
            vehicle.parkingBuildingId ?? undefined,
            standingVehicleRects(state, vehicle)
          )
        : null;
      if (detour) {
        setRoute(vehicle, detour);
        vehicle.blockedSeconds = 0;
      }
    }
    return false;
  }

  vehicle.solidStuckSeconds = 0;
  return arrived;
}

/**
 * Duvara dayanan sürücü heykel olmaz. Katı yapı kuralı adımı geri aldığında
 * araç kısa bir duraksamadan sonra yolunu, engelleri sayan planlayıcıyla
 * baştan çizer: önce kalan rotasının tamamı (açık bacaklar aynen kalır, tıkalı
 * bacağın etrafından dolanılır), o çizilemiyorsa — bir ara nokta sonradan
 * yapılan binanın içinde kalmışsa — yalnız varış noktasına taze bir yol,
 * ayrılan araç için o da yoksa çıkışın kendisi. Deneme, boşa çıkarsa birkaç
 * saniyede bir yenilenir: oyuncu bu arada bir duvarı kaldırmış olabilir.
 *
 * Takılma saati burada SIFIRLANMAZ — onu yalnız gerçekten atılan adım sıfırlar
 * (yukarıda), ki hiçbir yolun kalmadığı arsada 20 saniyelik güvenlik valfleri
 * aynen işlemeye devam etsin.
 */
const SOLID_REROUTE_FIRST_SECONDS = 1.5;
const SOLID_REROUTE_EVERY_SECONDS = 3;

function solidRerouteAttempts(t: number): number {
  return t < SOLID_REROUTE_FIRST_SECONDS
    ? 0
    : 1 + Math.floor((t - SOLID_REROUTE_FIRST_SECONDS) / SOLID_REROUTE_EVERY_SECONDS);
}

function solidRerouteDue(stuckBefore: number, stuckNow: number): boolean {
  return solidRerouteAttempts(stuckNow) > solidRerouteAttempts(stuckBefore);
}

function rerouteAroundSolid(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout,
  attempt: number
): void {
  const remaining: Array<[number, number, number]> = vehicle.targetWaypoint
    ? [vehicle.targetWaypoint, ...vehicle.route]
    : [...vehicle.route];
  const goal = remaining[remaining.length - 1];
  if (!goal) return;

  const ignorePump = vehicle.targetPumpId ?? undefined;
  const ignoreBuilding = vehicle.chargingBuildingId ?? undefined;

  // Her seçenek gövde sınavından geçmek zorunda: planlayıcı, ucu bir adanın
  // payına düşen rotada o adayı bütünüyle affeder — bay'e yanaşmak için doğru,
  // kaçış planı içinse yalan. "Temiz" görünen rota gövdeyi adaya sürer, katı
  // kural adımı geri alır ve araç aynı yalancı planla sonsuza dek yerinde
  // sayardı.
  const planFrom = (from: VehicleEntity): Array<[number, number, number]> | null => {
    // Yoldan uzaktaki bir noktaya (roadEndX) dümdüz inen "kestirme" rota,
    // yol-verme kuralını atlatır: joining() katılım noktasını hedefin x'inden
    // ölçer ve hedef ufukta olunca boşluk denetimi hiç tutmaz — araç akan
    // trafiğin içine dalar. Ayrılan araç bu yüzden ham [goal] yerine, yola
    // düzgün katılım bacakları kuran exitRoute ile çıkar.
    // Ayrılan araç için ham [goal] seçeneği YOK: hedef yolun ucudur, arsanın
    // dışındadır, ve planlayıcı ona giden düz bacağı arsanın yan ya da arka
    // kenarından çıkarabilir — araç tarladan yola iniyor, yoldakiler onu
    // trafik sanıp bekliyor, o da yola bağlanamayıp 20 saniyede siliniyordu
    // (Emre, 2026-09-09). Yoldan çıkış yalnız ağızdan olur: exitRoute.
    const options =
      vehicle.state === 'EXIT'
        ? [
            () => driveable(state, from, block, remaining, ignorePump, ignoreBuilding),
            () => exitRoute(state, from)
          ]
        : [
            () => driveable(state, from, block, remaining, ignorePump, ignoreBuilding),
            () => driveable(state, from, block, [goal], ignorePump, ignoreBuilding)
          ];
    for (const option of options) {
      const route = option();
      if (route && routeBodyClear(state, from, block.side, from.worldPosition, route)) return route;
    }
    return null;
  };

  const direct = planFrom(vehicle);
  if (direct) {
    setRoute(vehicle, direct);
    return;
  }

  // Son çare: duvarın dibine yapışmış araç, planlayıcının dönüş payı içinde
  // kaldığı için A* daha ilk adımda tıkanabilir — oysa gövdenin gerçekten
  // sığdığı bir kaçış adımı çoğu zaman vardır. Yakın çevrede boş bir nokta
  // bulunur ve rota ORADAN çizilir; araç önce o noktaya sıyrılır, gerisini
  // olağan plan götürür. Kaçış adımının kendisini yine katı yapı kuralı
  // denetler: gerçekten giremeyeceği yere zaten giremez. Böylece cebe düşen
  // araç rezerve edilmiş ön yola çıkıp çıkışı kullanır; silinip yok olmak
  // hiçbir yolun kalmadığı arsaya saklanmış son valftir.
  // Kaçış adımı ilk denemede değil, İKİNCİDEN itibaren: anlık bir sürtünme
  // kendi kendine çözülür ve daha ilk saniyede yan yollara sapan araçlar
  // önalanın akışını gereksiz yere karıştırıyordu. İki tam deneme boyunca
  // kımıldayamamış araç ise gerçekten ceptedir — yan adım artık gürültü
  // değil, tek çıkış umududur.
  if (attempt < 2) return;

  for (const escape of escapeHops(state, vehicle, block, goal, ignorePump)) {
    const ghost = { ...vehicle, worldPosition: escape } as VehicleEntity;
    const onward = planFrom(ghost);
    if (onward) {
      setRoute(vehicle, [escape, ...onward]);
      return;
    }
  }

}

/**
 * Rotanın tamamı gövdeyle sürülebilir mi? Katı yapı kuralının (bodyInSolid)
 * adım adım soracağı soruyu peşinen sorar: rota boyunca örneklenen her
 * noktada araç gövdesi bir binanın ya da adanın içine girmemeli.
 *
 * İlk araç boyunun muafiyeti, sürücünün kendi kuralıyla AYNI koşula bağlıdır:
 * yalnız gövdesi hâlihazırda bir katının içinde yakalanmış araç (eski kayıt,
 * sonradan dikilen bina) oradan çıkabilsin diye. Muafiyet koşulsuz olduğunda,
 * bay'de duran aracın olduğu yerde dönüp kuyruğunu adaya sokan rotası
 * "sürülebilir" görünüyor, sürücü her adımı geri alıyor ve araç pompanın
 * dibinde donup kalıyordu — üstelik pompa serbest bırakıldığı için bir sonraki
 * müşteri aynı bay'e, duran aracın ÜSTÜNE yanaşıyordu (Emre, 2026-09-09).
 */
export function routeBodyClear(
  state: GameState,
  vehicle: VehicleEntity,
  side: DrivewaySide,
  from: [number, number, number],
  route: Array<[number, number, number]>
): boolean {
  const startsInside = bodyInSolid(state, vehicle, side, from[0], from[2], vehicle.heading);
  let px = from[0];
  let pz = from[2];
  let travelled = 0;

  for (const [wx, , wz] of route) {
    const dx = wx - px;
    const dz = wz - pz;
    const length = Math.hypot(dx, dz);
    if (length > 1e-6) {
      const heading = Math.atan2(dx, dz);
      const steps = Math.ceil(length / 0.3);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (startsInside && travelled + length * t < 1) continue;
        if (bodyInSolid(state, vehicle, side, px + dx * t, pz + dz * t, heading)) return false;
      }
    }
    travelled += length;
    px = wx;
    pz = wz;
  }
  return true;
}

/**
 * Bir doğru parçası bu dikdörtgenin İÇİNDEN geçiyor mu — örnekleme değil,
 * kesin kesişim (slab yöntemi). legIsClear 0.25 aralıkla örnekler ve köşeyi
 * teğet sıyıran 0.1-0.2 birimlik bir dilim iki örneğin arasından kaçabilir;
 * fuzz'ın yakaladığı "ofisin köşesinden geçen kaçış adımı" tam buydu.
 */
function segmentCrossesRect(
  a: [number, number],
  b: [number, number],
  r: PathRect
): boolean {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];

  let enter = 0;
  let leave = 1;
  const slab = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > leave) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < leave) leave = t;
    }
    return true;
  };

  const overlapsRect =
    slab(-dx, a[0] - r.minX) &&
    slab(dx, r.maxX - a[0]) &&
    slab(-dz, a[1] - r.minZ) &&
    slab(dz, r.maxZ - a[1]);

  return overlapsRect && leave - enter > 1e-6;
}

/**
 * Sıkışan aracın etrafındaki, gövdenin gerçekten durabileceği boş noktalar —
 * hedefe yakınlığına göre sıralı. Nokta yarım araç payıyla (0.5) boşta
 * olmalı; oraya giden düz hamle de gerçek ayak izlerini kesmemeli — kesin
 * kesişimle: köşe sıyırığı bile bir binaya doğrultulmuş rota sayılır.
 * Çiçeklik şeridine ve arsa kenarının dışına kaçış yok.
 */
function escapeHops(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout,
  goal: [number, number, number],
  ignorePump?: string
): Array<[number, number, number]> {
  const stand = [
    ...wallRects(state, block.side, 0.5),
    ...pumpRects(state, block.side, ignorePump, 0.5)
  ];
  const solid = [
    ...wallRects(state, block.side, 0),
    ...pumpRects(state, block.side, ignorePump, 0)
  ];

  const [hx, , hz] = vehicle.worldPosition;
  const zMin =
    block.side === 'far' ? block.minZ + LANE_HALF_WIDTH : block.minZ + FRONTAGE_DEPTH;
  const zMax =
    block.side === 'far' ? block.maxZ - FRONTAGE_DEPTH : block.maxZ - LANE_HALF_WIDTH;

  const out: Array<[number, number, number]> = [];
  for (const radius of [1.6, 2.4, 3.2]) {
    for (let step = 0; step < 8; step++) {
      const angle = (Math.PI / 4) * step;
      const x = hx + Math.sin(angle) * radius;
      const z = hz + Math.cos(angle) * radius;
      if (x < block.minX + LANE_HALF_WIDTH || x > block.maxX - LANE_HALF_WIDTH) continue;
      if (z < zMin || z > zMax) continue;
      if (inRects(stand, x, z)) continue;
      if (solid.some((r) => segmentCrossesRect([hx, hz], [x, z], r))) continue;
      out.push([x, 0, z]);
    }
  }

  out.sort(
    (a, b) =>
      Math.hypot(a[0] - goal[0], a[2] - goal[2]) - Math.hypot(b[0] - goal[0], b[2] - goal[2])
  );
  // Her adayın planı bir A* taraması: ilk birkaçı yetmediyse gerisi de
  // yetmeyecek demektir, tick bütçesini cömertçe yakmanın âlemi yok.
  return out.slice(0, 6);
}

/**
 * Karşı şerit, karşı arsa olmadan: yol trafiği oyuncunun ne kurduğuna
 * bakmaz (Emre, 2026-09-05). Karayolu ikinci şeride çıktığı an karşı
 * şeritte de araç akar — beton dökülmemişse kimse DURAMAZ ama herkes GEÇER.
 *
 * Near bloğunun iskeleti, karşı şeridin yol geometrisiyle: geçen aracın
 * kullandığı tek şey budur (şerit z'si, akış yönü, katı denetimi için taraf).
 * Karşıda gerçek bir blok kurulduğu an blockLayout onu döndürür ve bu
 * iskelet devre dışı kalır.
 */
function farRoadOnlyBlock(state: GameState): BlockLayout | null {
  if (state.station.roadLevel < 2) return null;
  const near = blockLayout(state, 'near');
  if (!near) return null;
  return {
    ...near,
    side: 'far',
    roadLaneZ: FAR_ROAD_Z,
    roadStartX: near.maxX + LAYOUT.roadMargin,
    roadEndX: near.minX - LAYOUT.roadMargin
  };
}

/** The block a vehicle is working with, falling back to the station's own. */
function blockFor(state: GameState, vehicle: VehicleEntity): BlockLayout {
  const side = vehicleSide(vehicle);
  return (
    blockLayout(state, side) ??
    (side === 'far' ? farRoadOnlyBlock(state) : null) ??
    blockLayout(state, 'near')!
  );
}

/**
 * How many cars fit in the queue lane without the tail running off the
 * concrete. Derived from the block so widening the station lengthens the
 * queue — and so the block across the road gets its own limit.
 */
/** Car-to-car spacing in a line behind a charging post, in grid units. */
const CHARGE_QUEUE_SPACING = 2.2;
const CHARGE_QUEUE_MAX = 4;

/**
 * Where electric customers wait: in a line behind a charging post, back
 * along the way in to its bay, not in the pump queue at the front (Emre,
 * 2026-09-07). The line is as long as the concrete behind the post allows —
 * never onto the front lane, the frontage, or into a building or island.
 * With several posts, the one with the longest line takes the queue.
 */
export function chargeQueueLine(
  state: GameState,
  block: BlockLayout,
  side: DrivewaySide
): { postId: string; dir: [number, number]; slots: Array<[number, number, number]> } | null {
  let best: { postId: string; dir: [number, number]; slots: Array<[number, number, number]> } | null = null;
  const keepOut = frontageKeepOut(block);
  for (const point of chargingPoints(state, side)) {
    const post = state.buildings[point.id];
    if (!post) continue;
    const [ox, oz] = pumpBayOffset({ rotation: post.rotation, type: post.type });
    const bay = clampBayToApron(block, [post.position[0] + ox, 0, post.position[1] + oz]);
    const dir = bayApproachDir({ rotation: post.rotation });
    const walls = [...wallRects(state, side, 0.3, post.id), ...pumpRects(state, side, undefined, 0.3)];
    const slots: Array<[number, number, number]> = [];
    for (let k = 1; k <= CHARGE_QUEUE_MAX; k++) {
      const at: [number, number, number] = [bay[0] - dir[0] * CHARGE_QUEUE_SPACING * k, 0, bay[2] - dir[1] * CHARGE_QUEUE_SPACING * k];
      const onApron =
        at[0] >= block.minX + LANE_HALF_WIDTH &&
        at[0] <= block.maxX - LANE_HALF_WIDTH &&
        at[2] >= block.minZ + LAYOUT.apronMargin &&
        at[2] <= block.maxZ - LAYOUT.apronMargin;
      if (!onApron) break;
      // Never standing on the front lane: that is the way in for everyone.
      if (Math.abs(at[2] - block.laneZ) < 1.5) break;
      if (inRects(keepOut, at[0], at[2]) || inRects(walls, at[0], at[2])) break;
      slots.push(at);
    }
    if (!best || slots.length > best.slots.length) best = { postId: point.id, dir, slots };
  }
  return best && best.slots.length > 0 ? best : null;
}

/** The way into a charge-queue slot: from one spacing further back, straight in. */
function chargeJoinRoute(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout,
  line: { dir: [number, number]; slots: Array<[number, number, number]> },
  index: number
): Array<[number, number, number]> | null {
  const slot = line.slots[index];
  if (!slot) return null;
  return driveable(state, vehicle, block, [slot]);
}

function maxQueueLength(state: GameState, block: BlockLayout): number {
  // Half a lane, not the apron's parking margin: a queue slot is measured
  // along the lay-by line, and the parking margin priced the tail slots off
  // a plot they physically fit on — with the head now held behind the bays,
  // that margin left the whole queue one car long.
  const m = LANE_HALF_WIDTH;
  const usable =
    block.queueStep < 0 ? block.queueHeadX - (block.minX + m) : block.maxX - m - block.queueHeadX;
  const fits = Math.max(1, Math.min(5, Math.floor(usable / LAYOUT.queueSpacing) + 1));

  // A stretch of the lay-by can be inside something the player built, and
  // those slots are not slots. Counting them would send cars to wait in a
  // wall; leaving them out means a blocked lay-by simply holds fewer.
  const rects = wallRects(state, block.side);
  if (rects.length === 0) return fits;

  let clear = 0;
  for (let slot = 0; slot < fits + 8; slot++) {
    const at = queueSlotAt(block, slot);
    if (!at || inRects(rects, at[0], at[2])) continue;
    if (++clear >= fits) break;
  }
  return Math.max(1, clear);
}

/** Slot `index` down the lay-by, or null once it runs off the concrete. */
function queueSlotAt(block: BlockLayout, index: number): [number, number, number] | null {
  const raw: [number, number, number] = [
    block.queueHeadX + index * block.queueStep,
    0,
    block.queueZ
  ];
  // Along the line the slot only needs half a lane of edge room — the apron
  // margin is for parking nose-in and was voiding tail slots that fit fine.
  if (raw[0] < block.minX + LANE_HALF_WIDTH || raw[0] > block.maxX - LANE_HALF_WIDTH) {
    return null;
  }
  return [raw[0], 0, clampToApron(block, raw)[2]];
}

/** Half the length of the car the queue's spacing was measured for. */
const QUEUE_CAR_HALF_LENGTH = 0.9;

/** What a body sticks out beyond a car's, at each end. */
function queueExtra(vehicle: Pick<VehicleEntity, 'archetype' | 'modelVariant'>): number {
  return Math.max(0, vehicleBodyHalfExtents(vehicle).length - QUEUE_CAR_HALF_LENGTH);
}

/**
 * How far behind its standard slot the vehicle at `index` of this queue
 * stands, in grid units.
 *
 * The slots are a car-length apart and the head is one car-length behind the
 * bay — measured for a car. A bus is more than twice as long, and put on a
 * car's slot it stood with its nose against the car being served and against
 * the island's corner, hunting for another way in (Emre, 2026-09-07). So a
 * long body steps back by what it is longer than a car, and everything
 * behind it steps back by that twice over: the tail is further back, and so
 * is the gap it leaves.
 */
export function queueSetback(
  queued: Array<Pick<VehicleEntity, 'archetype' | 'modelVariant'>>,
  index: number
): number {
  let setback = queueExtra(queued[index]);
  for (let ahead = 0; ahead < index; ahead++) setback += 2 * queueExtra(queued[ahead]);
  return setback;
}

export function queueSlotPosition(
  state: GameState,
  index: number,
  side: DrivewaySide = 'near',
  setback = 0
): [number, number, number] {
  const block = blockLayout(state, side) ?? blockLayout(state, 'near')!;
  // Only walls: a car queueing right beside a pump island is exactly where it
  // is meant to be waiting.
  const rects = wallRects(state, block.side);

  // Along the line, against the flow, by what a long body needs; held onto
  // the lay-by, which can leave a very long vehicle short of room — the join
  // route is what refuses it a place then.
  const setBack = (at: [number, number, number]): [number, number, number] => [
    clamp(
      at[0] + Math.sign(block.queueStep) * setback,
      block.minX + LANE_HALF_WIDTH,
      Math.max(block.minX + LANE_HALF_WIDTH, block.maxX - LANE_HALF_WIDTH)
    ),
    at[1],
    at[2]
  ];

  // The lay-by is a straight line, and on a built-up forecourt part of that
  // line can be inside a shop. The queue keeps its line and steps past the
  // occupied stretch rather than bending or standing in the wall — one more
  // car length back is still a queue; a car parked indoors is not.
  //
  // Counted rather than nudged: nudging each car past the blocked stretch on
  // its own would put the two behind it on the same spot.
  let clear = -1;
  let last: [number, number, number] | null = null;
  for (let slot = 0; slot < index + 9; slot++) {
    const at = queueSlotAt(block, slot);
    if (!at || inRects(rects, at[0], at[2])) continue;
    last = at;
    if (++clear === index) return setBack(at);
  }

  // Asked for a place further back than the lay-by has: the queue is capped to
  // the slots that exist, so this is the tail rather than a spot in a wall.
  return setBack(last ?? clampToApron(block, [block.queueHeadX, 0, block.queueZ]));
}

/**
 * The way INTO a queue slot: along the lane, drop onto the lay-by line one
 * car-length behind the slot, and pull forward into it.
 *
 * The route used to be a single waypoint — the slot itself — which the
 * planner drew as one long diagonal across the forecourt, a different
 * diagonal for every car. A queue assembled out of diagonals reads as cars
 * abandoned at angles, not as a line. Arriving along the line instead leaves
 * every car facing the same way, nose to tail, the moment it stops.
 */
function queueJoinRoute(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout,
  index: number,
  side: DrivewaySide,
  queued: VehicleEntity[]
): Array<[number, number, number]> | null {
  const setback = queueSetback([...queued.slice(0, index), vehicle], index);
  const slot = queueSlotPosition(state, index, side, setback);
  // A long body whose slot had to be held onto the lay-by has no room to
  // stand there: it would sit on the tail of whatever is in front. No place.
  const unheld = queueSlotPosition(state, index, side)[0] + Math.sign(block.queueStep) * setback;
  if (Math.abs(unheld - slot[0]) > 0.01) return null;

  // Prefer the full queue spacing so every car settles nose-to-tail. If a
  // small building occupies only that staging point, move it closer to the
  // slot while retaining enough straight road for this body's full length.
  // This keeps the queue line intact and avoids rejecting an ordinary car
  // merely because its one hard-coded turning point happened to be in a WC.
  const direction = Math.sign(block.queueStep);
  const fullSpacing = Math.abs(block.queueStep);
  const bodySpacing = vehicleBodyHalfExtents(vehicle).length * 2 + 0.2;
  const stagingDistances = [fullSpacing];
  if (bodySpacing < fullSpacing - 0.05) stagingDistances.push(bodySpacing);

  for (const distance of stagingDistances) {
    const behindX = clamp(
      slot[0] + direction * distance,
      block.minX + LANE_HALF_WIDTH,
      Math.max(block.minX + LANE_HALF_WIDTH, block.maxX - LANE_HALF_WIDTH)
    );
    const route = driveable(state, vehicle, block, [
      [behindX, 0, block.laneZ],
      [behindX, 0, slot[2]],
      slot
    ]);
    if (route) return route;
  }
  return null;
}

/**
 * Which of a wide mouth's two lanes a vehicle should take, so that a widened
 * ramp really is two entrances rather than one queue drawn twice as broad.
 *
 * The lane nobody else is on wins. Counting how many vehicles happened to be
 * in the state was the old rule, and it only alternates while the traffic is
 * building: at the usual one car at a time it handed every single driver the
 * same lane, and the second one was never used. With both lanes free the car
 * picks by its own name, which splits arrivals evenly however quiet the road
 * is, and keeps the choice the same each time the route is worked out.
 */
function pickLane(
  state: GameState,
  vehicleId: string,
  mouth: DrivewayMouth,
  states: VehicleState[]
): number {
  if (mouth.width <= DRIVEWAY_WIDTH) return 0;

  const claims = [0, 1].map((lane) => {
    const laneX = drivewayLaneX(mouth, lane);
    return Object.values(state.vehicles).filter(
      (other) =>
        other.id !== vehicleId &&
        states.includes(other.state) &&
        [other.targetWaypoint, ...other.route].some(
          (point) => point && Math.abs(point[0] - laneX) < 0.01
        )
    ).length;
  });

  if (claims[0] !== claims[1]) return claims[0] < claims[1] ? 0 : 1;

  let hash = 0;
  for (const char of vehicleId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2;
}

/**
 * The strip of apron just inside the kerb, minus the mouths that cross it.
 *
 * The price board stands here and its planting runs either side. It is on the
 * plot, so nothing stopped a way round from being drawn straight across it —
 * which is a car cutting the corner over the flower beds and rejoining the
 * road wherever it likes. There are two ways over the verge and these are they.
 */
function frontageKeepOut(block: BlockLayout): PathRect[] {
  const front = block.side === 'far' ? block.maxZ : block.minZ;
  const inward = block.side === 'far' ? -1 : 1;

  // Reaches out over the verge as well as in over the apron, so the plot's own
  // boundary line falls inside it. Cars were running along that line — it is
  // the one place a strip that stopped exactly there could not cover.
  const outer = front - inward * LAYOUT.vergeDepth;
  const inner = front + inward * FRONTAGE_DEPTH;

  const minZ = Math.min(outer, inner);
  const maxZ = Math.max(outer, inner);

  // A shade wider than the paved bridge itself: a car turning in swings over
  // the edge of the mouth, and a gap measured to the millimetre is one the
  // search cannot thread.
  const margin = 0.6;
  const openings = [block.entry, block.exit]
    .map(
      (mouth) =>
        [mouth.x - mouth.width / 2 - margin, mouth.x + mouth.width / 2 + margin] as const
    )
    .sort((a, b) => a[0] - b[0]);

  const out: PathRect[] = [];
  let x = block.minX - LAYOUT.roadMargin;

  for (const [from, to] of openings) {
    if (from > x) out.push({ minX: x, maxX: from, minZ, maxZ });
    x = Math.max(x, to);
  }
  out.push({ minX: x, maxX: block.maxX + LAYOUT.roadMargin, minZ, maxZ });

  return out.filter((r) => r.maxX - r.minX > 0.01);
}

/**
 * Araç yolu rezervi: U biçiminde, araca her zaman açık kalması gereken zemin —
 * ilham alınan oyundaki kırmızı taralı alanın buradaki karşılığı (Emre,
 * 2026-09-02/05). evaluatePlacement buraya yapı koydurmaz; inşaat modu aynı
 * dikdörtgenleri taralı çizer.
 *
 * İki 'mouth' koridoru (giriş/çıkış ağzından ön şeride) + aralarını bağlayan
 * bir 'lane' şeridi. Ayrım yerleşim kuralının sertliğini belirler: ağız
 * koridorlarına pompanın DURUŞ ALANI bile giremez (boğazda park eden araç
 * kapıyı tıkar); bağlantı şeridine yalnız yapının ayak izi giremez — yola
 * dönük pompanın bay'i şeride değebilir, bay'de duran araç önalan hayatının
 * olağan hali.
 *
 * Derinlik o anki blockLayout'tan okunur: ön şerit oyuncunun inşaatı yüzünden
 * içeri kaydıysa rezerv de onunla birlikte uzar. Yer çizgisi türü düz
 * zeminler (otopark boyası, geniş rampalar) rezerve girebilir — onlar duvar
 * değil, zemin.
 */
export interface ReserveRect extends PathRect {
  kind: 'mouth' | 'lane';
}

/**
 * Emre'nin ölçüleri (2026-09-03): bant 2 hücre — araç 2 birim genişliğinde,
 * bu ona yeter — ve beton çizgisiyle bant arasında 1 hücrelik pay kalır ki
 * oyuncu oraya sokak lambası, çöp kutusu gibi küçük şeyler koyabilsin.
 * Ağız koridorları bu payı TANIMAZ: kapının önü kapının önüdür.
 */
export const RESERVE_SETBACK = 1;
export const RESERVE_DEPTH = 2;

export function drivewayReserveRects(
  state: Parameters<typeof blockLayout>[0],
  side: DrivewaySide
): ReserveRect[] {
  const block = blockLayout(state, side);
  if (!block) return [];

  const front = side === 'far' ? block.maxZ : block.minZ;
  const inward = side === 'far' ? -1 : 1;

  // Rezerv, inşaat ızgarasının HÜCRELERİNE oturur: beton çizgisinden 1 hücre
  // pay (lamba/dekor bandı), ardından 2 hücrelik araç bandı. Ara değerli
  // kenarlar onu sahneden kopuk ayrı bir katman gibi gösteriyordu; ön şerit
  // inşaat yüzünden içeri kayarsa yolu yine bağlantı sınavı
  // (forecourtStaysOpen) korur — rezervin işi kapılar ve ön bandın kendisi.
  const apronFront = side === 'far' ? block.maxZ : Math.max(block.minZ, FORECOURT_FRONT);
  const laneFront = apronFront + inward * RESERVE_SETBACK;
  const reserveBack = laneFront + inward * RESERVE_DEPTH;

  const mouths = [block.entry, block.exit].map((mouth) => {
    const half = mouth.width / 2;
    return {
      kind: 'mouth' as const,
      minX: Math.floor(mouth.x - half),
      maxX: Math.ceil(mouth.x + half),
      minZ: Math.min(front, reserveBack),
      maxZ: Math.max(front, reserveBack)
    };
  });

  // İki koridorun arası: beton çizgisinden ön şeridin arka kenarına, ağızdan
  // ağıza kesintisiz. Cebe sıkışan araca son çare olarak her zaman açık bir
  // ön yol kalır.
  const lane = {
    kind: 'lane' as const,
    minX: Math.min(mouths[0].minX, mouths[1].minX),
    maxX: Math.max(mouths[0].maxX, mouths[1].maxX),
    minZ: Math.min(laneFront, reserveBack),
    maxZ: Math.max(laneFront, reserveBack)
  };

  return [...mouths, lane];
}

/**
 * Bu arsada giriş ağzından çıkış ağzına hâlâ sürülebilir bir yol var mı?
 *
 * evaluatePlacement aday yapıyı hayalet olarak ekleyip bunu sorar: cevabı
 * hayıra çeviren yerleşim önalanı mühürleyen yerleşimdir ve reddedilir.
 * Koridor rezervinin tamamlayıcısı — rezerv kapıları korur, bu sınav arsanın
 * ortasında kapalı cep kurulmasını engeller.
 */
export function forecourtStaysOpen(state: GameState, side: DrivewaySide): boolean {
  const block = blockLayout(state, side);
  if (!block) return true;

  const entryX = drivewayLaneX(block.entry, 0);
  const exitX = drivewayLaneX(block.exit, 0);
  const probe = { worldPosition: [entryX, 0, block.roadLaneZ] } as VehicleEntity;

  // Şerit üzerinde bina olabilir (şerit zaten kaçabildiği kadar kaçmıştır);
  // ara noktalar duvarın içine düşmüşse kenara kaydırılır ki sınav "şu tek
  // nokta dolu" diye değil, gerçekten yol kalmadığında hayır desin.
  return canReach(
    state,
    probe,
    side,
    [
      offWalls(state, block, [entryX, 0, block.laneZ]),
      offWalls(state, block, [exitX, 0, block.laneZ]),
      [exitX, 0, block.roadLaneZ]
    ],
    { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
    frontageKeepOut(block)
  );
}

/**
 * Sahadaki her müşteri aracı çıkışa hâlâ ulaşabiliyor mu?
 *
 * Girişten çıkışa yol kalması yetmez: bir yapı, o an arsanın derinliğindeki
 * bir aracın TEK dönüş yolunun üstüne inebilir — araç fiziksel olarak
 * mühürlenir ve 20 saniyelik valfle buharlaşır, ki oyuncunun gözünde bug'dır.
 * evaluatePlacement aday yapıyı hayalet olarak ekleyip bunu da sorar.
 */
export function vehiclesCanStillLeave(state: GameState, side: DrivewaySide): boolean {
  const block = blockLayout(state, side);
  if (!block) return true;

  const exitX = drivewayLaneX(block.exit, 0);
  for (const vehicle of Object.values(state.vehicles)) {
    // Yolda akanlar arsanın konusu değil; yalnız beton üstündekiler sayılır.
    if (
      vehicle.state === 'SPAWN' ||
      vehicle.state === 'PASSING' ||
      vehicle.state === 'DESPAWN'
    ) {
      continue;
    }
    const [x, , z] = vehicle.worldPosition;
    if (x < block.minX || x > block.maxX || z < block.minZ || z > block.maxZ) continue;
    if (vehicleSide(vehicle) !== side) continue;

    const out = canReach(
      state,
      vehicle,
      side,
      [
        [exitX, 0, block.laneZ],
        [exitX, 0, block.roadLaneZ]
      ],
      { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
      frontageKeepOut(block),
      vehicle.targetPumpId ?? undefined,
      vehicle.chargingBuildingId ?? undefined
    );
    if (!out) return false;
  }
  return true;
}

/**
 * The route as the lanes describe it, redrawn around anything the player has
 * built across it. A leg with nothing in it comes back untouched, so an empty
 * forecourt drives exactly as it did before there was anything to drive round.
 */
/**
 * A parked lorry, as an obstacle for the cars. One stood at its berth blocks
 * a lane the way a wall does, and a car that only brakes for it sits behind
 * it for the whole unload; a car that routes around it drives on. Lorries in
 * motion are left to the following rules — steering round a moving target
 * would have cars swerving at ghosts.
 */
function parkedTruckRects(state: GameState): PathRect[] {
  const rects: PathRect[] = [];
  for (const order of state.fuelOrders) {
    const truck = order.truck;
    if (!truck || truck.phase !== 'UNLOADING') continue;
    const [x, , z] = truck.worldPosition;
    // A tanker is long: three car-lengths of it, plus room to pass.
    rects.push({ minX: x - 3.2, maxX: x + 3.2, minZ: z - 1.9, maxZ: z + 1.9 });
  }
  return rects;
}

function driveable(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout,
  waypoints: Array<[number, number, number]>,
  ignorePumpId?: string,
  ignoreBuildingId?: string | string[],
  // Cars steer around an unloading tanker; a tanker's own routes must not —
  // the berth rectangle covers the lorry itself and its neighbours, and a
  // route asked for from inside a "wall" is refused before it starts. That
  // refusal is what left leaving lorries with no way out of their own berth.
  throughParkedTrucks = false
): Array<[number, number, number]> | null {
  return routeAroundOrNull(
    state,
    vehicle,
    block.side,
    waypoints,
    { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
    frontageKeepOut(block),
    ignorePumpId,
    ignoreBuildingId,
    throughParkedTrucks ? [] : parkedTruckRects(state)
  );
}

/** Highway -> entrance driveway -> circulation lane. */
function approachRoute(
  state: GameState,
  vehicle: VehicleEntity
): Array<[number, number, number]> | null {
  const block = blockFor(state, vehicle);
  const laneX = drivewayLaneX(
    block.entry,
    pickLane(state, vehicle.id, block.entry, ['SPAWN', 'ROAD_APPROACH'])
  );

  return driveable(state, vehicle, block, [
    [laneX, 0, block.roadLaneZ],
    [laneX, 0, block.laneZ]
  ]);
}

/**
 * Circulation lane -> the bay beside the pump. The lateral offset is part of
 * the route rather than a rendering trick, so the car drives to the spot it
 * will actually occupy instead of snapping sideways on arrival.
 */
/**
 * Ortak yanaşma, oyuncunun seçtiği ön yüze göre.
 *
 * Araç zaten bay hattında ve bay burnunun İLERİSİNDEyse tek düz hamle: sıra
 * başından pompaya "önce sol, sonra içeri, sonra sol" dansı gerçek sürücü
 * davranışı değil. Değilse şeritten hazırlık noktasına (bay'in bir araç boyu
 * gerisi, yanaşma doğrultusunda) planlı gelinir, son iki bacak DÜZDÜR —
 * planlayıcının şişkin pompa bandı o bacakları çapraz köşelere büküyor ve
 * çapraz gelen aracın burnu adaya girip katı kurala takılıyordu. Binalar
 * gerçekten kesiyorsa null: çağıran son çare planlı yola düşer.
 */
function approachBay(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout,
  bay: [number, number, number],
  dir: [number, number],
  ignorePumpId?: string,
  ignoreBuildingId?: string
): Array<[number, number, number]> | null {
  // Düz bacaklar yalnız binalara değil, KOMŞU adalara karşı da sınanır. Yan
  // yana iki dönük pompada arkadakinin hazırlık bacağı (bay'in bir araç boyu
  // gerisi, şeritten aşağı) öndekinin adasının tam içinden geçiyordu: katı
  // kural her adımı geri alıyor, araç öndeki pompanın müşterisinin dibinde
  // donuyordu — "iki araba üst üste"nin bir başka yolu (fuzz, 2026-09-09).
  // Kendi adası muaf: bay onun yanındadır.
  const walls = [
    ...wallRects(state, block.side, 0, ignoreBuildingId),
    ...pumpRects(state, block.side, ignorePumpId, 0.3)
  ];

  const dx = bay[0] - vehicle.worldPosition[0];
  const dz = bay[2] - vehicle.worldPosition[2];
  const ahead = dx * dir[0] + dz * dir[1];
  const sideways = Math.abs(dx * dir[1] - dz * dir[0]);
  if (
    sideways < 0.7 &&
    ahead > 0.5 &&
    legIsClear(walls, [vehicle.worldPosition[0], vehicle.worldPosition[2]], [bay[0], bay[2]]) &&
    // Tek düz hamle ancak gövde yol boyunca hiçbir katıya girmiyorsa: hatta
    // hafif açıyla yanaşan aracın ön köşesi adaya takılıyor ve araç sabrı
    // bitene dek orada kalıyordu (Emre, 2026-09-07). Girecekse planlı
    // yanaşma devreye girer — son iki bacağı düz olan. Tam hat üstünde
    // (kuyruk başının olağan hali) tarama gereksiz: gövdenin yanal uzanımı
    // bay'dekiyle aynıdır, bay sığıyorsa yol da sığar.
    (sideways < 0.05 ||
      bodyClearAlong(
        state,
        vehicle,
        block.side,
        [vehicle.worldPosition[0], vehicle.worldPosition[2]],
        [bay[0], bay[2]]
      ))
  ) {
    return [bay];
  }

  const runUp: [number, number, number] = [
    bay[0] - dir[0] * PUMP_APPROACH_RUN,
    0,
    bay[2] - dir[1] * PUMP_APPROACH_RUN
  ];
  const lastLegsClear =
    legIsClear(walls, [runUp[0], block.laneZ], [runUp[0], runUp[2]]) &&
    legIsClear(walls, [runUp[0], runUp[2]], [bay[0], bay[2]]);
  if (!lastLegsClear) return null;

  const toRunUp = driveable(
    state,
    vehicle,
    block,
    [
      [vehicle.worldPosition[0], 0, block.laneZ],
      [runUp[0], 0, block.laneZ]
    ],
    ignorePumpId,
    ignoreBuildingId
  );
  if (!toRunUp) return null;

  const tail: Array<[number, number, number]> = [];
  if (Math.abs(runUp[2] - block.laneZ) > 0.05) tail.push(runUp);
  tail.push(bay);
  return [...toRunUp, ...tail];
}

export function pumpRoute(
  state: GameState,
  vehicle: VehicleEntity,
  pump: PumpEntity
): Array<[number, number, number]> | null {
  const block = blockFor(state, vehicle);
  const bay = pumpBay(block, pump, vehicle);
  const approach = approachBay(state, vehicle, block, bay, bayApproachDir(pump), pump.id);

  const legs: Array<[number, number, number]> = pumpFacesAcrossZ(pump)
    ? [
        [vehicle.worldPosition[0], 0, block.laneZ],
        [bay[0] + Math.sign(block.queueStep) * PUMP_APPROACH_RUN, 0, block.laneZ],
        [bay[0] + Math.sign(block.queueStep) * PUMP_APPROACH_RUN, 0, bay[2]],
        bay
      ]
    : [[vehicle.worldPosition[0], 0, block.laneZ], [bay[0], 0, block.laneZ], bay];

  return drivableOrNull(state, vehicle, block, approach ?? driveable(state, vehicle, block, legs, pump.id));
}

/**
 * Bir bay rotası ancak GÖVDEYLE sürülebiliyorsa rotadır.
 *
 * Planlayıcı, ucu bir adanın payına düşen bacakta o adayı bütünüyle affeder —
 * bay'e yanaşmak için doğru, komşu ada için yalan: yan yana iki dönük pompada
 * arkadakinin hazırlık bacağı öndekinin adasının tam içinden çizildi, katı
 * kural her adımı geri aldı ve araç öndeki müşterinin dibinde yirmi saniye
 * dondu (fuzz, 2026-09-09). Sürülemeyen rota verilmez; findAvailablePump o
 * bay'i bu sürücü için yok sayar, araç başka pompaya ya da kuyruğa gider.
 */
function drivableOrNull(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout,
  route: Array<[number, number, number]> | null
): Array<[number, number, number]> | null {
  if (!route) return null;
  return routeBodyClear(state, vehicle, block.side, vehicle.worldPosition, route) ? route : null;
}

/**
 * Circulation lane -> the bay beside a charging point. The same shape as the
 * route to a pump, because from the driver's seat it is the same manoeuvre.
 */
function chargerRoute(
  state: GameState,
  vehicle: VehicleEntity,
  point: [number, number],
  postId?: string
): Array<[number, number, number]> | null {
  const block = blockFor(state, vehicle);
  // Şarj direğinin ön yüzü de oyuncunun çevirdiği yöndür — pompayla aynı kural.
  const rotation = (postId ? state.buildings[postId]?.rotation : 0) ?? 0;
  const [ox, oz] = pumpBayOffset({ rotation, type: postId ? state.buildings[postId]?.type : undefined });
  const bay = clampBayToApron(block, [point[0] + ox, 0, point[1] + oz]);

  const approach = approachBay(
    state,
    vehicle,
    block,
    bay,
    bayApproachDir({ rotation }),
    undefined,
    postId
  );

  return drivableOrNull(
    state,
    vehicle,
    block,
    approach ??
      driveable(
        state,
        vehicle,
        block,
        [[vehicle.worldPosition[0], 0, block.laneZ], [bay[0], 0, block.laneZ], bay],
        undefined,
        postId
      )
  );
}

/**
 * The same spot, moved off a building if that is where it landed.
 *
 * A lane is a line across the whole plot and a building can stand on part of
 * it, which leaves waypoints inside the walls. Sending a car to one of those
 * is asking it to park in the lobby, and no way round can be found to a place
 * that is itself inside the building — so the waypoint slides along until it
 * is somewhere a car can actually stand.
 */
function offWalls(
  state: GameState,
  block: BlockLayout,
  point: [number, number, number]
): [number, number, number] {
  // Pompa adaları da duvar sayılır: kaçan bir şerit adanın üstüne oturabilir
  // (kafe + ada + ofis dizilişinde arka şeride yer kalmıyor) ve adanın payına
  // düşen ara nokta, planlayıcının bay muafiyetini tetikleyip rotayı adanın
  // İÇİNDEN geçiriyordu.
  const rects = [...wallRects(state, block.side), ...pumpRects(state, block.side)];
  if (!inRects(rects, point[0], point[2])) return point;

  // Never toward the frontage: the strip inside the kerb carries the price
  // board and its planting, and a lane slid onto that is a car driving over
  // the flower beds. Deeper into the plot first, and only then forward as far
  // as the planting.
  const front = block.side === 'far' ? block.maxZ : block.minZ;
  const inward = block.side === 'far' ? -1 : 1;
  const nearestToRoad = front + inward * FRONTAGE_DEPTH;

  // Only ever along z. The x it was given is the lane it belongs to, and the
  // caller has already fitted that to the plot — re-clamping it here was what
  // slid an exit lane back onto the middle of its own ramp.
  for (let step = 0.4; step <= 16; step += 0.4) {
    for (const z of [point[2] + inward * step, point[2] - inward * step]) {
      if ((z - nearestToRoad) * inward < 0) continue;
      const at: [number, number, number] = [
        point[0],
        point[1],
        clampToApron(block, [point[0], 0, z])[2]
      ];
      if (!inRects(rects, at[0], at[2])) return at;
    }
  }
  return point;
}

/**
 * Sends a car on its way, or takes it off the plot when there is no way out.
 *
 * Every exit used to fall back to a straight line when no way round could be
 * found, which is a car driving out through the side of the hotel. A forecourt
 * built so tightly that a car cannot leave it is the player's doing; the car
 * simply goes, rather than going through the wall in front of everybody.
 */
function sendAway(state: GameState, vehicle: VehicleEntity): void {
  // A car standing in a park bay backs out to the spot it turned in from
  // before it goes anywhere: the kerb is in front of it, and a route drawn
  // from the bay itself would drive straight over it. It keeps its bay until
  // it is out — the park is solid to everyone else, and a car half-way out
  // is still in it — and then heads straight for the exit rather than up
  // to the return lane and round (Emre, 2026-09-07).
  const backOut = parkedBackOut(state, vehicle);
  if (!backOut) {
    vehicle.parkingBuildingId = null;
    vehicle.parkingSlot = null;
  }

  const route = backOut
    ? parkExitRoute(state, { ...vehicle, worldPosition: backOut })
    : exitRoute(state, vehicle);
  if (route === null) {
    setVehicleState(vehicle, 'DESPAWN');
    return;
  }

  setVehicleState(vehicle, 'EXIT');
  setRoute(vehicle, backOut ? [backOut, ...route] : route);
  vehicle.reversing = !!backOut;
  // A driver can arrive here because the way to a selected parking bay stayed
  // blocked long enough to give up. That old wait belongs to the abandoned
  // parking manoeuvre, not to the new exit route: carrying it into EXIT made
  // the next tick despawn the car before it moved a centimetre.
  vehicle.blockedSeconds = 0;
  vehicle.solidStuckSeconds = 0;
}

/**
 * From the spot behind a park bay, the shortest honest way out: across to
 * the exit mouth's lane and down it. Buildings and islands are steered
 * round by the planner; the car's own park is not excused, because it is
 * already outside it. Falls back to the ordinary exit when there is no way
 * across — a plot built so that the only way round is the back lane.
 */
function parkExitRoute(
  state: GameState,
  from: VehicleEntity
): Array<[number, number, number]> | null {
  const block = blockFor(state, from);
  const laneX = drivewayLaneX(block.exit, pickLane(state, from.id, block.exit, ['EXIT']));

  const direct = routeAroundOrNull(
    state,
    from,
    block.side,
    [
      offWalls(state, block, clampLaneToApron(block, [laneX, 0, block.laneZ])),
      [laneX, 0, block.roadLaneZ],
      [block.roadEndX, 0, block.roadLaneZ]
    ],
    { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
    frontageKeepOut(block),
    undefined,
    undefined,
    parkedTruckRects(state)
  );
  return direct ?? exitRoute(state, from);
}

/**
 * The point behind its bay a parked car reverses to, or null for a car that
 * is not actually standing in one — a car still on its way to the bay leaves
 * from wherever it is, nose first like anyone else.
 */
function parkedBackOut(state: GameState, vehicle: VehicleEntity): [number, number, number] | null {
  if (!inParkingBay(state, vehicle)) return null;
  const park = state.buildings[vehicle.parkingBuildingId!];
  const bay = parkingBay(park, vehicle.parkingSlot!, vehicleBodyHalfExtents(vehicle));
  return clampLaneToApron(blockFor(state, vehicle), bay.runUp);
}

/** Pump -> return lane -> exit driveway -> off down the highway. */
function exitRoute(
  state: GameState,
  from: VehicleEntity
): Array<[number, number, number]> | null {
  const block = blockFor(state, from);
  const laneX = drivewayLaneX(block.exit, pickLane(state, from.id, block.exit, ['EXIT']));

  // A driver who never reached a pump is still out at the front of the plot,
  // and has no business cutting across the middle of it to pick up the return
  // lane — that is the path that runs through whatever the player built there.
  // Judged by where the car is standing: on the approach lane, or in the
  // waiting bay. Anywhere else it is out among the pumps.
  //
  // Standing at a pump's bay overrules the z test outright — a bay can sit
  // right on the queue line, and measuring by z alone misfiles the car.
  // WHICH way it then leaves depends on which face of the island it stood at:
  // a bay on the road side pulls forward onto the front lane and flows out —
  // going backward from there is a car driving straight through its own pump
  // island, which is what the player watched happen. A side or rear bay has
  // the island between itself and the road, so it keeps the forward/back-lap
  // choice below.
  let bayKind: 'front' | 'other' | null = null;
  let bayDir: [number, number] | null = null;
  // The post the car is standing against: close enough to count as a wall
  // it is "inside", so the planner is told to look past it. The first leg
  // rolls the car clear of it anyway.
  let bayPostId: string | undefined;
  const inwardHere = block.side === 'far' ? -1 : 1;
  // A charging post has a bay exactly as a pump does, and a car standing at
  // it leaves the same way; it used to be invisible here, so the leaver
  // planned from inside the post's shadow, found no way, and dissolved on
  // the spot (Emre, 2026-09-07).
  // The island the car stands beside, when it is a pump's: excused from the
  // roll-out checks below the way a post is, while every OTHER island counts.
  let bayPumpId: string | undefined;
  const servicePoints: Array<{ id?: string; pumpId?: string; position: [number, number]; rotation?: number; bay: [number, number, number]; type?: string }> = [
    ...Object.values(state.pumps)
      .filter((pump) => pumpSide(pump) === block.side)
      .map((pump) => ({ pumpId: pump.id, position: pump.position, rotation: pump.rotation, bay: pumpBay(block, pump, from) })),
    ...Object.values(state.buildings)
      .filter((b) => isChargerType(b.type) && drivewaySideAt(b.position[1]) === block.side)
      .map((post) => {
        const [ox, oz] = pumpBayOffset({ rotation: post.rotation, type: post.type });
        return {
          id: post.id,
          position: post.position,
          rotation: post.rotation,
          type: post.type,
          bay: clampBayToApron(block, [post.position[0] + ox, 0, post.position[1] + oz])
        };
      })
  ];
  for (const point of servicePoints) {
    if (Math.hypot(from.worldPosition[0] - point.bay[0], from.worldPosition[2] - point.bay[2]) >= 1) continue;
    bayKind = (point.position[1] - point.bay[2]) * inwardHere > 0 ? 'front' : 'other';
    bayDir = bayApproachDir({ rotation: point.rotation });
    bayPostId = point.id;
    bayPumpId = point.pumpId;
    break;
  }
  // Bay'den ayrılış gerçek hayattaki gibi: önce burnun doğrultusunda İLERİ
  // çık, sonra dön. Olduğu yerde burnu başka yöne çevirmek, aracın kuyruğunu
  // pompa adasının içine sokar — katı yapı kuralı o dönüşü haklı olarak
  // durduruyor ve araç bay'de sonsuza dek asılı kalıyordu.
  // Çıkış adayları sırayla denenir ve GÖVDEYLE sürülebilen ilki verilir;
  // hiçbiri sürülemiyorsa yine de ilk bulunan verilir — kurtarma makinesi
  // (rerouteAroundSolid) yoldan çalışır. Otobüs, tank sahasının payının bir
  // parmak dışındaki bir dönüş noktasında kuyruğunu sahaya sokup dört saniye
  // çakılı kalıyordu; öteki şeritten çizilen aday temizdi ama hiç sorulmamıştı
  // (Emre, 2026-09-09).
  const candidates: Array<Array<[number, number, number]>> = [];

  if (bayKind === 'front' && bayDir) {
    const rollOut = clampLaneToApron(block, [
      from.worldPosition[0] + bayDir[0] * 2.4,
      0,
      from.worldPosition[2] + bayDir[1] * 2.4
    ]);
    const ontoLane = clampLaneToApron(block, [rollOut[0], 0, block.laneZ]);

    // Planlayıcısız, düz eksenli beş nokta: bay'in önü tanım gereği açıktır
    // ve planlayıcının kestirme çaprazları, dönen aracın köşesini komşu
    // pompaya sokup katı-yapı kuralına yakalatıyordu. Yalnızca araya
    // gerçekten bina girmişse (oyuncunun marifeti) olağan akışa düşülür.
    // Komşu adalar da sayılır, hem de dönüş payıyla: araç çıkış noktasında
    // şeride doğru DÖNER ve kuyruğu yarım araç boyu (0.9) savrulur. Yan yana
    // iki pompada tam boy çıkış öteki adanın dibine geliyor, dönüşte kuyruk
    // adaya giriyor, araç orada kalıyordu (Emre, 2026-09-09). Sığmazsa
    // aşağıdaki kademeli çıkış devralır.
    const walls = [
      ...wallRects(state, block.side, 0, bayPostId),
      ...pumpRects(state, block.side, bayPumpId, 0.9)
    ];
    const clear =
      legIsClear(walls, [from.worldPosition[0], from.worldPosition[2]], [rollOut[0], rollOut[2]]) &&
      legIsClear(walls, [rollOut[0], rollOut[2]], [ontoLane[0], ontoLane[2]]) &&
      legIsClear(walls, [ontoLane[0], ontoLane[2]], [laneX, block.laneZ]) &&
      // The last leg is the driveway itself. Buildings can be placed near a
      // mouth on old saves, so the fast bay-exit route must prove that leg is
      // open too instead of assuming the kerb opening is empty.
      legIsClear(walls, [laneX, block.laneZ], [laneX, block.roadLaneZ]);
    if (clear) {
      const straight: Array<[number, number, number]> = [
        rollOut,
        ontoLane,
        [laneX, 0, block.laneZ],
        [laneX, 0, block.roadLaneZ],
        [block.roadEndX, 0, block.roadLaneZ]
      ];
      if (routeBodyClear(state, from, block.side, from.worldPosition, straight)) return straight;
      candidates.push(straight);
    }
  }

  // Bay'den ayrılan HER araç önce burnu yönünde düz çıkar; gerisini planlayıcı
  // o noktadan devralır. (Gövde, yerinde dönüşte adaya değmesin diye.)
  //
  // A bay can sit a car's length from the next building — a tank farm, a
  // bank — and a full roll into that building's margin gives the planner a
  // start it refuses. So the roll is as long as fits: the longest of a few
  // that ends outside the planner's clearance and runs clear of everything
  // but the post itself; failing that, the shortest that merely runs clear,
  // since turning on the spot puts the tail through the island.
  //
  // Emre, 2026-09-09 ("iki araba üst üste kaldı"): bu, yalnız şarj direğinin
  // ayrıcalığıydı. Ön yüzünden çıkılan bir pompa bay'i, düz çıkış yolu bir
  // yapıyla kesildiği an bu bölüme "çıkış hamlesi yok" diye düşüyor,
  // planlayıcı da aracı olduğu yerde döndüren bir çapraz çiziyordu: kuyruk
  // adaya giriyor, katı kural her adımı geri alıyor ve müşteri bay'de
  // taşlaşıyordu. Pompa bu arada serbest bırakıldığından bir sonraki müşteri
  // aynı bay'e, duran aracın üstüne yanaşıyordu.
  let rollAhead: [number, number, number] | null = null;
  if (bayDir) {
    const rollTo = (reach: number): [number, number, number] =>
      clampLaneToApron(block, [
        from.worldPosition[0] + bayDir![0] * reach,
        0,
        from.worldPosition[2] + bayDir![1] * reach
      ]);
    const here: [number, number] = [from.worldPosition[0], from.worldPosition[2]];
    // Çıkış noktası, aracın ŞERİDE DÖNEBİLDİĞİ ilk noktadır — gövdeyle
    // ölçülür, payla değil: yan yana iki pompada adalar bitişik bir duvar
    // kurar, bay'ler o duvarın önündedir ve duvara paralel duran araç hiçbir
    // noktada yerinde dönemez, kuyruğu her açıda adaya girer (Emre,
    // 2026-09-09). Tek çıkış, duvarın bitimini geçecek kadar düz ilerlemek;
    // o yüzden adaylar bir araç boyundan altı birime kadar uzar ve en kısa
    // GÜVENLİ olanı seçilir. Hiçbiri güvenli değilse gövdenin geçtiği en uzunu
    // — kurtarma makinesi gerisini getirir.
    const toLane = (p: [number, number, number]) => Math.atan2(0, block.laneZ - p[2]);
    const legFits = (p: [number, number, number]) =>
      bodyClearAlong(state, from, block.side, here, [p[0], p[2]]);
    const pivotFits = (p: [number, number, number]) =>
      !bodyInSolid(state, from, block.side, p[0], p[2], toLane(p));
    const points = [1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8, 5.4, 6.0].map(rollTo);
    rollAhead =
      points.find((p) => legFits(p) && pivotFits(p)) ??
      points.slice().reverse().find(legFits) ??
      null;
  }
  const rollAheadClear = rollAhead !== null;
  const start: [number, number, number] = rollAheadClear
    ? rollAhead!
    : [from.worldPosition[0], 0, from.worldPosition[2]];
  // The roll-out is driven as measured, never re-planned: the planner keeps a
  // point's clearance from the islands and calls a leg that runs 0.43 from an
  // island — a car's actual half-width, along a wall — blocked, then draws a
  // detour whose first leg leaves the bay on the diagonal, which is the very
  // pivot the roll-out exists to avoid. So the rest is planned FROM the
  // roll-out point, and the roll is put back in front.
  const planner: VehicleEntity = rollAheadClear ? { ...from, worldPosition: rollAhead! } : from;
  const withRoll = (
    route: Array<[number, number, number]> | null
  ): Array<[number, number, number]> | null =>
    route && rollAheadClear ? [rollAhead!, ...route] : route;

  const atFrontOfPlot =
    bayKind === 'front' ||
    (bayKind === null &&
      (Math.abs(from.worldPosition[2] - block.laneZ) < 1 ||
        Math.abs(from.worldPosition[2] - block.queueZ) < 1));

  // A car at a bay whose exit mouth lies AHEAD of it pulls back onto the
  // front lane and drives on out, the way any real forecourt flows. The lap
  // around the back of the plot is kept only for when the mouth is behind —
  // turning against the incoming traffic would be worse than the detour.
  //
  // Attempted only when the straight run to the mouth is actually open: the
  // full search is expensive exactly on the cramped plots where the forward
  // way is usually walled off anyway.
  const flow = Math.sign(block.roadEndX - block.roadStartX) || 1;
  const forwardOpen = () => {
    // Never into oncoming traffic. The front lane is the way IN: pulling onto
    // it while cars are arriving puts the leaver nose to nose with them and
    // corks the whole forecourt — customers were then lost at the gate for
    // want of a lane. Empty, it is simply the short way out.
    const oncoming = Object.values(state.vehicles).some(
      (other) =>
        other.id !== from.id &&
        (other.state === 'ROAD_APPROACH' || other.state === 'QUEUE' || other.state === 'PUMP_RESERVED') &&
        Math.abs(other.worldPosition[2] - block.laneZ) < 2.5 &&
        (laneX - other.worldPosition[0]) * flow > -2
    );
    if (oncoming) return false;

    const walls = wallRects(state, block.side);
    const a: [number, number] = [start[0], block.laneZ];
    const b: [number, number] = [laneX, block.laneZ];
    return (
      legIsClear(walls, [start[0], start[2]], a) &&
      legIsClear(walls, a, b)
    );
  };
  if (!atFrontOfPlot && (laneX - start[0]) * flow > 1 && forwardOpen()) {
    const forward = withRoll(routeAroundOrNull(
      state,
      planner,
      block.side,
      [
        offWalls(state, block, clampToApron(block, [start[0], 0, block.laneZ])),
        offWalls(state, block, clampLaneToApron(block, [laneX, 0, block.laneZ])),
        [laneX, 0, block.roadLaneZ],
        [block.roadEndX, 0, block.roadLaneZ]
      ],
      { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
      frontageKeepOut(block),
      undefined,
      bayPostId,
      parkedTruckRects(state)
    ));
    if (forward) candidates.push(forward);
  }

  const throughLane = atFrontOfPlot ? block.laneZ : block.exitLaneZ;

  const via = (lane: number): Array<[number, number, number]> | null =>
    withRoll(routeAroundOrNull(
      state,
      planner,
      block.side,
      [
        offWalls(state, block, clampToApron(block, [start[0], 0, lane])),
        offWalls(state, block, clampLaneToApron(block, [laneX, 0, lane])),
        // Leaving the plot down the exit driveway and away along the highway.
        [laneX, 0, block.roadLaneZ],
        [block.roadEndX, 0, block.roadLaneZ]
      ],
      { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
      frontageKeepOut(block),
      undefined,
      bayPostId,
      parkedTruckRects(state)
    ));

  // Dönüş şeridi ölü doğmuş olabilir: yeterince dolu bir arsada clearLaneZ
  // en az kötü satırı seçer ve o satır bir yapının üstüne düşebilir. O zaman
  // son çare, ağızdan ağıza inşaata kapalı tutulan ön yoldur — araç yolu
  // rezervi tam da bu an için var.
  // A car off a charging post goes straight for the mouth by the front
  // lane. The lap round the back is a pump customer's habit, and with the
  // back lane walled off by what stands there the planner drew that lap out
  // to the far corner of the plot and only then to the exit (Emre,
  // 2026-09-07: "arsanın en sol üst köşesine kadar gidiyor").
  const attempts: Array<() => Array<[number, number, number]> | null> = bayPostId
    ? [() => via(block.laneZ), () => via(throughLane)]
    : [() => via(throughLane), ...(throughLane !== block.laneZ ? [() => via(block.laneZ)] : [])];
  return firstDrivable(state, from, block, candidates, attempts);
}

/**
 * Sürülebilen ilk aday; hiçbiri sürülemiyorsa bulunan ilk rota (null yerine
 * — bir rota, hiç rota olmamasından iyidir, kurtarma makinesi gerisini
 * getirir). Tembel adaylar yalnız gerektiğinde çizilir: her biri bir A*.
 */
function firstDrivable(
  state: GameState,
  from: VehicleEntity,
  block: BlockLayout,
  ready: Array<Array<[number, number, number]>>,
  lazy: Array<() => Array<[number, number, number]> | null>
): Array<[number, number, number]> | null {
  let fallback: Array<[number, number, number]> | null = null;
  const consider = (route: Array<[number, number, number]> | null) => {
    if (!route) return false;
    if (routeBodyClear(state, from, block.side, from.worldPosition, route)) return true;
    fallback ??= route;
    return false;
  };
  for (const route of ready) if (consider(route)) return route;
  for (const plan of lazy) {
    const route = plan();
    if (consider(route)) return route;
  }
  return fallback;
}

function setRoute(vehicle: VehicleEntity, waypoints: Array<[number, number, number]>): void {
  vehicle.route = waypoints.slice(1);
  vehicle.targetWaypoint = waypoints[0] ?? null;
  vehicle.routeProgress = 0;
}

/**
 * Advances a vehicle along its route, hopping to the next waypoint on arrival.
 * Returns true only when the final waypoint has been reached.
 */
function driveToward(vehicle: VehicleEntity, deltaSeconds: number): boolean {
  let budget = BASE_DRIVE_SPEED * Math.max(0.2, vehicle.speed) * deltaSeconds;

  while (budget > 0) {
    const target = vehicle.targetWaypoint;
    if (!target) return true;

    const [x, y, z] = vehicle.worldPosition;
    const dx = target[0] - x;
    const dz = target[2] - z;
    const distance = Math.hypot(dx, dz);

    if (distance > 0.001 && !vehicle.reversing) {
      // Face the way we are going; the mesh reads this straight off. A car
      // backing out of a bay keeps its nose where it was.
      vehicle.heading = Math.atan2(dx, dz);
    }

    if (distance > budget) {
      vehicle.worldPosition = [x + (dx / distance) * budget, y, z + (dz / distance) * budget];
      vehicle.routeProgress = clamp(1 - distance / 40, 0, 1);
      return false;
    }

    // Reached this waypoint; spend what is left on the next leg. Reversing
    // only ever lasts one leg: out of the bay, then forward like anyone.
    vehicle.worldPosition = [target[0], y, target[2]];
    if (vehicle.reversing) {
      // Out of the bay: it is somebody else's now, and the park is a wall
      // to this car like any other.
      vehicle.reversing = false;
      vehicle.parkingBuildingId = null;
      vehicle.parkingSlot = null;
    }
    budget -= distance;

    const next = vehicle.route.shift();
    if (!next) {
      vehicle.targetWaypoint = null;
      vehicle.routeProgress = 1;
      return true;
    }
    vehicle.targetWaypoint = next;
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* Missions                                                            */
/* ------------------------------------------------------------------ */

function advanceMission(mission: MissionEntity, amount: number, effects: SimEffects): void {
  if (mission.completed) return;

  mission.progress = Math.min(mission.target, mission.progress + amount);
  if (mission.progress < mission.target) return;

  mission.completed = true;
  playCue(effects, 'levelUp');
  notify(
    effects,
    'REWARD',
    'Görev Tamamlandı!',
    `${mission.description} — Ödülü almak için görev panelini açın.`
  );
}

/**
 * Advances every open mission watching this metric. Tutorial and daily
 * missions share the counter, so one sale can move several goals at once.
 */
export function trackMissionMetric(
  state: GameState,
  metric: MissionMetric,
  amount: number,
  effects: SimEffects
): void {
  if (amount <= 0) return;
  for (const mission of state.missions) {
    if (mission.metric === metric) advanceMission(mission, amount, effects);
  }
}

/* ------------------------------------------------------------------ */
/* Random events                                                       */
/* ------------------------------------------------------------------ */

export interface EventModifiers {
  traffic: number;
  tip: number;
  pumpsDisabled: boolean;
  /** Per-archetype draw weight scale; absent means 1. */
  archetypeWeights: Partial<Record<VehicleArchetype, number>>;
}

/** Collapses every running event into the multipliers the tick needs. */
export function getEventModifiers(state: GameState): EventModifiers {
  const mods: EventModifiers = { traffic: 1, tip: 1, pumpsDisabled: false, archetypeWeights: {} };

  for (const event of state.activeEvents) {
    if (event.effects.trafficMultiplier) mods.traffic *= event.effects.trafficMultiplier;
    if (event.effects.tipMultiplier) mods.tip *= event.effects.tipMultiplier;
    if (event.effects.pumpsDisabled) mods.pumpsDisabled = true;
    for (const [archetype, mult] of Object.entries(event.effects.archetypeWeightMultiplier ?? {})) {
      const key = archetype as VehicleArchetype;
      mods.archetypeWeights[key] = (mods.archetypeWeights[key] ?? 1) * (mult ?? 1);
    }
  }

  return mods;
}

/** Total olayEtkisi term for the daily wholesale price formula. */
export function getWholesaleEventModifier(state: GameState): number {
  return state.activeEvents.reduce(
    (sum, e) => sum + (e.effects.wholesalePriceModifier || 0),
    0
  );
}

export function triggerEvent(
  state: GameState,
  config: GameEventConfig,
  effects: SimEffects
): ActiveGameEvent {
  let description = config.description;
  let eventEffects = { ...config.effects };

  // The inspection's outcome is decided by how well the forecourt is kept.
  if (config.id === 'health_inspection') {
    if (state.station.cleanliness >= 75) {
      eventEffects = { reputationDelta: 0.15 };
      description = 'Belediye denetimi temiz sonuçlandı. İtibarınız arttı.';
    } else if (state.station.cleanliness >= 45) {
      eventEffects = {};
      description = 'Belediye denetimi uyarıyla kapandı. Sahayı temiz tutun.';
    } else {
      eventEffects = { reputationDelta: -0.2, cashDelta: -2500 };
      description = 'Belediye denetiminden ceza aldınız! Saha çok kirliydi.';
    }
  }

  const event: ActiveGameEvent = {
    id: 'evt_' + Math.random().toString(36).substring(2, 9),
    templateId: config.id,
    name: config.name,
    description,
    category: config.category,
    icon: config.icon,
    effects: eventEffects,
    remainingHours: config.durationHours,
    totalHours: config.durationHours
  };

  // One-shot effects land immediately; multipliers keep working while active.
  if (eventEffects.reputationDelta) {
    state.player.reputation = clamp(
      state.player.reputation + eventEffects.reputationDelta,
      1,
      5
    );
  }
  if (eventEffects.cleanlinessDelta) {
    state.station.cleanliness = clamp(
      state.station.cleanliness + eventEffects.cleanlinessDelta,
      0,
      100
    );
  }
  if (eventEffects.cashDelta) {
    TransactionService.executeCashTransaction(state, {
      type: eventEffects.cashDelta > 0 ? 'MISSION_REWARD' : 'UPKEEP',
      amount: eventEffects.cashDelta,
      description: config.name,
      allowOverdraft: true
    });
  }
  if (eventEffects.pumpHealthDelta) {
    const pumps = Object.values(state.pumps).filter((p) => p.state !== 'BROKEN');
    if (pumps.length > 0) {
      const victim = pumps[Math.floor(Math.random() * pumps.length)];
      victim.health = clamp(victim.health + eventEffects.pumpHealthDelta, 0, 100);
    }
  }

  if (config.durationHours > 0) state.activeEvents.push(event);
  state.todayEventIds.push(config.id);

  const tone = config.category === 'INCIDENT' ? 'CRITICAL' : config.category === 'OPPORTUNITY' ? 'REWARD' : 'INFO';
  notify(effects, tone, config.name, description, EVENT_TOAST_HOLD_MS);
  playCue(effects, config.category === 'INCIDENT' ? 'alert' : 'levelUp');

  return event;
}

function pickWeightedEvent(candidates: GameEventConfig[]): GameEventConfig | null {
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight <= 0) return null;

  let roll = Math.random() * totalWeight;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

/** Rolls the once-a-day economic event. Called when a new day begins. */
export function rollDailyEvent(state: GameState, effects: SimEffects): void {
  const candidates = GAME_EVENTS.filter(
    (e) => e.daily && e.minLevel <= state.player.level
  );
  if (candidates.length === 0) return;

  // Most days are ordinary; only some open with a market shock.
  if (Math.random() > 0.45) return;

  const chosen = pickWeightedEvent(candidates);
  if (chosen) triggerEvent(state, chosen, effects);
}

function tickEvents(state: GameState, dtHours: number, dt: number, effects: SimEffects): void {
  for (let i = state.activeEvents.length - 1; i >= 0; i--) {
    const event = state.activeEvents[i];
    event.remainingHours -= dtHours;
    if (event.remainingHours <= 0) {
      state.activeEvents.splice(i, 1);
      notify(effects, 'INFO', 'Olay Sona Erdi', `${event.name} etkisi ortadan kalktı.`);
    }
  }

  // The road's events, paced (Emre, 2026-09-09): the old roll fired about
  // one every two and a half days, so most of the catalogue was never seen.
  // Now about one or two a day, never within an hour and a half of the
  // last, never more than three, never the same one twice in a day, and
  // never before the station has opened its first hour.
  const day = state.dayState;
  const hour = hourOfDay(day.gameTime);
  if ((day.eventsToday ?? 0) >= MAX_EVENTS_PER_DAY) return;
  if (day.gameTime < GAME_CONFIG.economy.dayStartHour + 1) return;
  if (day.lastEventAtHour !== undefined && day.gameTime - day.lastEventAtHour < MIN_HOURS_BETWEEN_EVENTS) return;
  if (isNightHour(hour) && Math.random() < 0.5) return;

  const candidates = GAME_EVENTS.filter(
    (e) =>
      !e.daily &&
      e.minLevel <= state.player.level &&
      !state.todayEventIds.includes(e.id) &&
      !state.activeEvents.some((a) => a.templateId === e.id)
  );
  if (candidates.length === 0) return;

  if (Math.random() < EVENT_CHANCE_PER_SECOND * dt) {
    const chosen = pickWeightedEvent(candidates);
    if (chosen) {
      triggerEvent(state, chosen, effects);
      day.lastEventAtHour = day.gameTime;
      day.eventsToday = (day.eventsToday ?? 0) + 1;
    }
  }
}

/** About 1.4 rolls a day at 240 seconds a day; the gap and the cap trim the tail. */
const EVENT_CHANCE_PER_SECOND = 0.006;
const MIN_HOURS_BETWEEN_EVENTS = 1.5;
const MAX_EVENTS_PER_DAY = 3;

/**
 * What an event does, in a few words for its card: the numbers the player
 * plans around rather than the story on the toast.
 */
export function eventEffectSummary(effects: GameEventEffects): string {
  const parts: string[] = [];
  if (effects.trafficMultiplier !== undefined) {
    const pct = Math.round((effects.trafficMultiplier - 1) * 100);
    parts.push(`trafik ${pct >= 0 ? '+' : ''}${pct}%`);
  }
  if (effects.wholesalePriceModifier !== undefined) {
    const pct = Math.round(effects.wholesalePriceModifier * 100);
    parts.push(`alış ${pct >= 0 ? '+' : ''}${pct}%`);
  }
  if (effects.tipMultiplier !== undefined) parts.push(`bahşiş ×${effects.tipMultiplier}`);
  for (const [archetype, mult] of Object.entries(effects.archetypeWeightMultiplier ?? {})) {
    const name = GAME_CONFIG.customerTypes[archetype]?.name ?? archetype;
    parts.push(`${name.toLocaleLowerCase('tr-TR')} ×${mult}`);
  }
  if (effects.pumpsDisabled) parts.push('pompalar ve şarj kapalı');
  if (effects.reputationDelta) parts.push(`itibar ${effects.reputationDelta > 0 ? '+' : ''}${effects.reputationDelta.toFixed(2)}`);
  if (effects.cashDelta) parts.push(`${effects.cashDelta > 0 ? '+' : '−'}₺${Math.abs(effects.cashDelta).toLocaleString('tr-TR')}`);
  if (effects.cleanlinessDelta) parts.push(`temizlik ${effects.cleanlinessDelta}`);
  if (effects.pumpHealthDelta) parts.push(`bir pompa ${effects.pumpHealthDelta} sağlık`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Daily missions                                                      */
/* ------------------------------------------------------------------ */

/** Replaces yesterday's daily goals with a fresh set for the new day. */
export function generateDailyMissions(state: GameState): void {
  // Keep tutorials and anything still waiting to be claimed.
  state.missions = state.missions.filter(
    (m) => m.type === 'TUTORIAL' || (m.completed && !m.claimed)
  );

  const eligible = DAILY_MISSION_TEMPLATES.filter((t) => t.minLevel <= state.player.level);
  if (eligible.length === 0) return;

  const pool = [...eligible];
  const count = Math.min(3, pool.length);

  for (let i = 0; i < count; i++) {
    const template = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];

    const span = template.maxTarget - template.minTarget;
    const raw = template.minTarget + Math.random() * span;
    const target = Math.max(
      template.minTarget,
      Math.round(raw / template.step) * template.step
    );

    // The first pick of the day is the headline goal and pays extra.
    const isMain = i === 0;
    const rewardCash = Math.round(target * template.rewardCashPerUnit * (isMain ? 1.6 : 1));

    state.missions.push({
      id: 'mission_' + template.id + '_' + state.dayState.currentDay,
      templateId: template.id,
      type: isMain ? 'DAILY_MAIN' : 'DAILY_NORMAL',
      description: template.description.replace(
        '{n}',
        target.toLocaleString('tr-TR')
      ),
      metric: template.metric,
      target,
      progress: 0,
      rewardCash,
      rewardXp: Math.round(template.rewardXp * (isMain ? 1.5 : 1)),
      completed: false,
      claimed: false,
      issuedOnDay: state.dayState.currentDay
    });
  }
}

/* ------------------------------------------------------------------ */
/* Fueling                                                             */
/* ------------------------------------------------------------------ */

/** Cash requests come in steps of this many lira: ₺1.500, never ₺1.527,60. */
export const REQUEST_LIRA_STEP = 50;

/** Roughly this share of drivers want the tank filled; the rest name a sum. */
export const FULL_TANK_SHARE = 0.35;

/**
 * What a driver asks for at the window: either "fill it up" or a round sum of
 * money. Never a figure with kuruş on the end — nobody pulls in and asks for
 * ₺1.527,60 of petrol. The sum is rounded down so the fuel it buys fits in the
 * space the tank has, and never below one step, so a driver with a nearly full
 * tank still asks for something worth stopping for.
 */
export function driverRequest(
  demandLiters: number,
  unitPrice: number,
  wantsFull: boolean
): VehicleEntity['request'] {
  if (wantsFull || unitPrice <= 0) {
    return {
      mode: 'FULL',
      targetValue: demandLiters,
      calculatedLiters: demandLiters,
      calculatedPrice: Number((demandLiters * unitPrice).toFixed(2)),
      dispensedLiters: 0,
      isFinished: false
    };
  }
  const lira = Math.max(
    REQUEST_LIRA_STEP,
    Math.floor((demandLiters * unitPrice) / REQUEST_LIRA_STEP) * REQUEST_LIRA_STEP
  );
  return {
    mode: 'MONEY',
    targetValue: lira,
    calculatedLiters: lira / unitPrice,
    calculatedPrice: lira,
    dispensedLiters: 0,
    isFinished: false
  };
}

export function beginFueling(
  state: GameState,
  vehicle: VehicleEntity,
  mode: 'LITERS' | 'MONEY' | 'FULL',
  targetValue: number,
  actor: 'PLAYER' | 'EMPLOYEE',
  effects: SimEffects
): boolean {
  const unitPrice = state.pricing[vehicle.fuelType].playerPrice;

  let litersNeeded: number;
  if (mode === 'FULL') {
    litersNeeded = Math.max(0, vehicle.tankCapacity - vehicle.currentFuel);
  } else if (mode === 'MONEY') {
    litersNeeded = unitPrice > 0 ? targetValue / unitPrice : 0;
  } else {
    litersNeeded = targetValue;
  }

  const reservation = TransactionService.reserveFuel(state, vehicle.fuelType, litersNeeded);
  if (!reservation.success) {
    notify(
      effects,
      'WARNING',
      'Stok Yetersiz',
      reservation.error || 'Yeterli yakıt stoku bulunmuyor!'
    );
    return false;
  }

  // The reservation reports itself to two decimals, and ₺250 of petrol at
  // ₺44,90 is 5.5679 L — rounded, the pump would charge ₺250,09. A named sum
  // is owed exactly, so when the tank covered it the litres are the sum's own.
  const liters =
    reservation.reservedLiters >= litersNeeded - 0.01 ? litersNeeded : reservation.reservedLiters;
  vehicle.request = {
    mode,
    targetValue,
    calculatedLiters: liters,
    calculatedPrice: mode === 'MONEY' && liters === litersNeeded ? targetValue : Number((liters * unitPrice).toFixed(2)),
    dispensedLiters: 0,
    isFinished: false,
    reservedLiters: liters
  };
  vehicle.assignedActor = actor;

  // AT_PUMP -> REQUEST -> FUELING keeps the documented lifecycle intact.
  setVehicleState(vehicle, 'REQUEST');
  setVehicleState(vehicle, 'FUELING');

  const pump = vehicle.targetPumpId ? state.pumps[vehicle.targetPumpId] : null;
  if (pump) {
    setPumpState(pump, 'REQUEST_READY');
    setPumpState(pump, 'FUELING');
  }

  playCue(effects, 'pumpStart');
  return true;
}

/** What a roof over the island is worth: faster fills, and less weathering. */
const CANOPY_FLOW_BONUS = 0.05;
const CANOPY_GRIME_RELIEF = 0.7;

/**
 * True when this island has a roof over it.
 *
 * A canopy used to be a separate building and this used to be a footprint
 * test — one that quietly ignored the canopy's own rotation, so a turned roof
 * covered the wrong pumps. A roof that belongs to the island it stands on
 * cannot drift away from it, and the question becomes a field read.
 */
export function isUnderCanopy(pump: { hasCanopy?: boolean }): boolean {
  return pump.hasCanopy === true;
}

/** Pushes fuel for one step. Returns true when the requested amount is met. */
export function dispenseStep(
  state: GameState,
  vehicle: VehicleEntity,
  deltaSeconds: number,
  effects: SimEffects
): boolean {
  if (vehicle.state !== 'FUELING' || vehicle.request.isFinished) return false;

  const pump = vehicle.targetPumpId ? state.pumps[vehicle.targetPumpId] : null;
  let flowRate = pump ? pump.flowRateLps : 8;

  // A worn pump dispenses noticeably slower.
  if (pump && pump.health < 60) flowRate *= 0.75;
  if (pump && pump.health < 30) flowRate *= 0.6;

  // Working under a roof is quicker, and that is what the canopy is sold on.
  if (pump && isUnderCanopy(pump)) flowRate *= 1 + CANOPY_FLOW_BONUS;

  const remaining = vehicle.request.calculatedLiters - vehicle.request.dispensedLiters;
  vehicle.request.dispensedLiters += Math.min(remaining, flowRate * deltaSeconds);
  playCue(effects, 'fuelTick');


  if (vehicle.request.dispensedLiters >= vehicle.request.calculatedLiters - 0.05) {
    vehicle.request.dispensedLiters = vehicle.request.calculatedLiters;
    vehicle.request.isFinished = true;
    setVehicleState(vehicle, 'PAYMENT');
    if (pump) setPumpState(pump, 'PAYMENT');
    return true;
  }

  return false;
}

/** Settles payment, tip, XP and mission progress for one sale. */
/**
 * Settles a charging session and sends the driver on their way.
 *
 * Electricity is billed off the grid rather than out of a tank, so there is no
 * stock to draw down and no wholesale cost to book against it — the tariff is
 * the margin, which is why the substation and the points are the investment.
 */
/**
 * What a kWh sells for at a post of this kind: the player's price from the
 * office, or the catalogue tariff for a save that never set one.
 */
export function evPricePerKwh(state: GameState, kind: 'ac' | 'dc'): number {
  const fallback = kind === 'dc' ? GAME_CONFIG.ev.dcPricePerKwh : GAME_CONFIG.ev.acPricePerKwh;
  return state.evPricing?.[kind] ?? fallback;
}

/**
 * How the charging tariff sits against the going rate — the catalogue price
 * stands in for a regional average, there being no electricity market — so
 * an electric driver weighs the board the way a petrol driver does. Without
 * this, a kWh could be priced at anything and nobody would drive past.
 */
function evPriceIndex(state: GameState, side: DrivewaySide): number {
  const kinds = new Set(chargingPoints(state, side).map((p) => p.kind));
  if (kinds.size === 0) return 1;
  let sum = 0;
  for (const kind of kinds) {
    const listed = kind === 'dc' ? GAME_CONFIG.ev.dcPricePerKwh : GAME_CONFIG.ev.acPricePerKwh;
    sum += evPricePerKwh(state, kind) / listed;
  }
  return sum / kinds.size;
}

export function finalizeCharge(state: GameState, vehicle: VehicleEntity, effects: SimEffects): void {
  const point = vehicle.chargingBuildingId
    ? state.buildings[vehicle.chargingBuildingId]
    : null;
  const fast = point?.type === 'ev_charger_dc';
  const tariff = evPricePerKwh(state, fast ? 'dc' : 'ac');

  // The "tank" of an electric car is its battery, in kWh; what went in is
  // what is paid for.
  const kwh = vehicle.request.dispensedLiters > 0
    ? vehicle.request.dispensedLiters
    : vehicle.request.calculatedLiters;
  const total = Math.round(kwh * tariff);

  const facilities = blockFacilities(state, vehicleSide(vehicle));
  const speedRatio = clamp((vehicle.patience / vehicle.maxPatience) * 100, 0, 100);
  const serviceScore = clamp(
    calculateServiceScore(speedRatio, 100, state.station.cleanliness) + facilities.satisfaction,
    0,
    100
  );
  vehicle.satisfaction = serviceScore;

  // A charging customer tips for good service the same as a fuelling one —
  // their archetype already says how readily.
  const tipHabit = GAME_CONFIG.customerTypes[vehicle.archetype]?.tipChanceModifier ?? 1;
  const tip = Math.round(
    calculateCustomerTip(total, serviceScore, vehicle.archetype) *
      getEventModifiers(state).tip *
      tipHabit
  );

  TransactionService.executeCashTransaction(state, {
    type: 'FUEL_SALE',
    amount: total + tip,
    description: `${fast ? 'DC hızlı' : 'AC'} şarj - ${kwh.toFixed(0)} kWh${tip > 0 ? ` (+${tip} TL bahşiş)` : ''}`
  });

  state.player.statistics.totalRevenue += total;
  state.player.statistics.totalTips += tip;
  state.player.statistics.totalCustomersServed++;
  state.dayState.todayStats.fuelRevenue += total;
  state.dayState.todayStats.tips += tip;
  state.dayState.todayStats.customersServed++;
  state.dayState.todayStats.serviceScoreSum =
    (state.dayState.todayStats.serviceScoreSum || 0) + serviceScore;

  // The forecourt gets its chance at this customer too — see rollSideServices.
  rollSideServices(state, vehicle, effects);

  trackMissionMetric(state, 'CUSTOMERS_SERVED', 1, effects);
  playCue(effects, 'cash');

  vehicle.chargingBuildingId = null;
  vehicle.chargeSecondsLeft = 0;
  // Charging and facility visits are separate trip intents. Once the battery
  // is full this driver's job is done; sending it to a park next would cross
  // the departure stream and turn a single visit into two unrelated ones.
  sendAway(state, vehicle);
}

/**
 * Everything else on the forecourt gets its chance at a customer on the way
 * out: the wash, the café, the tyre bay. This is what those buildings are
 * for — and it applies to a driver who charged just as much as to one who
 * fuelled; if anything the EV driver had longer to kill in the shop.
 *
 * Money, not traffic: nothing here routes a car anywhere. The gridlock that
 * split fuelling from visiting came from sending a paid-up customer across
 * the apron to a park, and that is gone — the till roll never caused it, and
 * without it a shop could not pay for itself at all.
 */
function rollSideServices(state: GameState, vehicle: VehicleEntity, effects: SimEffects): void {
  const facilities = blockFacilities(state, vehicleSide(vehicle));

  for (const service of facilities.services) {
    if (Math.random() >= service.chance) continue;

    const spend = Math.round(service.avgSpend * (0.7 + Math.random() * 0.6));
    TransactionService.executeCashTransaction(state, {
      type: 'MARKET_SALE',
      amount: spend,
      description: `${service.name} hizmeti (${vehicle.archetype})`
    });
    state.dayState.todayStats.marketRevenue += spend;
    state.dayState.todayStats.marketCost += Math.round(spend * 0.45);
    playCue(effects, 'cash');
  }
}

/**
 * A driver at the pump who fancies the shop: they get out and walk, and the
 * car — with the pump's claim on it — stays exactly where it is. Returns true
 * when the visit has begun, so the caller leaves the departure alone.
 *
 * This is the one way a fuel customer reaches a building, and it needs no car
 * park at all: a station can run a shop on pump trade alone. A park is what
 * frees the bay and brings in the drivers who came for the building and
 * nothing else — an upgrade, not a toll.
 */
function walkFromPump(
  state: GameState,
  vehicle: VehicleEntity,
  pump: PumpEntity | null,
  effects: SimEffects
): boolean {
  void effects;
  if (!pump || Math.random() >= PUMP_WALK_SHARE) return false;

  // The share above is the whole gate, so the pick is only about WHICH
  // building — its own dice would make the real rate a fraction of the one
  // the figure names.
  const building = pickFacility(state, vehicleSide(vehicle), vehicle.archetype, true);
  if (!building) return false;

  const conf = facilityConfig(building.type);
  // Some buildings are not a thing you walk into leaving a car at a pump: you
  // do not check into a hotel that way. The catalogue says which.
  if (!conf?.walkFromPump) return false;

  vehicle.visitBuildingId = building.id;
  vehicle.waitingTimeSeconds = 0;
  vehicle.shoppingIntent = true;
  vehicle.visitMode = 'PUMP';
  setVehicleState(vehicle, 'VISITING');
  spawnVisitor(state, vehicle, building);
  return true;
}

export function finalizeSale(

  state: GameState,
  vehicle: VehicleEntity,
  effects: SimEffects
): void {
  const dispensed = vehicle.request.dispensedLiters;
  const unitPrice = state.pricing[vehicle.fuelType].playerPrice;
  const totalSale = Number((dispensed * unitPrice).toFixed(2));

  TransactionService.dispenseFuel(state, vehicle.fuelType, dispensed);
  vehicle.currentFuel = Math.min(vehicle.tankCapacity, vehicle.currentFuel + dispensed);

  // An interrupted fill settled for less than it reserved; the difference
  // goes back on the shelf now, not at the end of the day.
  const heldOver = Math.max(0, (vehicle.request.reservedLiters ?? 0) - dispensed);
  if (heldOver > 0) TransactionService.releaseFuelReservation(state, vehicle.fuelType, heldOver);
  vehicle.request.reservedLiters = 0;

  const speedRatio = clamp((vehicle.patience / vehicle.maxPatience) * 100, 0, 100);
  const accuracy = vehicle.request.isFinished ? 100 : 80;
  const facilities = blockFacilities(state, vehicleSide(vehicle));
  // A wiped windscreen is the cheapest goodwill on the forecourt.
  const squeegee = vehicle.windowsCleaned ? 8 : 0;
  const serviceScore = clamp(
    calculateServiceScore(speedRatio, accuracy, state.station.cleanliness) +
      facilities.satisfaction +
      squeegee,
    0,
    100
  );
  const mods = getEventModifiers(state);
  // Some drivers tip and some never do; the archetype says which.
  const tipHabit = GAME_CONFIG.customerTypes[vehicle.archetype]?.tipChanceModifier ?? 1;
  const tip = Math.round(
    calculateCustomerTip(totalSale, serviceScore, vehicle.archetype) * mods.tip * tipHabit
  );

  vehicle.satisfaction = serviceScore;

  TransactionService.executeCashTransaction(state, {
    type: 'FUEL_SALE',
    amount: totalSale + tip,
    description: `${vehicle.archetype.toUpperCase()} - ${dispensed.toFixed(1)} L ${vehicle.fuelType} satışı${tip > 0 ? ` (+${tip} TL bahşiş)` : ''}`
  });

  rollSideServices(state, vehicle, effects);

  state.player.statistics.totalFuelSoldLiters += dispensed;
  state.player.statistics.totalRevenue += totalSale;
  state.player.statistics.totalTips += tip;
  state.player.statistics.totalCustomersServed++;

  state.dayState.todayStats.fuelRevenue += totalSale;
  state.dayState.todayStats.fuelCost += dispensed * state.tanks[vehicle.fuelType].averageCost;
  state.dayState.todayStats.tips += tip;
  state.dayState.todayStats.customersServed++;

  // Running average of the day's service quality drives end-of-day reputation.
  const served = state.dayState.todayStats.customersServed;
  state.dayState.todayStats.serviceScoreSum =
    (state.dayState.todayStats.serviceScoreSum || 0) + serviceScore;

  // Serving customers dirties the forecourt; a trash can slows that down.
  const hasTrashCan = Object.values(state.buildings).some((b) => b.type === 'trash_can');
  // Islands with a roof over them stay markedly cleaner day to day. Roofs
  // belong to individual pumps, so the relief is earned in proportion: one
  // canopy on a forecourt of six is worth a sixth of it, and roofing the lot
  // gives the full protection the single station-wide canopy used to.
  const pumps = Object.values(state.pumps);
  const roofedShare = pumps.length
    ? pumps.filter((p) => p.hasCanopy).length / pumps.length
    : 0;
  const grimeRelief = 1 - (1 - CANOPY_GRIME_RELIEF) * roofedShare;
  state.station.cleanliness = clamp(
    state.station.cleanliness - (hasTrashCan ? 0.21 : 0.3) * grimeRelief,
    0,
    100
  );

  let xpEarned = 20;
  if (serviceScore >= 85) xpEarned += 5;
  state.player.xp += xpEarned;
  applyLevelProgression(state, effects);

  const pump = vehicle.targetPumpId ? state.pumps[vehicle.targetPumpId] : null;
  vehicle.assignedActor = null;

  // Paid up. A driver may nip into the shop on foot before going — the car
  // stays where it is, so nothing new crosses the apron. Driving to a park
  // afterwards is not on the menu; that was the trip that jammed the plot.
  if (!walkFromPump(state, vehicle, pump, effects)) {
    if (pump) releasePump(pump);
    vehicle.targetPumpId = null;
    sendAway(state, vehicle);
  }

  trackMissionMetric(state, 'CUSTOMERS_SERVED', 1, effects);
  trackMissionMetric(state, 'FUEL_LITERS_SOLD', dispensed, effects);
  trackMissionMetric(state, 'FUEL_REVENUE', totalSale, effects);
  trackMissionMetric(state, 'TIPS_EARNED', tip, effects);
  if (served >= 1) playCue(effects, 'cash');
}

/* ------------------------------------------------------------------ */
/* Facilities: the buildings people walk into                          */
/* ------------------------------------------------------------------ */

/**
 * How often a driver who has just bought fuel leaves the car standing at the
 * pump and walks over to a building. Rare on purpose: it holds the bay for the
 * length of the visit, which is the nudge toward a second pump or a car park —
 * a nuisance rather than a nudge if it were common (Emre, 2026-09-10: %20).
 *
 * Walking is the only way a fuel customer visits. DRIVING to a park afterwards
 * is gone: that second trip across the apron, crossing the cars arriving and
 * the cars leaving, is what gridlocked the forecourt.
 */
export const PUMP_WALK_SHARE = 0.2;

/** How fast a driver walks, in grid units per game second. */
const WALK_SPEED = 1.15;

/**
 * How long a car may stand in a bay or at a pump on a visit before it is sent
 * on regardless. A safety valve, well past the longest stay a facility asks
 * for; it is never the thing that ends an ordinary visit.
 */
const VISIT_TIMEOUT_SECONDS = 150;

/** How long a car pauses on a visit nobody got out for. */
const VIRTUAL_VISIT_SECONDS = 6;

/** Hours a hotel counts as evening: from six until two in the morning. */
function isHotelHour(state: GameState): boolean {
  const hour = hourOfDay(state.dayState.gameTime);
  return hour >= 18 || hour < 2;
}

/** Guests in the hotel right now: cars parked or paused on a visit to it. */
function facilityOccupancy(state: GameState, buildingId: string): number {
  return Object.values(state.vehicles).filter(
    (v) =>
      v.visitBuildingId === buildingId &&
      (v.state === 'TO_PARK' || v.state === 'VISITING' || v.state === 'OPTIONAL_SHOP')
  ).length;
}

/**
 * The odds this driver wants this building, before anyone rolls a die:
 * the catalogue figure, moved by the price on the card, the building's level,
 * and — for a hotel — the hour.
 */
function facilityDraw(state: GameState, building: BuildingEntity, archetype: VehicleArchetype): number {
  const conf = facilityConfig(building.type);
  if (!conf || building.constructionState !== 'ACTIVE') return 0;

  // A shop that has not opened its doors sells nothing. Bare shelves are not
  // the same thing: the shelf count is a day's bookkeeping, and a customer
  // who walks in is still served — that is how the shop has always behaved.
  if (building.type === 'mini_market' && !state.market.active) return 0;
  // A full hotel turns guests away at the desk.
  if (conf.rooms && facilityOccupancy(state, building.id) >= facilityRooms(building)) return 0;

  const base =
    building.type === 'mini_market'
      ? GAME_CONFIG.customerTypes[archetype]?.marketBaseProbability ?? conf.visitChance
      : conf.visitChance;
  const tariff = facilityTariff(building)?.demand ?? 1;
  const hour = conf.nightBoost ? (isHotelHour(state) ? conf.nightBoost : 0.5) : 1;

  return base * tariff * facilityLevelDemand(building) * hour;
}

/** Every open facility on this block. */
function facilitiesOn(state: GameState, side: DrivewaySide): BuildingEntity[] {
  return Object.values(state.buildings).filter(
    (b) => isFacility(b.type) && drivewaySideAt(b.position[1]) === side
  );
}

/**
 * Which facility, if any, this driver goes into.
 *
 * One roll for whether they go in at all — the odds of the block's buildings
 * added up, capped so a forecourt lined with shops still lets some drivers
 * simply leave — and then a weighted pick among them. A driver who turned in
 * FOR the buildings skips the first roll: they are going in somewhere.
 */
export function pickFacility(
  state: GameState,
  side: DrivewaySide,
  archetype: VehicleArchetype,
  cameForOne = false
): BuildingEntity | null {
  const candidates = facilitiesOn(state, side)
    .map((b) => ({ b, weight: facilityDraw(state, b, archetype) }))
    .filter((c) => c.weight > 0);
  if (candidates.length === 0) return null;

  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (!cameForOne && Math.random() >= Math.min(0.85, total)) return null;

  let roll = Math.random() * total;
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) return c.b;
  }
  return candidates[candidates.length - 1].b;
}

/**
 * How many of the drivers who stop here came for a facility and nothing else.
 *
 * Follows what there is to come for: a toilet on its own draws a few, a row
 * of shops draws many. Without somewhere to park, most of them keep driving —
 * a coffee is not worth blocking a pump for, and the driver knows it from the
 * road. With no pumps at all, everyone who stops is here for the buildings.
 */
export function facilityOnlyShare(state: GameState, side: DrivewaySide): number {
  const facilities = facilitiesOn(state, side);
  if (facilities.length === 0) return 0;
  if (!blockHasPumps(state, side)) return 1;

  const draw = facilities.reduce((sum, b) => sum + facilityDraw(state, b, 'commuter'), 0);
  const parking = Object.values(state.buildings).some(
    (b) => (b.type === 'car_park' || b.type === 'truck_park') && drivewaySideAt(b.position[1]) === side
  );
  return Math.min(0.5, draw * 0.8) * (parking ? 1 : 0.4);
}

/** What this visit brings in, with the day's luck rolled for an open bill. */
function rollFacilitySpend(building: BuildingEntity, vehicle: VehicleEntity): number {
  const base = facilitySpend(building, vehicle.archetype);
  if (base <= 0) return 0;
  // A price on the card is the price; a bill has a little give in it.
  const luck = facilityTariff(building) ? 1 : 0.8 + Math.random() * 0.4;
  return Math.round(base * luck);
}

/**
 * The visit itself, booked: the shelf is emptied by one, the till fills, the
 * day's figures move. Nothing reaches the station's cash until somebody
 * collects.
 */
function bookVisit(
  state: GameState,
  building: BuildingEntity,
  vehicle: VehicleEntity,
  share: number,
  effects: SimEffects
): number {
  if (vehicle.visitMode === 'PUMP') {
    building.todayVisitsFromPump = (building.todayVisitsFromPump ?? 0) + 1;
  } else if (vehicle.visitMode === 'PARK') {
    building.todayVisitsFromPark = (building.todayVisitsFromPark ?? 0) + 1;
  }
  if (building.type === 'mini_market' || building.type === 'rest_complex') {
    if (state.market.stock > 0) state.market.stock -= 1;
    trackMissionMetric(state, 'MARKET_SALES', 1, effects);
  }
  building.todayVisits = (building.todayVisits ?? 0) + 1;

  const amount = Math.round(rollFacilitySpend(building, vehicle) * share);
  creditFacility(state, building, amount);
  return amount;
}

/**
 * A route on foot from one point to another: straight when nothing is in the
 * way, round the buildings and islands when something is. People need far
 * less room than cars, so the walls are barely grown.
 */
function walkRoute(
  state: GameState,
  block: BlockLayout,
  from: [number, number, number],
  to: [number, number, number],
  ignoreBuildingIds: Array<string | null | undefined>
): Array<[number, number, number]> {
  const rects = [
    ...wallRects(state, block.side, 0.3, ignoreBuildingIds.filter((id): id is string => !!id)),
    ...pumpRects(state, block.side, undefined, 0.3)
  ];
  const a: [number, number] = [from[0], from[2]];
  const b: [number, number] = [to[0], to[2]];
  if (legIsClear(rects, a, b)) return [to];

  const bounds = { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ };
  const path = detour(rects, a, b, bounds);
  if (!path) return [to];

  const out: Array<[number, number, number]> = [];
  for (const [x, z] of straighten(rects, a, path)) {
    if (Math.hypot(x - b[0], z - b[1]) < 0.5) continue;
    out.push([x, 0, z]);
  }
  out.push(to);
  return out;
}

/** Where the driver's door is: beside the car, on its left. */
function carDoor(vehicle: VehicleEntity): [number, number, number] {
  const body = vehicleBodyHalfExtents(vehicle);
  const side = body.width + 0.35;
  return [
    vehicle.worldPosition[0] + Math.cos(vehicle.heading) * side,
    0,
    vehicle.worldPosition[2] - Math.sin(vehicle.heading) * side
  ];
}

/** The driver gets out and sets off for the building. */
function spawnVisitor(state: GameState, vehicle: VehicleEntity, building: BuildingEntity): void {
  const block = blockFor(state, vehicle);
  const door = carDoor(vehicle);
  const route = walkRoute(state, block, door, facilityDoor(building), [building.id, vehicle.parkingBuildingId]);

  let look = 0;
  for (const char of vehicle.id) look = (look * 31 + char.charCodeAt(0)) | 0;

  vehicle.visitor = {
    phase: 'TO_BUILDING',
    worldPosition: [door[0], 0, door[2]],
    heading: vehicle.heading,
    route: route.slice(1),
    targetWaypoint: route[0] ?? null,
    insideSecondsLeft: 0,
    carDoor: door,
    look: Math.abs(look)
  };
}

/** Moves a walker along their route; true once the last point is reached. */
function walkToward(
  visitor: NonNullable<VehicleEntity['visitor']>,
  dt: number
): boolean {
  let budget = WALK_SPEED * dt;

  while (budget > 0) {
    const target = visitor.targetWaypoint;
    if (!target) return true;

    const dx = target[0] - visitor.worldPosition[0];
    const dz = target[2] - visitor.worldPosition[2];
    const distance = Math.hypot(dx, dz);
    if (distance > 0.001) visitor.heading = Math.atan2(dx, dz);

    if (distance > budget) {
      visitor.worldPosition = [
        visitor.worldPosition[0] + (dx / distance) * budget,
        0,
        visitor.worldPosition[2] + (dz / distance) * budget
      ];
      return false;
    }

    visitor.worldPosition = [target[0], 0, target[2]];
    budget -= distance;
    const next = visitor.route.shift();
    visitor.targetWaypoint = next ?? null;
    if (!next) return true;
  }
  return false;
}

/**
 * The driver's walk, one tick of it. Money changes hands at the door on the
 * way in; the walk back starts when their time inside is up. True once they
 * are back at the car.
 */
function advanceVisitor(
  state: GameState,
  vehicle: VehicleEntity,
  building: BuildingEntity,
  dt: number,
  effects: SimEffects
): boolean {
  const visitor = vehicle.visitor;
  if (!visitor) return true;

  switch (visitor.phase) {
    case 'TO_BUILDING': {
      if (!walkToward(visitor, dt)) return false;
      visitor.phase = 'INSIDE';
      visitor.insideSecondsLeft = facilityConfig(building.type)?.visitSeconds ?? 6;
      bookVisit(state, building, vehicle, 1, effects);
      return false;
    }
    case 'INSIDE': {
      visitor.insideSecondsLeft -= dt;
      if (visitor.insideSecondsLeft > 0) return false;
      visitor.phase = 'TO_CAR';
      const back = walkRoute(
        state,
        blockFor(state, vehicle),
        facilityDoor(building),
        visitor.carDoor,
        [building.id, vehicle.parkingBuildingId]
      );
      visitor.route = back.slice(1);
      visitor.targetWaypoint = back[0] ?? null;
      return false;
    }
    case 'TO_CAR':
      return walkToward(visitor, dt);
  }
  return true;
}

/** Whether this car is standing in the bay it was given, or near enough. */
function inParkingBay(state: GameState, vehicle: VehicleEntity): boolean {
  if (!vehicle.parkingBuildingId || vehicle.parkingSlot == null) return false;
  const park = state.buildings[vehicle.parkingBuildingId];
  if (!park) return false;
  const bay = parkingBay(park, vehicle.parkingSlot, vehicleBodyHalfExtents(vehicle));
  return (
    Math.hypot(vehicle.worldPosition[0] - bay.pose[0], vehicle.worldPosition[2] - bay.pose[2]) < 0.6
  );
}

/**
 * A free bay in a park on this block that the car can actually drive to,
 * nearest first. Null when every bay is taken, walled off, or there is no
 * park of the right kind at all.
 */
function findParkingBay(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout
): {
  buildingId: string;
  slot: number;
  route: Array<[number, number, number]>;
} | null {
  const kind = parkingTypeFor(vehicle);
  const body = vehicleBodyHalfExtents(vehicle);

  const taken = new Set<string>();
  for (const other of Object.values(state.vehicles)) {
    if (other.id !== vehicle.id && other.parkingBuildingId && other.parkingSlot != null) {
      taken.add(`${other.parkingBuildingId}:${other.parkingSlot}`);
    }
  }

  const options: Array<{ buildingId: string; slot: number; distance: number }> = [];
  for (const park of Object.values(state.buildings)) {
    if (park.type !== kind || drivewaySideAt(park.position[1]) !== block.side) continue;
    const count = parkingBayCount(park);
    for (let slot = 0; slot < count; slot++) {
      if (taken.has(`${park.id}:${slot}`)) continue;
      const bay = parkingBay(park, slot, body);
      options.push({
        buildingId: park.id,
        slot,
        distance: Math.hypot(
          bay.pose[0] - vehicle.worldPosition[0],
          bay.pose[2] - vehicle.worldPosition[2]
        )
      });
    }
  }
  options.sort((a, b) => a.distance - b.distance);

  // A car standing at a pump rolls clear of the island nose first, and the
  // rest of the way is planned from THERE. Planned from the bay itself, the
  // planner excuses the island the car stands in — it has to, or the car
  // could never set off — and then draws the whole route through it.
  const rollOut = bayRollOut(state, block, vehicle);
  const planner = rollOut ? { ...vehicle, worldPosition: rollOut } : vehicle;

  for (const option of options) {
    const park = state.buildings[option.buildingId];
    const bay = parkingBay(park, option.slot, body);
    const runUp = clampLaneToApron(block, bay.runUp);
    // The spot behind the bay is where the car turns in from; a building
    // standing on it makes the bay a bay nobody can use. The park itself is
    // not such a building: held onto the concrete, the spot can fall just
    // inside the park's own lines, and that is the car's to drive on.
    if (inRects(wallRects(state, block.side, 0, option.buildingId), runUp[0], runUp[2])) continue;

    const legs = parkApproachLegs(state, block, runUp, bay.pose);
    const route = driveable(state, planner, block, legs, undefined, option.buildingId);
    if (route) {
      return {
        buildingId: option.buildingId,
        slot: option.slot,
        route: rollOut ? [rollOut, ...route] : route
      };
    }
  }
  return null;
}

/**
 * The way into a bay from wherever the planning starts: along the front lane
 * to a point behind the park, and in. The last leg is straight so the car
 * stops square in its lines.
 */
function parkApproachLegs(
  state: GameState,
  block: BlockLayout,
  runUp: [number, number, number],
  pose: [number, number, number]
): Array<[number, number, number]> {
  const legs: Array<[number, number, number]> = [];
  if (Math.abs(runUp[2] - block.laneZ) > 1) {
    legs.push(offWalls(state, block, clampToApron(block, [runUp[0], 0, block.laneZ])));
  }
  legs.push(runUp, pose);
  return legs;
}

/**
 * Where a car standing at a pump gets to by rolling straight out of the bay,
 * nose first, until it is clear of the island's margin — or null when it is
 * not at a bay, or something stands in the way of rolling out at all.
 */
function bayRollOut(
  state: GameState,
  block: BlockLayout,
  vehicle: VehicleEntity
): [number, number, number] | null {
  const bay = standingAtBay(state, block, vehicle);
  if (!bay) return null;

  const walls = [...wallRects(state, block.side, 0), ...pumpRects(state, block.side, undefined, 0)];
  const islands = pumpRects(state, block.side);
  const from: [number, number] = [vehicle.worldPosition[0], vehicle.worldPosition[2]];

  for (const run of [2.4, 3.2, 4, 4.8]) {
    const point = clampLaneToApron(block, [
      vehicle.worldPosition[0] + bay.dir[0] * run,
      0,
      vehicle.worldPosition[2] + bay.dir[1] * run
    ]);
    // Through a wall, or into the next island: no rolling out this way.
    if (!legIsClear(walls, from, [point[0], point[2]])) return null;
    if (!inRects(islands, point[0], point[2])) return point;
  }
  return null;
}

/**
 * The pump bay this car is standing in, if it is in one: which face of the
 * island, and the way its nose points. Leaving a bay is done nose first
 * whatever comes after, or the tail sweeps through the island.
 */
function standingAtBay(
  state: GameState,
  block: BlockLayout,
  vehicle: VehicleEntity
): { kind: 'front' | 'other'; dir: [number, number] } | null {
  const inward = block.side === 'far' ? -1 : 1;
  for (const pump of Object.values(state.pumps)) {
    if (pumpSide(pump) !== block.side) continue;
    const bay = pumpBay(block, pump, vehicle);
    if (Math.hypot(vehicle.worldPosition[0] - bay[0], vehicle.worldPosition[2] - bay[2]) >= 1) {
      continue;
    }
    return {
      kind: (pump.position[1] - bay[2]) * inward > 0 ? 'front' : 'other',
      dir: bayApproachDir(pump)
    };
  }
  return null;
}

/**
 * Starts the one facility visit this driver chose before entering the plot.
 *
 * They park and walk when a matching bay is available. If there is no usable
 * bay, the visit is represented at a fraction without creating another route
 * across the apron. Fuel and charging customers never enter this path.
 */
function startFacilityVisit(
  state: GameState,
  vehicle: VehicleEntity,
  effects: SimEffects
): void {
  const side = vehicleSide(vehicle);
  const building = pickFacility(state, side, vehicle.archetype, true);

  if (!building) {
    vehicle.targetPumpId = null;
    vehicle.visitBuildingId = null;
    vehicle.visitMode = null;
    sendAway(state, vehicle);
    return;
  }

  vehicle.visitBuildingId = building.id;
  vehicle.waitingTimeSeconds = 0;
  vehicle.shoppingIntent = true;
  const conf = facilityConfig(building.type)!;
  vehicle.targetPumpId = null;

  const bay = findParkingBay(state, vehicle, blockFor(state, vehicle));
  if (bay) {
    vehicle.visitMode = 'PARK';
    vehicle.parkingBuildingId = bay.buildingId;
    vehicle.parkingSlot = bay.slot;
    setVehicleState(vehicle, 'TO_PARK');
    setRoute(vehicle, bay.route);
    return;
  }

  // No bay free: nothing happens and nothing is earned. A driver who cannot
  // park cannot shop — the same as pulling into a full car park in life and
  // driving out again (Emre, 2026-09-10). Booking a fraction "through the
  // window" was money for a visit that never took place, and money the player
  // could not trace to anything on screen.
  vehicle.visitBuildingId = null;
  vehicle.visitMode = null;
  vehicle.shoppingIntent = false;
  sendAway(state, vehicle);
}

/** The visit is over, one way or another: the driver is back in and the car goes. */
/**
 * A driver who set off for the park and could not get there gives up and
 * leaves — with nothing spent, because nothing happened. The player's reason
 * to lay the park out where cars can actually reach it is exactly that.
 */
function giveUpParking(state: GameState, vehicle: VehicleEntity, effects: SimEffects): void {
  void effects;
  endVisit(state, vehicle);
}

function endVisit(state: GameState, vehicle: VehicleEntity): void {
  vehicle.visitor = undefined;
  vehicle.visitBuildingId = null;
  vehicle.visitMode = null;
  if (vehicle.targetPumpId && state.pumps[vehicle.targetPumpId]) {
    releasePump(state.pumps[vehicle.targetPumpId]);
  }
  vehicle.targetPumpId = null;
  sendAway(state, vehicle);
}

export function applyLevelProgression(state: GameState, effects: SimEffects): void {
  let next = GAME_CONFIG.levels.find((l) => l.level === state.player.level + 1);
  while (next && state.player.xp >= next.requiredTotalXp) {
    state.player.level = next.level;
    if (next.rewardCash > 0) {
      TransactionService.executeCashTransaction(state, {
        type: 'TUTORIAL_REWARD',
        amount: next.rewardCash,
        description: `Seviye ${next.level} ödülü`
      });
    }
    playCue(effects, 'levelUp');
    notify(
      effects,
      'REWARD',
      `Seviye Atladınız: Seviye ${next.level}!`,
      `${next.unlockedFeatures} açıldı!`
    );
    next = GAME_CONFIG.levels.find((l) => l.level === state.player.level + 1);
  }
}

/* ------------------------------------------------------------------ */
/* Tick sub-systems                                                    */
/* ------------------------------------------------------------------ */

/** The tank farm a delivery docks at — one farm serves all three fuels. */
export function tankBuildingFor(state: GameState, fuelType: FuelType): BuildingEntity | null {
  void fuelType;
  return Object.values(state.buildings).find((b) => b.type === 'tank_farm') ?? null;
}

/** Each fuel's own berth along the farm's front, so two lorries stand abreast. */
const TANKER_BAY_OFFSET: Record<string, number> = { gasoline: -1.6, diesel: 0, lpg: 1.6 };

/**
 * Where a tanker parks to unload: alongside the farm, hose-length from the
 * filler caps, on the road side of it — at its own fuel's berth.
 */
function tankerBay(
  state: GameState,
  block: BlockLayout,
  tank: BuildingEntity,
  fuelType: FuelType
): [number, number, number] | null {
  const half = (tank.size?.[1] ?? 3) / 2;
  const inward = block.side === 'far' ? -1 : 1;
  const x = tank.position[0] + (TANKER_BAY_OFFSET[fuelType] ?? 0);

  // Behind the farm, away from the road — the far side from the customers.
  // Berthing on the road side put eighty seconds of unloading lorry across
  // the lane the cars leave by. If the player has built there, the other side
  // will do; if both are built over, the lorry has nowhere to stand and says
  // so rather than settling inside the shop and unloading through its wall.
  //
  // The farm itself is a wall here too. It used to be excused, and a farm
  // parked against the plot edge showed why that was wrong: the clamp above
  // pulled the berth back inside the farm's own footprint, the excusal let it
  // through, and the lorry unloaded from inside the silos.
  const walls = wallRects(state, block.side, 0);
  for (const towards of [inward, -inward]) {
    const berth = clampToApron(block, [x, 0, tank.position[1] + towards * (half + 1.3)]);
    if (!inRects(walls, berth[0], berth[2])) return berth;
  }
  return null;
}

/**
 * Whether a customer car stands in the lorry's path. Other lorries
 * deliberately do not: they held each other at the gate and in the aisles,
 * and a queue of paid-for fuel sitting on the road felt like the game being
 * slow rather than the game being busy. Deliveries all run at once now, and
 * two lorries sharing a berth is accepted as the price.
 */
function truckHeldUp(
  state: GameState,
  truck: NonNullable<FuelOrderEntity['truck']>,
  roadLaneZ: number
): boolean {
  const onRoad = Math.abs(truck.worldPosition[2] - roadLaneZ) < 1.5;
  const dx = Math.sin(truck.heading);
  const dz = Math.cos(truck.heading);
  const inPath = (x: number, z: number, reach: number) => {
    const ox = x - truck.worldPosition[0];
    const oz = z - truck.worldPosition[2];
    const ahead = ox * dx + oz * dz;
    const lateral = Math.abs(ox * dz - oz * dx);
    return ahead > 0.4 && ahead < reach && lateral < 1.5;
  };

  for (const vehicle of Object.values(state.vehicles)) {
    // On the plot the customer already yields to the lorry, so it only needs
    // to stop at the last safe body-length. Looking the full road distance
    // ahead there made a tanker wait behind unrelated pump traffic forever.
    const reach = onRoad ? FOLLOW_DISTANCE * 1.5 : 2.15;
    if (!inPath(vehicle.worldPosition[0], vehicle.worldPosition[2], reach)) continue;

    // If that car is itself braking for this lorry, both would sit there
    // waiting for the other until the driver's patience ran out — which is
    // exactly how customers were being lost at a station with nothing wrong
    // with it. Nose to nose, the lorry has right of way and the car yields.
    const theirDir = headingVector(vehicle);
    if (theirDir) {
      const bx = truck.worldPosition[0] - vehicle.worldPosition[0];
      const bz = truck.worldPosition[2] - vehicle.worldPosition[2];
      const theirAhead = bx * theirDir.x + bz * theirDir.z;
      const theirLateral = Math.abs(bx * theirDir.z - bz * theirDir.x);
      if (theirAhead > 0.3 && theirLateral < 1.4) continue;
    }
    return true;
  }

  return false;
}

/**
 * The customer traffic on the plot, grown to lorry margins, for steering
 * around. Other lorries are left out on purpose — see truckHeldUp.
 */
function truckObstacleRects(state: GameState): PathRect[] {
  const rects: PathRect[] = [];

  for (const vehicle of Object.values(state.vehicles)) {
    const [x, , z] = vehicle.worldPosition;
    rects.push({ minX: x - 1.2, maxX: x + 1.2, minZ: z - 1.2, maxZ: z + 1.2 });
  }
  return rects;
}

/**
 * One tick of lorry driving. Blocked, it stops — a forty-tonner does not
 * creep through a parked hatchback — and after a few seconds stood still it
 * asks the pathfinder for a way *around* what it is stood behind, treating
 * the traffic as walls. No way round yet: it waits; queues move eventually.
 */
function advanceTruck(
  state: GameState,
  truck: NonNullable<FuelOrderEntity['truck']>,
  dt: number
): boolean {
  const tank = truck.tankBuildingId ? state.buildings[truck.tankBuildingId] : null;
  const side = tank ? drivewaySideAt(tank.position[1]) : 'near';
  const roadZ = blockLayout(state, side)?.roadLaneZ ?? -3;

  if (!truckHeldUp(state, truck, roadZ)) {
    truck.blockedSeconds = 0;
    // Highway pace out on the road; walking pace once it turns onto the plot.
    // A tanker crawling down the carriageway put a thirty-second tail of
    // braking traffic behind it.
    truck.speed = Math.abs(truck.worldPosition[2] - roadZ) < 1.2 ? 0.95 : 0.7;
    return driveToward(truck as unknown as VehicleEntity, dt);
  }

  truck.blockedSeconds = (truck.blockedSeconds ?? 0) + dt;
  if (truck.blockedSeconds < 4) return false;
  truck.blockedSeconds = 0;

  // Keep every remaining waypoint, above all the driveway mouth. Replanning
  // to the final berth alone draws a diagonal from the carriageway to the
  // tank; where that line meets the apron becomes an accidental new entrance
  // through the fence. Traffic may delay the lorry, but it must still use the
  // real gate once the road clears.
  const remaining: Array<[number, number, number]> = truck.targetWaypoint
    ? [truck.targetWaypoint, ...truck.route]
    : [...truck.route];
  if (remaining.length === 0) return false;

  const block = blockLayout(state, side) ?? blockLayout(state, 'near')!;

  const detoured = routeAroundOrNull(
    state,
    { worldPosition: truck.worldPosition } as VehicleEntity,
    block.side,
    remaining,
    { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
    frontageKeepOut(block),
    undefined,
    truck.tankBuildingId ?? undefined,
    truckObstacleRects(state)
  );

  if (detoured) {
    truck.route = detoured.slice(1);
    truck.targetWaypoint = detoured[0] ?? null;
    truck.routeProgress = 0;
  }
  return false;
}

/** Road pace of a loaded lorry, in grid units per game-second. */
const TRUCK_ROAD_SPEED = BASE_DRIVE_SPEED * 0.95;

/**
 * Puts the order's lorry on the road, aimed in through the entry mouth and
 * round to its berth — if a berth and a legal way to it exist yet.
 *
 * Called every tick while the order counts down: the lorry holds off until
 * there is just enough road left that it reaches the entry mouth as the
 * counter shows its last second. "Yolda · 3 sn" over an empty road read as a
 * lie, and a lorry materialising at the gate on zero read as a glitch — the
 * spawn point is fixed, so honesty is only a matter of when to start driving.
 */
/**
 * Where a lorry for this fuel starts, turns in and berths — the cheap
 * geometry, no route search. Null when there is no tank for the fuel or no
 * berth stands clear of the buildings.
 */
function tankerApproach(
  state: GameState,
  fuelType: FuelType
): {
  tank: BuildingEntity;
  block: BlockLayout;
  bay: [number, number, number];
  start: [number, number, number];
  laneX: number;
} | null {
  const tank = tankBuildingFor(state, fuelType);
  if (!tank) return null;

  const side = drivewaySideAt(tank.position[1]);
  const block = blockLayout(state, side) ?? blockLayout(state, 'near')!;

  // Turn off the highway at the entry mouth, then straight up to the back
  // service lane and along it to the bay. The front lane belongs to the
  // customers — a forty-tonner idling on it corks the whole forecourt.
  const bay = tankerBay(state, block, tank, fuelType);
  if (!bay) return null;

  const flow = Math.sign(block.roadEndX - block.roadStartX) || 1;
  const start: [number, number, number] = [block.roadStartX - flow * 8, 0, block.roadLaneZ];
  return { tank, block, bay, start, laneX: drivewayLaneX(block.entry, 0) };
}

/**
 * The lorry's way in for this fuel, or null when the plot leaves it none.
 *
 * The back lane is still where a lorry belongs — but "up from the mouth,
 * then along the back" was written as fixed waypoints, and on the starting
 * plot the first of them runs straight through the office. The planner
 * could only answer "no", and the code took a raw straight line instead:
 * that is the lorry the player watched drive over the field and unload
 * inside a building.
 *
 * So the back lane is a preference now, not an instruction. If it cannot
 * be reached, the planner is asked for a way in past the front lane
 * instead, and if there is no way at all the lorry holds at the gate —
 * where the corner widget already says it is waiting, and where moving
 * whatever blocks it is the player's to do. Every branch goes through the
 * planner; none of them may ignore the plot.
 *
 * Yerleşim kuralı ve giriş bekçisi de aynı soruyu buradan sorar (Emre,
 * 2026-09-09: tank sahasının yanına dikilen direk tankeri kapıda bıraktı,
 * "yolda gözükmüyor" — tek bir kaynak, üç yer).
 */
export function tankerRoute(
  state: GameState,
  fuelType: FuelType
): Array<[number, number, number]> | null {
  const approach = tankerApproach(state, fuelType);
  if (!approach) return null;
  const { tank, block, bay, start, laneX } = approach;
  const carrier = { worldPosition: start } as VehicleEntity;

  // The tank package is the one thing the lorry may hug: the farm it berths
  // against, and the expansion built beside it — more tank, not a wall. Left
  // in as a wall, an expansion on the berth side put the berth inside its
  // turning margin and the lorry had no way to the very tanks it was filling.
  const hug = [
    tank.id,
    ...Object.values(state.buildings)
      .filter((b) => b.type === 'tank_expansion' && drivewaySideAt(b.position[1]) === block.side)
      .map((b) => b.id)
  ];

  const viaBackLane = driveable(
    state,
    carrier,
    block,
    [
      [laneX, 0, block.roadLaneZ],
      [laneX, 0, block.exitLaneZ],
      [bay[0], 0, block.exitLaneZ],
      bay
    ],
    undefined,
    hug,
    true
  );
  return (
    viaBackLane ??
    driveable(
      state,
      carrier,
      block,
      [[laneX, 0, block.roadLaneZ], [laneX, 0, block.laneZ], bay],
      undefined,
      hug,
      true
    )
  );
}

function dispatchTruck(state: GameState, order: FuelOrderEntity): void {
  const approach = tankerApproach(state, order.fuelType);
  if (!approach) return;
  const { tank, block, start, laneX } = approach;

  // Too early: it would stand at the mouth with the counter still running.
  const secondsToGate = 1 + Math.abs(laneX - start[0]) / TRUCK_ROAD_SPEED;
  if (order.remainingSeconds > secondsToGate) return;

  const route = tankerRoute(state, order.fuelType);
  if (!route) return;

  // Delivery lorries and ordinary road traffic share the same off-map entry.
  // Spawning forty tonnes on top of a car already crossing that point creates
  // an overlap before either following rule gets a chance to brake.
  const spawnBusy = Object.values(state.vehicles).some(
    (vehicle) =>
      Math.abs(vehicle.worldPosition[2] - block.roadLaneZ) < FOLLOW_CORRIDOR &&
      Math.abs(vehicle.worldPosition[0] - start[0]) < FOLLOW_DISTANCE * 1.5
  );
  if (spawnBusy) return;

  order.truck = {
    worldPosition: start,
    heading: block.roadEndX > block.roadStartX ? Math.PI / 2 : -Math.PI / 2,
    route: route.slice(1),
    targetWaypoint: route[0] ?? null,
    routeProgress: 0,
    // A loaded tanker does not corner like a hatchback.
    speed: 0.55,
    phase: 'ARRIVING',
    tankBuildingId: tank.id
  };
}

/**
 * Drives the delivery lorry the way customers are driven: in off the highway,
 * through the entry mouth, round whatever the player has built, to the bay
 * beside its own tank — and back out again when the hose comes off.
 *
 * It does not queue behind customer cars: a 16-metre tanker threading the
 * same follow-the-leader rules would deadlock the forecourt it is there to
 * supply, so it drives its route and the cars are left to keep clear.
 */
function tickFuelOrders(state: GameState, dt: number, effects: SimEffects): void {
  for (let i = state.fuelOrders.length - 1; i >= 0; i--) {
    const order = state.fuelOrders[i];

    if (order.state === 'TRAVELLING') {
      order.remainingSeconds -= dt;

      // The last leg of the countdown is driven, not counted: the lorry is
      // dispatched with just enough road left to be turning in at the entry
      // mouth as the counter reaches its final second. Every order sends its
      // own lorry — they used to hold for each other at the gate, and a queue
      // of paid-for fuel parked on the horizon read as the game being stuck.
      if (!order.truck) dispatchTruck(state, order);
      if (order.truck) advanceTruck(state, order.truck, dt);

      if (order.remainingSeconds <= 0) {
        // The corner widget carries the routine progress; the toast feed is
        // for things that need the player, and a lorry turning up is not one.
        order.state = setOrderState(order.id, order.state, 'QUEUED_AT_GATE');
        order.remainingSeconds = 0;
      }
      continue;
    }

    if (order.state === 'QUEUED_AT_GATE') {
      // No tank standing for this fuel (an old save, or it was sold while
      // the lorry was on the road): fall back to the timer-only delivery
      // rather than a lorry with nowhere to go.
      if (!tankBuildingFor(state, order.fuelType)) {
        order.state = setOrderState(order.id, order.state, 'UNLOADING');
        order.remainingSeconds = order.liters / GAME_CONFIG.economy.tankerUnloadSpeedLps;
        continue;
      }

      // Not dispatched on the way in — no berth stood clear, or no way onto
      // the plot was open. Keep asking; the widget says it is at the gate.
      if (!order.truck) {
        dispatchTruck(state, order);
        continue;
      }

      if (order.truck.phase === 'ARRIVING') {
        // A lorry that cannot reach its berth — walled in, or nose to nose
        // with something that will not move — unloads where it stands after
        // a couple of minutes rather than holding its order hostage forever.
        order.truck.onPlotSeconds = (order.truck.onPlotSeconds ?? 0) + dt;
        const gaveUp = order.truck.onPlotSeconds > 120;
        const arrived = advanceTruck(state, order.truck, dt) || gaveUp;
        // Every hose runs at once: a second lorry for the same fuel backs in
        // beside the first instead of idling behind it.
        if (arrived) {
          order.truck.phase = 'UNLOADING';
          order.state = setOrderState(order.id, order.state, 'UNLOADING');
          order.remainingSeconds = order.liters / GAME_CONFIG.economy.tankerUnloadSpeedLps;
        }
      }
      continue;
    }

    if (order.state === 'UNLOADING') {
      order.remainingSeconds -= dt;
      if (order.remainingSeconds <= 0) {
        const res = TransactionService.receiveFuelDelivery(
          state,
          order.fuelType,
          order.liters,
          order.unitCost
        );
        order.state = setOrderState(order.id, order.state, 'COMPLETED');
        playCue(effects, 'cash');

        // Alım Defteri: teslimat tamamlandı, kayıt düş.
        state.fuelPurchaseHistory.push({
          id: 'fpr_' + Math.random().toString(36).substring(2, 9),
          day: state.dayState.currentDay,
          fuelType: order.fuelType,
          liters: order.liters,
          unitCost: order.unitCost,
          totalCost: order.totalCost,
          supplierId: order.supplierId,
          deliveredAt: Date.now()
        });

        // Only the surprise is worth a toast: litres that came all this way
        // and would not fit. A clean delivery just ticks over in the corner.
        if (res.refundedLiters > 0) {
          notify(
            effects,
            'WARNING',
            'Depo Doldu',
            `${res.refundedLiters.toFixed(0)} L ${order.fuelType} tanka sığmadı, bedeli iade edildi.`
          );
        }

        // The hose is off; the lorry pulls out through the exit mouth. Only
        // the timer-fallback deliveries vanish on the spot.
        if (order.truck) {
          const tank = order.truck.tankBuildingId
            ? state.buildings[order.truck.tankBuildingId]
            : null;
          const side = tank ? drivewaySideAt(tank.position[1]) : 'near';
          const block = blockLayout(state, side) ?? blockLayout(state, 'near')!;
          const laneX = drivewayLaneX(block.exit, 0);
          const from = order.truck.worldPosition;
          const carrier = { worldPosition: from } as VehicleEntity;

          // Back lane out by preference, front lane if the back is walled
          // off. There is deliberately no raw straight line after these: that
          // fallback was the lorry the player watched cut over the grass and
          // through the buildings to the exit. With no legal way out it goes
          // the way a walled-in car goes — it simply goes.
          const route =
            driveable(
              state,
              carrier,
              block,
              [
                [from[0], 0, block.exitLaneZ],
                [laneX, 0, block.exitLaneZ],
                [laneX, 0, block.roadLaneZ],
                [block.roadEndX, 0, block.roadLaneZ]
              ],
              undefined,
              order.truck.tankBuildingId ?? undefined,
              true
            ) ??
            driveable(
              state,
              carrier,
              block,
              [
                [from[0], 0, block.laneZ],
                [laneX, 0, block.laneZ],
                [laneX, 0, block.roadLaneZ],
                [block.roadEndX, 0, block.roadLaneZ]
              ],
              undefined,
              order.truck.tankBuildingId ?? undefined,
              true
            );

          if (route) {
            order.truck.phase = 'LEAVING';
            order.truck.route = route.slice(1);
            order.truck.targetWaypoint = route[0] ?? null;
          } else {
            state.fuelOrders.splice(i, 1);
          }
        } else {
          state.fuelOrders.splice(i, 1);
        }
      }
      continue;
    }

    if (order.state === 'COMPLETED' && order.truck?.phase === 'LEAVING') {
      // Same for the way out: it does not linger on the plot forever.
      order.truck.onPlotSeconds = (order.truck.onPlotSeconds ?? 0) + dt;
      if (advanceTruck(state, order.truck, dt) || order.truck.onPlotSeconds > 240) {
        state.fuelOrders.splice(i, 1);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Highway traffic                                                     */
/* ------------------------------------------------------------------ */

/**
 * Cars per second on the highway at an average hour. The road is busy whether
 * or not the station has anything to sell — what the player's decisions move
 * is the share of those drivers who pull in, not how many drive past.
 */
const ROAD_TRAFFIC_PER_SEC = 0.42;

/**
 * Ceiling on how many of them the scene carries at once.
 *
 * roadMargin ile birlikte büyüdü: yol uçları ekran menzilinin dışına
 * taşınınca her araç yolda daha uzun süre kalıyor; tavan aynı kalsaydı yol
 * seyrekleşir, üstüne müşteri akışı da geçen trafiğin işgal ettiği kotaya
 * boğulurdu. Birim yol başına yoğunluk hız ve doğum temposundan gelir, bu
 * sayı yalnız sahnenin taşıyabildiğidir.
 */
const MAX_ACTIVE_VEHICLES = 24;

/** The best a station can ever do: most of the road still drives on by. */
const MAX_STOP_RATE = 0.72;

/** A block with a shop but no pumps is worth a detour, but a lesser one. */
const SHOP_ONLY_APPEAL = 0.4;

/** How much harder a rush pushes drivers onto the forecourt. */
const RUSH_STOP_MULTIPLIER = 2.2;

/**
 * A rush lasts a minute of the player's time, not the forecourt's.
 *
 * These windows are a prompt to whoever is at the keyboard — look up, the next
 * sixty seconds matter — so they are measured in wall-clock seconds and stay
 * the same length whatever the clock on the wall of the station says.
 *
 * Rare enough to stay an event: a minute out of a four-minute day is a quarter
 * of it, so at better odds than this the forecourt would be busy more often
 * than not and the word would stop meaning anything.
 */
const RUSH_CHANCE_PER_SEC = 1 / 260;
const RUSH_SECONDS = 60;

/**
 * Once a day the supplier drops *their* price for a minute — this is a
 * discount on the fuel the player buys in, not on what they sell it for. The
 * board out front does not change; the tanker does. It lands at a different
 * hour each morning, so the only way to catch it is to be watching, which is
 * the point of it.
 */
const FUEL_DEAL_SECONDS = 60;
export const FUEL_DEAL_DISCOUNT = 0.3;

/** True while a burst of custom is running. */
export function isRushHour(state: GameState): boolean {
  return (state.dayState.rushSecondsLeft ?? 0) > 0;
}

/** True while the supplier's daily discount window is open. */
export function isFuelDealOn(state: GameState): boolean {
  return (state.dayState.fuelDealSecondsLeft ?? 0) > 0;
}

/** What a litre costs to buy right now, discount included. */
export function wholesaleNow(state: GameState, fuelType: FuelType): number {
  const listed = state.pricing[fuelType].todayWholesaleCost;
  return isFuelDealOn(state) ? Number((listed * (1 - FUEL_DEAL_DISCOUNT)).toFixed(2)) : listed;
}

/**
 * Runs the day's one discounted window: picks an hour for it each morning,
 * opens it when the clock reaches that hour, and shuts it a minute later.
 */
function tickFuelDeal(state: GameState, dt: number, effects: SimEffects): void {
  const day = state.dayState;

  if ((day.fuelDealSecondsLeft ?? 0) > 0) {
    const left = (day.fuelDealSecondsLeft ?? 0) - dt;
    day.fuelDealSecondsLeft = Math.max(0, left);
    if (left <= 0) {
      notify(effects, 'INFO', 'İndirim Bitti', 'Tedarikçi alış fiyatları normale döndü.');
    }
    return;
  }

  if (day.fuelDealDoneToday) return;

  // Drawn fresh each morning, and never in the small hours when nobody is
  // looking — an offer the player cannot see is not an offer.
  if (day.fuelDealAtHour === undefined) {
    day.fuelDealAtHour = 8 + Math.random() * 13;
  }
  if (hourOfDay(day.gameTime) < day.fuelDealAtHour || day.gameTime >= 24) return;

  day.fuelDealSecondsLeft = FUEL_DEAL_SECONDS;
  day.fuelDealDoneToday = true;
  playCue(effects, 'alert');
  notify(
    effects,
    'INFO',
    `Toptan Yakıt İndirimi! %${Math.round(FUEL_DEAL_DISCOUNT * 100)}`,
    'Tedarikçi bir dakikalığına tüm yakıtlarda alış fiyatını indirdi — depoları şimdi doldurun.',
    EVENT_TOAST_HOLD_MS
  );
}

/**
 * Starts and ends the bursts of custom. They are deliberately independent of
 * the daily event roll: an event colours a whole day, whereas this is the
 * minute or two of pressure that makes the forecourt worth watching.
 */
function tickRush(state: GameState, dt: number, effects: SimEffects): void {
  const left = state.dayState.rushSecondsLeft ?? 0;

  if (left > 0) {
    const next = left - dt;
    state.dayState.rushSecondsLeft = Math.max(0, next);
    if (next <= 0) {
      notify(effects, 'INFO', 'Yoğunluk Geçti', 'Trafik normale döndü.');
    }
    return;
  }

  if (!state.station.open) return;
  if (Math.random() >= RUSH_CHANCE_PER_SEC * dt) return;

  state.dayState.rushSecondsLeft = RUSH_SECONDS;
  playCue(effects, 'alert');
  notify(
    effects,
    'INFO',
    'Müşteri Yoğunluğu!',
    'Yola araç yığıldı — birkaç dakika boyunca çok daha fazla müşteri uğrayacak.',
    EVENT_TOAST_HOLD_MS
  );
}

/**
 * What the buildings on one block add up to.
 *
 * A facility's worth is spread over several unrelated parts of the tick — who
 * turns in, how long they will wait, what they think of the place, what they
 * buy on the way out — so it is totalled once, here, from the catalogue table
 * rather than rediscovered in each of them.
 *
 * Levels count: an upgraded building does its job better, at a quarter more
 * per level, which is what the player is buying when they upgrade in place.
 */
export function blockFacilities(
  state: GameState,
  side: DrivewaySide
): {
  appeal: number;
  patience: number;
  satisfaction: number;
  services: Array<{ name: string; chance: number; avgSpend: number }>;
} {
  let appeal = 0;
  let patience = 0;
  let satisfaction = 0;
  const services: Array<{ name: string; chance: number; avgSpend: number }> = [];

  // Canopies sit on pumps rather than in the buildings collection, so the
  // draw of a well-roofed forecourt is counted from the islands that carry
  // one. Weighted like a building in mint condition, since a roof has no
  // separate level or wear of its own.
  const canopyEffect = GAME_CONFIG.buildingEffects.canopy;
  if (canopyEffect) {
    for (const pump of Object.values(state.pumps)) {
      if (!pump.hasCanopy) continue;
      if (drivewaySideAt(pump.position[1]) !== side) continue;
      appeal += canopyEffect.appeal ?? 0;
      patience += canopyEffect.patience ?? 0;
      satisfaction += canopyEffect.satisfaction ?? 0;
    }
  }

  for (const building of Object.values(state.buildings)) {
    if (drivewaySideAt(building.position[1]) !== side) continue;

    const effect = GAME_CONFIG.buildingEffects[building.type];
    if (!effect) continue;

    const scale = 1 + 0.25 * (building.level - 1);
    // A run-down building is worth less than a cared-for one.
    const condition = 0.5 + 0.5 * (building.health / 100);
    const weight = scale * condition;

    appeal += (effect.appeal ?? 0) * weight;
    patience += (effect.patience ?? 0) * weight;
    // A toilet that charges for the door is a toilet people grumble about:
    // the price on the card decides how much of the goodwill survives.
    satisfaction += (effect.satisfaction ?? 0) * weight * facilityMoralFactor(building);

    // The buildings people walk into earn at their own door, into their own
    // till, one visitor at a time — not as a side sale rung up at the pump.
    if (effect.service && !isFacility(building.type)) {
      services.push({
        name: GAME_CONFIG.buildings[building.type]?.name ?? building.type,
        chance: effect.service.chance,
        avgSpend: effect.service.avgSpend * scale
      });
    }
  }

  return { appeal, patience, satisfaction, services };
}

/**
 * Charging points on a block that are wired up and free.
 *
 * A charger without a substation behind it is a bollard: the catalogue says so
 * and now the simulation agrees. Electric customers only appear once there is
 * somewhere on the block to plug them in, which is what makes the whole EV
 * line worth buying rather than four buildings that quietly do nothing.
 */
export function chargingPoints(
  state: GameState,
  side: DrivewaySide
): Array<{ id: string; kind: 'ac' | 'dc'; position: [number, number] }> {
  const onSide = Object.values(state.buildings).filter(
    (b) => drivewaySideAt(b.position[1]) === side
  );
  // A post needs the substation behind it and a bank to draw from.
  if (!onSide.some((b) => b.type === 'ev_substation')) return [];
  if (!onSide.some((b) => b.type === 'ev_storage')) return [];

  return onSide
    .filter((b) => b.type === 'ev_charger_ac' || b.type === 'ev_charger_dc')
    .map((b) => ({
      id: b.id,
      kind: b.type === 'ev_charger_dc' ? ('dc' as const) : ('ac' as const),
      position: b.position
    }));
}

/** What a battery bank of this level holds, in kWh. */
export function energyCapacity(building: Pick<BuildingEntity, 'level'>): number {
  const ladder = GAME_CONFIG.ev.storageKwhByLevel;
  return ladder[Math.min(ladder.length - 1, Math.max(0, building.level - 1))];
}

/** The battery banks on a block. */
function energyBanks(state: GameState, side: DrivewaySide): BuildingEntity[] {
  return Object.values(state.buildings).filter(
    (b) => b.type === 'ev_storage' && drivewaySideAt(b.position[1]) === side
  );
}

/** kWh in the banks on this block, all together. */
export function energyAvailable(state: GameState, side: DrivewaySide): number {
  return energyBanks(state, side).reduce((sum, b) => sum + (b.energyKwh ?? energyCapacity(b)), 0);
}

/** What the banks on this block hold at the brim, all together. */
export function energyCapacityOn(state: GameState, side: DrivewaySide): number {
  return energyBanks(state, side).reduce((sum, b) => sum + energyCapacity(b), 0);
}

/** Takes up to `kwh` out of the block's banks; returns what actually came out. */
export function drawEnergy(state: GameState, side: DrivewaySide, kwh: number): number {
  let left = kwh;
  for (const bank of energyBanks(state, side)) {
    if (left <= 0) break;
    const have = bank.energyKwh ?? energyCapacity(bank);
    const take = Math.min(have, left);
    bank.energyKwh = have - take;
    left -= take;
  }
  return kwh - left;
}

/** Puts up to `kwh` into the block's banks; returns what fitted. */
export function feedEnergy(state: GameState, side: DrivewaySide, kwh: number): number {
  let left = kwh;
  for (const bank of energyBanks(state, side)) {
    if (left <= 0) break;
    const capacity = energyCapacity(bank);
    const have = bank.energyKwh ?? capacity;
    const put = Math.min(Math.max(0, capacity - have), left);
    bank.energyKwh = have + put;
    left -= put;
  }
  return kwh - left;
}

/** The substation feeding this block — the biggest one, if there are several. */
export function substationOn(state: GameState, side: DrivewaySide): BuildingEntity | undefined {
  return Object.values(state.buildings)
    .filter((b) => b.type === 'ev_substation' && drivewaySideAt(b.position[1]) === side)
    .sort((a, b) => b.level - a.level)[0];
}

/** Cells under panels feeding this block's banks. */
export function solarCellsFeeding(state: GameState, side: DrivewaySide): number {
  return solarCellsOn(Object.values(state.pumps).filter((p) => drivewaySideAt(p.position[1]) === side));
}

/** What this block's panels are putting into the bank right now, kWh per game hour. */
export function solarKwhPerHourNow(state: GameState, side: DrivewaySide): number {
  // Roof by roof: each has its own glass, and its own grime on it.
  const hour = hourOfDay(state.dayState.gameTime);
  const cells = roofCells(GAME_CONFIG.buildings.canopy.size);
  let kwh = 0;
  for (const pump of Object.values(state.pumps)) {
    if (!pump.hasCanopy || !pump.hasSolarCanopy) continue;
    if (drivewaySideAt(pump.position[1]) !== side) continue;
    const factor = solarFactor(hour, state.dayState.weather, solarCleanlinessOf(pump));
    kwh += cells * GAME_CONFIG.ev.solar.peakKwhPerCell * factor;
  }
  return kwh;
}

/**
 * Dust on the glass, and rain taking it off again. A roof of panels dirties
 * on its own clock, apart from the forecourt's (Emre, 2026-09-08): the
 * concrete is swept, the glass is washed, and each is a job of its own.
 */
function tickSolarGrime(state: GameState, dt: number): void {
  const { grimePerSecond, rainWashPerSecond } = GAME_CONFIG.ev.solar;
  const rain = state.dayState.weather === 'RAIN' ? rainWashPerSecond : 0;
  for (const pump of Object.values(state.pumps)) {
    if (!pump.hasCanopy || !pump.hasSolarCanopy) continue;
    pump.solarCleanliness = clamp(solarCleanlinessOf(pump) + (rain - grimePerSecond) * dt, 0, 100);
  }
}

/**
 * Washes one roof of panels and pays for it. Shared by the office and the
 * manager's rounds. Returns what was paid, or null if the till could not.
 */
export function washSolarPanels(state: GameState, pump: PumpEntity, description: string): number | null {
  if (!pump.hasCanopy || !pump.hasSolarCanopy) return null;
  const cost = solarCleanCost(GAME_CONFIG.buildings.canopy.size);
  const tx = TransactionService.executeCashTransaction(state, { type: 'CLEAN', amount: -cost, description });
  if (!tx.success) return null;
  pump.solarCleanliness = 100;
  return cost;
}

/** Whether this generator is burning diesel right now. */
export function generatorRunning(state: GameState, building: BuildingEntity): boolean {
  if (building.type !== 'diesel_generator') return false;
  const side = drivewaySideAt(building.position[1]);
  return generatorWants(
    building,
    energyAvailable(state, side),
    energyCapacityOn(state, side),
    dieselForGenerator(state.tanks.diesel)
  );
}

/**
 * The block's energy, one tick of it: the roofs put in what the sun gives,
 * the generator burns diesel when the bank is low, and the grid fills the
 * rest through the substation at the hour's price. The grid is last so that
 * free and own-fuel kWh are never crowded out by bought ones. All of it is
 * billed as it flows, into the day's figures; the money leaves with the
 * other fixed costs at closing time, the way the wages do.
 */
function tickEnergy(state: GameState, dt: number): void {
  const hours = dt / GAME_CONFIG.economy.realSecondsPerGameHour;
  const hour = hourOfDay(state.dayState.gameTime);
  const stats = state.dayState.todayStats;
  const bill = (tl: number) => {
    stats.energyCost = (stats.energyCost ?? 0) + tl;
  };

  // A bank from before banks held anything comes full, like a new one.
  for (const bank of Object.values(state.buildings)) {
    if (bank.type === 'ev_storage' && bank.energyKwh === undefined) bank.energyKwh = energyCapacity(bank);
  }

  for (const side of ['near', 'far'] as DrivewaySide[]) {
    const capacity = energyCapacityOn(state, side);
    if (capacity <= 0) continue;

    // Roofs first: what the sun gives is free, and a full bank wastes it.
    const sun = solarKwhPerHourNow(state, side) * hours;
    if (sun > 0) stats.solarKwh = (stats.solarKwh ?? 0) + feedEnergy(state, side, sun);

    // Then the generator, from the diesel tank, at what that diesel cost.
    const gen = GAME_CONFIG.ev.generator;
    for (const unit of Object.values(state.buildings)) {
      if (unit.type !== 'diesel_generator' || drivewaySideAt(unit.position[1]) !== side) continue;
      if (!generatorRunning(state, unit)) continue;
      const tank = state.tanks.diesel;
      const kwh = Math.min(gen.kwhPerHour * hours, dieselForGenerator(tank) / gen.litersPerKwh);
      const stored = feedEnergy(state, side, kwh);
      if (stored <= 0) continue;
      const liters = stored * gen.litersPerKwh;
      tank.stock -= liters;
      stats.generatorLiters = (stats.generatorLiters ?? 0) + liters;
      stats.generatorKwh = (stats.generatorKwh ?? 0) + stored;
      bill(liters * tank.averageCost);
    }

    // The grid last, through the contract on the substation — and not at
    // all during an outage: that is what an outage is.
    const substation = substationOn(state, side);
    if (!substation) continue;
    if (getEventModifiers(state).pumpsDisabled) continue;
    if (dutyActive(state, 'nightGridFill') && !isNightTariff(hour)) {
      // The manager waits for the cheap window — unless the bank is about
      // to leave customers standing at a dead post.
      const share = (energyAvailable(state, side) / capacity) * 100;
      if (share >= GAME_CONFIG.ev.nightFillFloorPercent) continue;
    }
    const stored = feedEnergy(state, side, gridKwhPerHourFor(substation.level) * hours);
    if (stored > 0) bill(stored * gridPriceAt(hour));
  }
}

/**
 * Plugs a car in. Charging needs someone to start it — the attendant on the
 * post, or the player clicking the car — the same as a pump needs someone
 * to lift the nozzle (Emre, 2026-09-07).
 */
export function beginCharging(
  state: GameState,
  vehicle: VehicleEntity,
  actor: 'PLAYER' | 'EMPLOYEE'
): boolean {
  if (!vehicle.chargingBuildingId) return false;
  if (vehicle.state !== 'AT_PUMP' && vehicle.state !== 'REQUEST') return false;
  if (vehicle.state === 'AT_PUMP') setVehicleState(vehicle, 'REQUEST');
  setVehicleState(vehicle, 'FUELING');
  vehicle.assignedActor = actor;
  vehicle.waitingTimeSeconds = 0;
  vehicle.request.dispensedLiters = 0;
  return true;
}

/** Whether an attendant is on this charging post. */
export function chargerAttendant(state: GameState, chargerId: string): EmployeeEntity | null {
  return (
    Object.values(state.employees).find(
      (e) => e.role === 'PUMP_ATTENDANT' && e.assignedPumpId === chargerId
    ) ?? null
  );
}

/** A charging point on this block with nobody plugged into it. */
function findFreeCharger(
  state: GameState,
  side: DrivewaySide,
  driver?: VehicleEntity,
  block?: BlockLayout
): { id: string; kind: 'ac' | 'dc'; position: [number, number] } | null {
  const taken = new Set(
    Object.values(state.vehicles)
      .map((v) => v.chargingBuildingId)
      .filter(Boolean) as string[]
  );
  // Direğin fişi boşsa da alanı boş olmayabilir: şarjı biten araç direğin
  // önünden çıkana kadar orası doludur. Pompadaki kuralın aynısı (bkz.
  // bayStandsEmpty) — iki gövde bir duruş alanında durmaz.
  return (
    chargingPoints(state, side).find(
      (point) =>
        !taken.has(point.id) &&
        (!driver || !block || postBayStandsEmpty(state, block, point, driver))
    ) ?? null
  );
}

/** Bir şarj direğinin duruş alanında başka bir araç duruyor mu? */
function postBayStandsEmpty(
  state: GameState,
  block: BlockLayout,
  point: { id: string; position: [number, number] },
  driver: VehicleEntity
): boolean {
  const post = state.buildings[point.id];
  const [ox, oz] = pumpBayOffset({ rotation: post?.rotation, type: post?.type });
  const bay = clampBayToApron(block, [point.position[0] + ox, 0, point.position[1] + oz]);
  return !Object.values(state.vehicles).some(
    (other) =>
      other.id !== driver.id &&
      Math.hypot(other.worldPosition[0] - bay[0], other.worldPosition[2] - bay[2]) <
        BAY_CLEAR_RADIUS
  );
}

/**
 * Whether this block has a forecourt worth pulling into at all.
 *
 * Broken bays count. A driver coming off the road has no way of knowing a pump
 * has failed until they are stood at it, so they still turn in and still leave
 * disappointed — an out-of-order forecourt costs the station its name, which is
 * what makes repairs urgent rather than optional.
 */
function blockHasPumps(state: GameState, side: DrivewaySide): boolean {
  return Object.values(state.pumps).some((p) => pumpSide(p) === side);
}

/**
 * How long a driver spends at a bay working out that it is no good to them.
 * Long enough to read as pulling up and looking, short enough that a dead
 * forecourt is not clogged with cars waiting out a patience timer for nothing.
 */
const GIVE_UP_SECONDS = 0.5;

/**
 * Whether this station is in any position to serve this particular driver:
 * a bay that works, and something in the tank they came for.
 */
function cannotServe(state: GameState, vehicle: VehicleEntity): boolean {
  const side = vehicleSide(vehicle);
  if (GAME_CONFIG.customerTypes[vehicle.archetype]?.requiresCharger) {
    return chargingPoints(state, side).length === 0 || energyAvailable(state, side) < 1;
  }

  const tank = state.tanks[vehicle.fuelType];
  if (!tank || availableFuelLiters(tank) < 0.1) return true;
  return !blockHasWorkingPump(state, side);
}

/** Whether any bay on this block could actually serve someone right now. */
function blockHasWorkingPump(state: GameState, side: DrivewaySide): boolean {
  return Object.values(state.pumps).some(
    (p) => pumpSide(p) === side && p.state !== 'BROKEN' && p.state !== 'MAINTENANCE'
  );
}

/**
 * Why this customer could not be served, in words the player can act on.
 *
 * Losing custom is meant to sting, but it should never be a mystery: a station
 * that is dry, or whose only bay has failed, will bleed reputation until the
 * player notices, so the notification says which of the two it is rather than
 * repeating that somebody left.
 */
function serviceFailureReason(
  state: GameState,
  vehicle: VehicleEntity,
  fallback: string
): string {
  const side = vehicleSide(vehicle);
  const tank = state.tanks[vehicle.fuelType];
  const fuel = GAME_CONFIG.fuels[vehicle.fuelType]?.shortName ?? vehicle.fuelType;

  if (GAME_CONFIG.customerTypes[vehicle.archetype]?.requiresCharger) {
    if (energyAvailable(state, side) < 1) {
      return 'Batarya boş — elektrikli müşteri şarj alamadan ayrıldı.';
    }
    return fallback;
  }
  if (!blockHasWorkingPump(state, side)) {
    return 'Çalışır pompa yok — müşteri bekledi ve ayrıldı. Pompayı onarın.';
  }
  if (tank && availableFuelLiters(tank) < 0.1) {
    return `${fuel} deposu boş — müşteri yakıt alamadan ayrıldı.`;
  }
  return fallback;
}

/**
 * How worth stopping at a block is, before the player's own decisions are
 * weighed in. Fuel is the reason most drivers pull off a highway; a shop on
 * its own still pulls some in, and bare land pulls none.
 */
function blockAppeal(state: GameState, side: DrivewaySide): number {
  // What the player has built on this block is most of what makes a driver
  // choose it over the next station down the road.
  const facilities = 1 + blockFacilities(state, side).appeal;

  if (blockHasPumps(state, side)) return facilities;

  // No pumps: the buildings are the only reason to stop. Any one people can
  // walk into will do — a café on its own pulls drivers in as a shop does.
  const hasFacility = Object.values(state.buildings).some(
    (b) =>
      isFacility(b.type) &&
      drivewaySideAt(b.position[1]) === side &&
      (b.type !== 'mini_market' || state.market.active)
  );

  return hasFacility ? SHOP_ONLY_APPEAL * facilities : 0;
}

/**
 * The odds that a driver on this stretch turns in. Price is the lever the
 * player pulls most: charge above the region and the road keeps driving.
 */
export function stopChance(state: GameState, side: DrivewaySide = 'near'): number {
  // A shut station is one nobody pulls into. The road outside it carries on
  // exactly as before — closing the doors is not closing the highway.
  if (!state.station.open) return 0;

  const appeal = blockAppeal(state, side);
  if (appeal === 0) return 0;

  const price = blendedPriceAttractiveness(state);
  const reputation = calculateReputationTrafficMultiplier(state.player.reputation);
  const rush = isRushHour(state) ? RUSH_STOP_MULTIPLIER : 1;

  // The event modifier belongs to the road, not to the driver's decision —
  // a busier day brings more cars past, not more willing ones.
  return clamp(
    0.3 * appeal * price * reputation * rush * nightLighting(state, side),
    0,
    MAX_STOP_RATE
  );
}

/** The hours a forecourt is read by its own lights. */
export function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 6;
}

/**
 * How willing a driver is to pull into this block after dark. Level 2
 * promised "Aydınlatmalı Gece Trafiği" and nothing in the engine ever read
 * a light pole (Emre, 2026-09-08): a dark forecourt is passed by, and each
 * pole on the block wins back a share of the night until four of them light
 * it fully. By day the poles are only scenery.
 */
export function nightLighting(state: GameState, side: DrivewaySide): number {
  if (!isNightHour(hourOfDay(state.dayState.gameTime))) return 1;
  const poles = Object.values(state.buildings).filter(
    (b) => b.type === 'light_pole' && drivewaySideAt(b.position[1]) === side
  ).length;
  return Math.min(1, DARK_STOP_SHARE + poles * LIGHT_POLE_STOP_SHARE);
}

/** What a driver makes of an unlit forecourt at night, and what each pole adds. */
const DARK_STOP_SHARE = 0.6;
const LIGHT_POLE_STOP_SHARE = 0.1;

/**
 * Fuels the station can actually sell: stocked in the farm AND dispensable by
 * some pump. The farm carries all three from day one, so without the pump
 * half of the test, prices for fuels nobody can buy would sway traffic and
 * reputation years before they mean anything.
 */
export function fuelsOnSale(state: GameState): FuelType[] {
  return (Object.keys(state.tanks) as FuelType[]).filter(
    (f) =>
      state.tanks[f].capacity > 0 &&
      Object.values(state.pumps).some((p) => p.supportedFuels.includes(f))
  );
}

function pricedFuels(state: GameState): FuelType[] {
  return fuelsOnSale(state);
}

/**
 * Price appeal across everything on the board, not just petrol.
 *
 * Demand used to read the petrol price alone, so diesel and LPG prices moved
 * margins but never traffic — a station could gouge two of its three fuels
 * with no one the wiser. Each fuel weighs in equally for the stop decision;
 * which *driver* cares about which price is handled where the archetype is
 * picked.
 */
function blendedPriceAttractiveness(state: GameState): number {
  const fuels = pricedFuels(state);
  if (fuels.length === 0) {
    return calculatePriceAttractiveness(
      state.pricing.gasoline.playerPrice,
      state.pricing.gasoline.regionalAverage
    ).attractiveness;
  }

  return (
    fuels.reduce(
      (sum, f) =>
        sum +
        calculatePriceAttractiveness(
          state.pricing[f].playerPrice,
          state.pricing[f].regionalAverage
        ).attractiveness,
      0
    ) / fuels.length
  );
}

/** A fuel's price relative to the regional board, as a plain index. */
function fuelPriceIndex(state: GameState, fuel: FuelType): number {
  return state.pricing[fuel].playerPrice / Math.max(0.01, state.pricing[fuel].regionalAverage);
}

/**
 * The nudge a day of pricing gives the station's name: undercut the region
 * and word spreads, gouge it and word spreads faster. Averaged over the fuels
 * actually on sale. This was computed in the price formula from the start and
 * never applied anywhere.
 */
export function dailyPriceReputationDelta(state: GameState): number {
  const fuels = pricedFuels(state);
  if (fuels.length === 0) return 0;

  return (
    fuels.reduce(
      (sum, f) =>
        sum +
        calculatePriceAttractiveness(
          state.pricing[f].playerPrice,
          state.pricing[f].regionalAverage
        ).reputationDeltaPerDay,
      0
    ) / fuels.length
  );
}

/**
 * Which carriageway a driver is on. Both are equally busy — the road does not
 * care what the player has built — so this is a straight coin toss once the
 * second carriageway exists. Yolun varlığı yeter: karşıda beton yoksa bile
 * şerit akar, oradan yalnızca kimse duramaz.
 */
function pickSpawnSide(state: GameState): DrivewaySide {
  return state.station.roadLevel >= 2 && Math.random() < 0.5 ? 'far' : 'near';
}

/**
 * Puts one more car on the highway.
 *
 * How many drive past is the road's business: the hour and the weather, and
 * nothing the player owns. Whether any of them turns in is decided separately,
 * so a station with high prices — or no pumps at all, or its shutters down —
 * still sits beside a working road rather than an empty one.
 */
function trySpawnVehicle(state: GameState, dt: number, mods: EventModifiers): void {
  const vehicleCount = Object.keys(state.vehicles).length;
  if (vehicleCount >= MAX_ACTIVE_VEHICLES) return;

  const hourlyMult = calculateHourlyTrafficMultiplier(hourOfDay(state.dayState.gameTime));
  const weatherMult =
    state.dayState.weather === 'RAIN' ? 0.78 : state.dayState.weather === 'OVERCAST' ? 0.92 : 1;

  if (Math.random() >= ROAD_TRAFFIC_PER_SEC * hourlyMult * weatherMult * mods.traffic * dt) return;

  // Only offer archetypes whose fuel this station carries at all.
  //
  // Note what this deliberately does *not* check: whether there is any left in
  // the tank. A driver on the road cannot see that, so they pull in anyway,
  // wait, and leave unhappy — and the station's name suffers for it. Running
  // dry is meant to hurt; it is the pressure that keeps the player watching
  // their stock instead of letting the manager run the place unattended.
  // A fuel is on the menu when a pump can actually put it in a car. The tank
  // farm stocks all three from day one; without this gate, diesel drivers
  // would arrive years before the diesel-capable pump and bleed reputation
  // for it — the exact trap the farm was built to remove.
  const sellableFuels = fuelsOnSale(state);

  const side = pickSpawnSide(state);
  // Karşıda kurulu bir arsa yoksa araç yine de gelir — yalnız duramaz:
  // iskelet blok yolun geometrisini verir, aşağıdaki "bare" bayrağı da
  // durma ihtimalini kapatır (var olmayan önalana rota çizilmesin).
  const laidOut = blockLayout(state, side);
  const block = laidOut ?? (side === 'far' ? farRoadOnlyBlock(state) : null);
  if (!block) return;
  const bare = !laidOut;

  // An electric customer is only servable where there is somewhere to plug in.
  // Karşıda beton yoksa (bare) kimse duramaz, dolayısıyla fişe de takılamaz.
  const servable = bare
    ? []
    : servableArchetypes(state, side, mods);

  // A car cannot materialise where one already is. When the road is backed up
  // to the edge of the map, the next driver simply has not arrived yet.
  const spawnBlocked = Object.values(state.vehicles).some(
    (v) =>
      Math.abs(v.worldPosition[2] - block.roadLaneZ) < FOLLOW_CORRIDOR &&
      Math.abs(v.worldPosition[0] - block.roadStartX) < FOLLOW_DISTANCE * 1.5
  ) || state.fuelOrders.some(
    (order) =>
      !!order.truck &&
      Math.abs(order.truck.worldPosition[2] - block.roadLaneZ) < FOLLOW_CORRIDOR &&
      Math.abs(order.truck.worldPosition[0] - block.roadStartX) < FOLLOW_DISTANCE * 1.5
  );
  if (spawnBlocked) return;

  // Only a driver this station could actually serve is worth stopping — and
  // only one who could get in. A forecourt walled off by what the player has
  // built has no way through to the bays, and a driver reads that from the
  // road rather than pulling in and finding out.
  const wayIn = !bare && hasWayIn(state, block, side);
  const stops = wayIn && servable.length > 0 && Math.random() < stopChance(state, side);
  const archetypes = stops
    ? servable
    : (Object.keys(GAME_CONFIG.customerTypes) as VehicleArchetype[]);
  if (archetypes.length === 0) return;

  const facilities = blockFacilities(state, side);

  // Who stops is not a uniform draw over everyone on the road. A courier
  // watching every kuruş and a luxury driver who never looks at the board
  // react to the same price very differently, so the archetype is picked
  // weighted by how each one feels about what this station is charging.
  // Judged against the fuel that driver actually buys: cheap diesel pulls
  // lorries in without the petrol board having anything to do with it.
  const meanIndex =
    sellableFuels.length > 0
      ? sellableFuels.reduce((sum, f) => sum + fuelPriceIndex(state, f), 0) / sellableFuels.length
      : 1;
  const archetype = pickWeighted(archetypes, (a) => {
    const customer = GAME_CONFIG.customerTypes[a];
    const preferred = customer.preferredFuel;
    const index = customer.requiresCharger
      ? evPriceIndex(state, side)
      : preferred !== 'any' && sellableFuels.includes(preferred as FuelType)
        ? fuelPriceIndex(state, preferred as FuelType)
        : meanIndex;
    const presence = stops
      ? customer.stationStopWeight ?? 1
      : customer.roadTrafficWeight ?? 1;
    // An event can tilt who is out today: a VIP convoy is a road full of
    // luxury cars, on the carriageway and at the pumps alike.
    return archetypeAppetite(customer.priceSensitivity, index) * presence * (mods.archetypeWeights[a] ?? 1);
  });
  const conf = GAME_CONFIG.customerTypes[archetype];
  const fuelType: FuelType =
    conf.preferredFuel === 'any' || !sellableFuels.includes(conf.preferredFuel as FuelType)
      ? sellableFuels[Math.floor(Math.random() * sellableFuels.length)] ?? 'gasoline'
      : (conf.preferredFuel as FuelType);

  const demand = Math.round(conf.minDemand + Math.random() * (conf.maxDemand - conf.minDemand));
  const tankCapacity = Math.round(demand * (1.25 + Math.random() * 0.35));
  const id = 'veh_' + Math.random().toString(36).substring(2, 8);
  let idHash = 0;
  for (const char of id) idHash = (idHash * 31 + char.charCodeAt(0)) | 0;
  const modelVariants = conf.vehicleModels;
  const modelVariant = modelVariants[Math.abs(idHash) % modelVariants.length];

  // Whether this driver wants the tank filled or names a sum is read off the
  // same id hash, for the same reason: no extra random roll. A charger has no
  // sum to name — a battery is charged to full.
  const wantsFull =
    !!conf.requiresCharger || Math.abs(idHash) % 100 < FULL_TANK_SHARE * 100;

  state.vehicles[id] = {
    id,
    archetype,
    modelVariant,
    fuelType,
    tankCapacity,
    currentFuel: Math.max(0, tankCapacity - demand),
    request: driverRequest(demand, state.pricing[fuelType].playerPrice, wantsFull),
    // Somewhere to wait, a coffee, a toilet: a driver puts up with a queue
    // for longer at a station that gives them something to do.
    patience: conf.basePatienceSeconds * (1 + facilities.patience),
    maxPatience: conf.basePatienceSeconds * (1 + facilities.patience),
    satisfaction: 100,
    state: stops ? 'SPAWN' : 'PASSING',
    targetPumpId: null,
    assignedActor: null,
    worldPosition: [block.roadStartX, 0, block.roadLaneZ],
    targetWaypoint: null,
    route: [],
    // The far carriageway runs the other way, so its cars face the other way.
    heading: block.roadEndX > block.roadStartX ? Math.PI / 2 : -Math.PI / 2,
    speed: (0.85 + Math.random() * 0.3) * (conf.roadSpeedMultiplier ?? 1),
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };

  // Not everyone who turns in wants fuel. Some are here for the toilet, the
  // coffee or a bed for the night, and they head for the park rather than
  // the pumps — decided now, on the road, like everything else about them.
  // An electric driver came for the socket; the shop is an afterthought.
  if (stops && !conf.requiresCharger && Math.random() < facilityOnlyShare(state, side)) {
    state.vehicles[id].facilityIntent = true;
  }

  // Through traffic gets its whole route up front: down the carriageway and
  // off the map. It never touches the forecourt, so nothing else has to know
  // about it beyond driving it along.
  if (!stops) {
    setRoute(state.vehicles[id], [[block.roadEndX, 0, block.roadLaneZ]]);
  }
}

/**
 * How keen a driver of this temperament is on the price being asked, as a
 * weight rather than a yes or no. Below the regional average the thrifty ones
 * crowd in; above it they are the first to keep driving, while the drivers who
 * never look at the board barely notice.
 */
function archetypeAppetite(
  sensitivity: 'LOW' | 'MEDIUM' | 'HIGH',
  priceIndex: number
): number {
  const slope = sensitivity === 'HIGH' ? 3.2 : sensitivity === 'MEDIUM' ? 1.6 : 0.5;
  return clamp(1 - slope * (priceIndex - 1), 0.08, 2.5);
}

/**
 * The gap to a lorry body, counted only when it is genuinely ahead. Cars give
 * a lorry room in front of them and none behind: the backward tolerance cars
 * get from distanceAhead froze a car solid the moment a lorry's nose pulled
 * up to its bumper.
 */
function truckBodyAhead(
  vehicle: VehicleEntity,
  body: VehicleEntity,
  dir: { x: number; z: number }
): number | null {
  const ox = body.worldPosition[0] - vehicle.worldPosition[0];
  const oz = body.worldPosition[2] - vehicle.worldPosition[2];
  const ahead = ox * dir.x + oz * dir.z;
  if (ahead <= 0.3) return null;
  const lateral = Math.abs(ox * dir.z - oz * dir.x);
  return lateral < 1.4 ? Math.hypot(ox, oz) : null;
}

/** Picks one of a list, in proportion to a weight given to each. */
function pickWeighted<T>(items: T[], weightOf: (item: T) => number): T {
  const weights = items.map(weightOf);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];

  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Bir bay'de hâlâ gövdesiyle duran araç var mı?
 *
 * Emre, 2026-09-09: "iki araba üst üste kaldı". Pompa, müşteri servisi bitip
 * yola çıktığı anda serbest bırakılır; ayrılan aracın bay'den GERÇEKTEN
 * çıkması ise bir sonraki birkaç saniyeye yayılır ve kapalı bir düzende hiç
 * gerçekleşmeyebilir. Serbest kalan pompa hemen sıradakine verildiğinde yeni
 * müşteri, önalan içinde araçlar birbirine hayalet olduğu için duran aracın
 * tam üstüne yanaşıyordu. Boş olan pompa yetmez: bay'in kendisi de boş olmalı.
 */
const BAY_CLEAR_RADIUS = 1.5;

function bayStandsEmpty(
  state: GameState,
  block: BlockLayout,
  pump: PumpEntity,
  driver: VehicleEntity
): boolean {
  const bay = pumpBay(block, pump, driver);
  return !Object.values(state.vehicles).some(
    (other) =>
      other.id !== driver.id &&
      Math.hypot(other.worldPosition[0] - bay[0], other.worldPosition[2] - bay[2]) <
        BAY_CLEAR_RADIUS
  );
}

/**
 * Yoldan gelen bir sürücü bu bloğa GİREBİLİR mi: karayolundan giriş ağzına,
 * oradan da bekleme hattının başına sürülebilir bir yol var mı?
 *
 * Kararın kendisi eski; ayrı bir işleve alınmasının sebebi teşhis (bkz.
 * entryProblem): bu "hayır" derse tek bir müşteri bile sapmaz ve oyun bunu
 * oyuncuya söylemediği sürece istasyon sessizce ölür — Emre'nin 8. günde
 * yaşadığı tam olarak buydu (2026-09-09).
 */
export function hasWayIn(state: GameState, block: BlockLayout, side: DrivewaySide): boolean {
  // Pompasız bir blokta bekleme hattı yoktur: sürücü dükkân için gelir ve
  // ağızdan içeri girebilmesi yeter. Orada da "kuyruk başı" istemek, hattın
  // düştüğü yerdeki bir binayı girişi kapatıyor saymak olur.
  const targets: Array<[number, number, number]> = [
    [drivewayLaneX(block.entry, 0), 0, block.laneZ]
  ];
  if (blockHasPumps(state, side)) targets.push(queueSlotPosition(state, 0, side));

  return canReach(
    state,
    { worldPosition: [block.roadStartX, 0, block.roadLaneZ] } as VehicleEntity,
    side,
    targets,
    { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
    frontageKeepOut(block)
  );
}

/**
 * Bir bloğun araç almasını topyekûn kesen yollar. Her biri, oyunun bir aracı
 * gerçekten sürdüğü bir rotadır; kesildiğinde o araç hiç gelmez ve oyunda
 * bunu söyleyen hiçbir şey yoktur — istasyon "AÇIK" yazarken sessizce ölür.
 *
 *   CUSTOMERS    yoldan giriş ağzına ve bekleme hattının başına (spawn kararı)
 *   TANKER       yoldan tank sahasının berthine (dispatchTruck) — direk tank
 *                sahasının yanına dikilince tanker kapıda kaldı, "yolda
 *                gözükmüyor" (Emre, 2026-09-09)
 *   PUMP_BAYS    giriş şeridinden en az bir pompa bay'ine (findAvailablePump)
 *   CHARGER_BAYS giriş şeridinden en az bir şarj direğine (chargerRoute)
 */
export type BlockedWay = 'CUSTOMERS' | 'TANKER' | 'PUMP_BAYS' | 'CHARGER_BAYS' | 'PARK_BAYS';

/**
 * Bu blokta hangi yollar kesik. Yerleşim kuralı (aday yapı hayaletken önce
 * ve sonra sorar) ve giriş bekçisi (kayıtta bakar, oyuncuya söyler) aynı
 * listeyi okur; motorun sürdüğü rotalarla aynı işlevlerden hesaplandığından
 * uyarı ile gerçek ayrışamaz.
 */
export function blockedWays(state: GameState, side: DrivewaySide): BlockedWay[] {
  const block = blockLayout(state, side);
  if (!block) return [];
  const out: BlockedWay[] = [];

  if (blockAppeal(state, side) > 0 && !hasWayIn(state, block, side)) out.push('CUSTOMERS');

  // Satıştaki her yakıtın tankeri berthine ulaşabilmeli. Üç berth sahanın
  // önünde yan yana durur; pompası olmayan bir yakıtın berthi için yer
  // tutmak, kimsenin sipariş etmeyeceği bir tanker adına arsayı kilitlemek
  // olur. Henüz hiçbir yakıt satışta değilse başlangıç yakıtı ölçüttür.
  const farm = tankBuildingFor(state, 'gasoline');
  if (farm && drivewaySideAt(farm.position[1]) === side) {
    const sold = fuelsOnSale(state);
    const fuels: FuelType[] = sold.length > 0 ? sold : ['gasoline'];
    if (fuels.some((f) => tankerRoute(state, f) === null)) out.push('TANKER');
  }

  // Bir sürücünün ağızdan içeri girdiği yerden bakıldığında, yanaşılabilecek
  // en az bir bay: hepsi kapalıysa kuyruk hiç ilerlemez.
  const probe = probeCar(block);
  const pumps = Object.values(state.pumps).filter((p) => pumpSide(p) === side);
  if (pumps.length > 0 && !pumps.some((p) => pumpRoute(state, probe, p) !== null)) {
    out.push('PUMP_BAYS');
  }
  const posts = chargingPoints(state, side);
  if (posts.length > 0 && !posts.some((p) => chargerRoute(state, probe, p.position, p.id) !== null)) {
    out.push('CHARGER_BAYS');
  }

  // A car park nobody can drive into is the quietest failure on the plot: the
  // bays sit empty, the shop beside it takes nothing, and the reason is a
  // building standing across the approach where nothing marks it (Emre,
  // 2026-09-10). It is only worth saying when there is something to visit —
  // an empty park earns nothing whether or not cars can reach it.
  const parks = Object.values(state.buildings).filter(
    (b) => (b.type === 'car_park' || b.type === 'truck_park') && drivewaySideAt(b.position[1]) === side
  );
  const draws = facilitiesOn(state, side).length > 0;
  if (parks.length > 0 && draws && findParkingBay(state, probe, block) === null) {
    out.push('PARK_BAYS');
  }

  return out;
}

/** Sıradan bir binek: bay rotalarını sormak için giriş şeridinde duran hayalet. */
function probeCar(block: BlockLayout): VehicleEntity {
  return {
    id: '__probe',
    archetype: 'commuter',
    modelVariant: 'sedan',
    worldPosition: [drivewayLaneX(block.entry, 0), 0, block.laneZ],
    targetWaypoint: null,
    route: [],
    heading: 0,
    speed: 1
  } as unknown as VehicleEntity;
}

/** Ne kadar sık bakılır (oyun saati). */
const WAY_CHECK_HOURS = 0.25;

const WAY_WARNINGS: Record<BlockedWay, string> = {
  CUSTOMERS:
    'Müşteri giremiyor: yoldan bekleme hattına sürülebilir yol kalmadı — fiyat ne olursa olsun ' +
    'tek bir araç sapmaz.',
  TANKER: 'Tanker giremiyor: tank sahasına giden yol kalmadı — tanker kapıda bekler, yakıt gelmez.',
  PUMP_BAYS: 'Hiçbir pompaya araç yanaşamıyor: bay’lere giden yol kapalı.',
  CHARGER_BAYS: 'Hiçbir şarj direğine araç yanaşamıyor: direklere giden yol kapalı.',
  PARK_BAYS:
    'Otoparka ulaşılamıyor: hiçbir araç park yerine giremiyor, tesislerine yoldan müşteri gelmiyor.'
};

const WAY_REMEDY =
  'Giriş ile hedef arasındaki bir yapıyı (aydınlatma direği, çalı, çöp kutusu, tabela) ' +
  'taşıyın ya da satın.';

/**
 * İstasyon sessizce ölmesin: bir yol topyekûn kapandığında oyuncu günde bir
 * kez uyarılır, açıldığında da haber verilir. Emre, 2026-09-09: 8. günde iki
 * gün boyunca tek araç girmedi ve oyunda bunu söyleyen hiçbir şey yoktu —
 * pompa "Boşta" yazıyor, tabela "AÇIK" yanıyor, herkes geçip gidiyordu.
 * Oyuncunun bilerek kapattığı istasyon için susar.
 */
function tickWayWatch(state: GameState, effects: SimEffects): void {
  const hour = state.dayState.gameTime;
  const last = state.dayState.entryCheckedAtHour;
  if (last !== undefined && hour - last < WAY_CHECK_HOURS && hour >= last) return;
  state.dayState.entryCheckedAtHour = hour;

  const lines: string[] = [];
  if (state.station.open) {
    for (const side of ['near', 'far'] as DrivewaySide[]) {
      for (const way of blockedWays(state, side)) lines.push(WAY_WARNINGS[way]);
    }
    if (nothingOnSale(state)) {
      lines.push(
        'Satışta yakıt yok: pompaların verebildiği hiçbir yakıtın tankı yok, sürücülerin ' +
          'duracak sebebi kalmıyor.'
      );
    }
  }

  if (lines.length === 0) {
    if (state.dayState.entryWarnedDay !== undefined) {
      state.dayState.entryWarnedDay = undefined;
      notify(effects, 'INFO', 'Yol Açıldı', 'Kapalı yol yeniden açık — araçlar gelmeye başlıyor.');
    }
    return;
  }

  if (state.dayState.entryWarnedDay === state.dayState.currentDay) return;
  state.dayState.entryWarnedDay = state.dayState.currentDay;
  // Sıradan dört saniyelik hap değil: okunması gereken bir açıklama.
  notify(
    effects,
    'WARNING',
    'Yol Kapalı',
    [...new Set(lines), WAY_REMEDY].join(' '),
    EVENT_TOAST_HOLD_MS
  );
}

/** Pompaların verebildiği hiçbir yakıtın tankı yok — kimsenin duracak sebebi yok. */
function nothingOnSale(state: GameState): boolean {
  if (blockAppeal(state, 'near') === 0 && blockAppeal(state, 'far') === 0) return false;
  return servableArchetypes(state, 'near', getEventModifiers(state)).length === 0;
}

/** Bu blokta durmaya değer bulacak müşteri tipleri. */
function servableArchetypes(
  state: GameState,
  side: DrivewaySide,
  mods: EventModifiers
): VehicleArchetype[] {
  const sellable = fuelsOnSale(state);
  const anyPumps = Object.keys(state.pumps).length > 0;
  const canCharge = !mods.pumpsDisabled && chargingPoints(state, side).length > 0;

  return (Object.keys(GAME_CONFIG.customerTypes) as VehicleArchetype[]).filter((a) => {
    const conf = GAME_CONFIG.customerTypes[a];
    if (conf.requiresCharger) return canCharge;
    // No pumps anywhere: whoever stops here stops for the shop, and what the
    // pumps cannot dispense is no bar to a coffee.
    if (!anyPumps) return true;
    return conf.preferredFuel === 'any' || sellable.includes(conf.preferredFuel as FuelType);
  });
}

/** Finds a free pump that can serve this vehicle's fuel type. */
function findAvailablePump(
  state: GameState,
  fuelType: FuelType,
  mods: EventModifiers,
  side: DrivewaySide = 'near',
  driver?: VehicleEntity,
  block?: BlockLayout
): PumpEntity | null {
  if (mods.pumpsDisabled) return null;

  // A driver will not cross the highway to reach a pump: each block is served
  // by its own carriageway and has to stand on its own forecourt.
  const candidates = Object.values(state.pumps).filter(
    (p) =>
      p.state === 'IDLE' &&
      !p.currentVehicleId &&
      p.supportedFuels.includes(fuelType) &&
      pumpSide(p) === side
  );
  if (candidates.length === 0) return null;

  // Prefer the healthiest pump so worn hardware naturally rotates out of service.
  const ordered = candidates.sort((a, b) => b.health - a.health);
  if (!driver) return ordered[0];

  // A bay with something built across the way to it is not an available bay.
  // Left in the list it would be claimed and then driven to through a wall.
  // Nor is one that still has the last customer standing in it.
  return (
    ordered.find(
      (pump) =>
        (!block || bayStandsEmpty(state, block, pump, driver)) &&
        pumpRoute(state, driver, pump) !== null
    ) ?? null
  );
}

/**
 * Bir bay noktasını betona sığdırır — SÜRÜŞ marjıyla, park marjıyla değil.
 * Park marjı (2.5) kenara yakın bir direğin bay'ini direğin dibine çekiyordu:
 * araç yanaşırken gövdesi direğe giriyor, katı kural her adımı geri alıyor ve
 * müşteri şarjın yarım metre önünde sonsuza dek asılı kalıyordu.
 */
function clampBayToApron(
  block: BlockLayout,
  point: [number, number, number]
): [number, number, number] {
  const m = LANE_HALF_WIDTH;
  return [
    clamp(point[0], block.minX + m, Math.max(block.minX + m, block.maxX - m)),
    point[1],
    clamp(point[2], block.minZ + m, Math.max(block.minZ + m, block.maxZ - m))
  ];
}

/** The spot alongside an island where a car actually stands to be served. */
function pumpBay(
  block: BlockLayout,
  pump: PumpEntity,
  vehicle: Pick<VehicleEntity, 'archetype' | 'modelVariant'>
): [number, number, number] {
  const [dx, dz] = pumpBayOffset(pump);
  // PUMP_BAY_OFFSET was measured for a regular car. A monster truck is much
  // wider, so using the same centre point puts its inner tyre into the pump
  // island and the solid-body guard correctly refuses every final step. Move
  // only the oversized body further out; ordinary cars keep their exact pose.
  const extra = Math.max(0, vehicleBodyHalfExtents(vehicle).width - 0.43);
  const length = Math.max(0.001, Math.hypot(dx, dz));
  return clampBayToApron(block, [
    pump.position[0] + dx + (dx / length) * extra,
    0,
    pump.position[1] + dz + (dz / length) * extra
  ]);
}

function reservePumpFor(
  state: GameState,
  vehicle: VehicleEntity,
  pump: PumpEntity
): boolean {
  const route = pumpRoute(state, vehicle, pump);
  if (!route) return false;

  pump.currentVehicleId = vehicle.id;
  setPumpState(pump, 'RESERVED');
  vehicle.targetPumpId = pump.id;
  setRoute(vehicle, route);
  setVehicleState(vehicle, 'PUMP_RESERVED');
  setPumpState(pump, 'VEHICLE_ARRIVING');
  return true;
}

/**
 * A driver who found nowhere to go and carried on.
 *
 * This is not the same thing as failing a customer, and counting it as one
 * made a busy road into a punishment: the more traffic went past a full
 * forecourt, the further reputation fell, however well the station was run.
 * It belongs in its own column, where it reads as what it is — a sign to
 * build another pump.
 */
function turnAway(state: GameState): void {
  state.dayState.todayStats.customersTurnedAway =
    (state.dayState.todayStats.customersTurnedAway ?? 0) + 1;
}

/**
 * A layout penalty cannot be fair before the player has had a reasonable
 * chance to rebuild the forecourt. The first five levels are protected;
 * from level six onward an avoidable no-room departure is a lost customer.
 */
function turnAwayForNoManeuver(
  state: GameState,
  vehicle: VehicleEntity,
  effects: SimEffects
): void {
  const reputationPenalty = state.player.level > 5;
  if (reputationPenalty) {
    state.player.reputation = clamp(state.player.reputation - 0.015, 1, 5);
    state.dayState.todayStats.customersLost++;
    state.player.statistics.totalCustomersLost++;
  }
  notifyNoManeuverRoom(vehicle, effects, reputationPenalty);
  sendAway(state, vehicle);
  turnAway(state);
}

/**
 * A prospective customer that sees the closed sign before leaving the
 * carriageway simply carries on with the traffic. Giving it an EXIT route
 * would assume it was already on the apron; from the road that route cuts
 * across the field to reach the station's exit mouth.
 */
function continuePastStation(state: GameState, vehicle: VehicleEntity): void {
  const block = blockFor(state, vehicle);
  setVehicleState(vehicle, 'PASSING');
  setRoute(vehicle, [[block.roadEndX, 0, block.roadLaneZ]]);
}

/** True while an arrival has not yet turned off its carriageway. */
function arrivalStillOnRoad(state: GameState, vehicle: VehicleEntity): boolean {
  const block = blockFor(state, vehicle);
  return Math.abs(vehicle.worldPosition[2] - block.roadLaneZ) < 1;
}

function loseCustomer(
  state: GameState,
  vehicle: VehicleEntity,
  reason: string,
  effects: SimEffects
): void {
  state.player.reputation = clamp(state.player.reputation - 0.015, 1, 5);
  state.dayState.todayStats.customersLost++;
  state.player.statistics.totalCustomersLost++;

  if (vehicle.targetPumpId && state.pumps[vehicle.targetPumpId]) {
    releasePump(state.pumps[vehicle.targetPumpId]);
    vehicle.targetPumpId = null;
  }

  // Only what was actually held against the tank goes back. A reservation
  // exists once fueling has begun and not before — a queued car's intended
  // litres, or an electric customer's kWh, were never held, and releasing
  // them would eat some other customer's live hold and oversell the tank.
  const reserved = vehicle.request.reservedLiters ?? 0;
  if (reserved > vehicle.request.dispensedLiters) {
    TransactionService.releaseFuelReservation(
      state,
      vehicle.fuelType,
      reserved - vehicle.request.dispensedLiters
    );
  }
  vehicle.request.reservedLiters = 0;

  vehicle.chargingBuildingId = null;
  vehicle.chargeSecondsLeft = 0;
  vehicle.visitBuildingId = null;
  vehicle.visitMode = null;
  vehicle.visitor = undefined;
  vehicle.assignedActor = null;
  sendAway(state, vehicle);

  notify(effects, 'WARNING', 'Müşteri Kaybedildi!', `${reason} (-0.015 İtibar)`);
}

/**
 * Turns everybody out and sends them to the exit.
 *
 * Closing is meant to stop the station, not to leave it half-running: a driver
 * mid-fill, one at the till and one browsing the shop would otherwise carry on
 * as though nothing had happened, and the bays they hold would stay held. So
 * every car that is on the forecourt drops what it is doing and drives out,
 * and everything it was holding — a pump, an attendant, a fuel reservation —
 * is given back.
 *
 * Fuel already in a tank is not clawed back: it left the pump, and nobody is
 * going to pay for it now. That is the cost of shutting the doors mid-serve,
 * and it is reported rather than quietly absorbed.
 */
export function closeForecourt(state: GameState): { left: number; unpaidLiters: number } {
  let left = 0;
  let unpaidLiters = 0;

  for (const vehicle of Object.values(state.vehicles)) {
    // SPAWN and a ROAD_APPROACH still on the carriageway have chosen the
    // station but have not entered it. They see KAPALI and drive past. This
    // decision is final for that trip: reopening immediately does not turn
    // them back in or give them a route through the field.
    if (
      vehicle.state === 'SPAWN' ||
      (vehicle.state === 'ROAD_APPROACH' && arrivalStillOnRoad(state, vehicle))
    ) {
      continuePastStation(state, vehicle);
      turnAway(state);
      continue;
    }
    if (!isOnForecourt(vehicle)) continue;
    unpaidLiters += dismissVehicle(state, vehicle);
    left++;
  }

  return { left, unpaidLiters: Number(unpaidLiters.toFixed(1)) };
}

/**
 * Traffic on the road is none of the station's business, and anyone already on
 * their way out needs no second telling.
 */
function isOnForecourt(vehicle: VehicleEntity): boolean {
  return (
    vehicle.state !== 'SPAWN' &&
    vehicle.state !== 'PASSING' &&
    vehicle.state !== 'EXIT' &&
    vehicle.state !== 'DESPAWN'
  );
}

/**
 * Sends one car away mid-service, giving back everything it was holding.
 * Returns the litres that went into it and will never be paid for.
 */
export function dismissVehicle(state: GameState, vehicle: VehicleEntity): number {
  const reserved = vehicle.request.reservedLiters ?? 0;
  const dispensed = vehicle.request.dispensedLiters;
  let unpaid = 0;

  if (reserved > 0) {
    // Whatever went into the car leaves the tank unpaid; the rest of the
    // reservation goes back on the shelf.
    if (dispensed > 0) {
      TransactionService.dispenseFuel(state, vehicle.fuelType, dispensed);
      vehicle.currentFuel = Math.min(vehicle.tankCapacity, vehicle.currentFuel + dispensed);
      unpaid = dispensed;
    }
    TransactionService.releaseFuelReservation(
      state,
      vehicle.fuelType,
      Math.max(0, reserved - dispensed)
    );
    vehicle.request.reservedLiters = 0;
    vehicle.request.calculatedLiters = 0;
    vehicle.request.dispensedLiters = 0;
  }

  if (vehicle.targetPumpId && state.pumps[vehicle.targetPumpId]) {
    releasePump(state.pumps[vehicle.targetPumpId]);
  }
  vehicle.targetPumpId = null;

  for (const employee of Object.values(state.employees)) {
    if (employee.currentVehicleId === vehicle.id) employee.currentVehicleId = null;
  }

  vehicle.assignedActor = null;
  vehicle.shoppingIntent = false;
  // A driver inside a shop when the doors close is simply back in the car.
  vehicle.visitor = undefined;
  vehicle.visitBuildingId = null;
  vehicle.visitMode = null;
  sendAway(state, vehicle);

  return unpaid;
}

/**
 * Clears a bay before it is picked up or sold.
 *
 * A pump can be carried off while a car is at it, and the car has no way of
 * knowing: it would sit waiting on a dispenser that no longer exists, holding
 * a fuel reservation nobody will ever release. So whoever was using it, or on
 * their way to it, is sent on their way first.
 */
export function evictFromPump(
  state: GameState,
  pumpId: string
): { unpaidLiters: number; evicted: number } {
  let unpaidLiters = 0;
  let evicted = 0;

  for (const vehicle of Object.values(state.vehicles)) {
    if (vehicle.targetPumpId !== pumpId || !isOnForecourt(vehicle)) continue;
    unpaidLiters += dismissVehicle(state, vehicle);
    evicted++;

    // Selling or carting off the pump somebody was using is the player's own
    // way of losing a customer, and it costs what losing one always costs.
    state.player.reputation = clamp(state.player.reputation - 0.015, 1, 5);
    state.dayState.todayStats.customersLost++;
    state.player.statistics.totalCustomersLost++;
  }

  return { unpaidLiters: Number(unpaidLiters.toFixed(1)), evicted };
}

/**
 * Lets go of anything that is holding a reference to a vehicle that no longer
 * exists.
 *
 * A pump left pointing at a departed customer is a pump that never serves
 * anyone again, and the station quietly loses a bay for the rest of the save.
 * Every path that removes a vehicle is supposed to release what it was using
 * first; this is the backstop for the one that forgets, because the failure is
 * invisible until the player wonders why a pump stopped working.
 */
function releaseOrphanedHolds(state: GameState): void {
  for (const pump of Object.values(state.pumps)) {
    if (pump.currentVehicleId && !state.vehicles[pump.currentVehicleId]) {
      releasePump(pump);
    }
  }

  for (const employee of Object.values(state.employees)) {
    // Saves from before the preparation timer was introduced have no value
    // here. `undefined - dt` becomes NaN and can never reach zero, leaving the
    // employee in PREPARE forever while the EMPLOYEE claim blocks the player.
    if (!Number.isFinite(employee.actionTimerSeconds)) employee.actionTimerSeconds = 0;
    if (employee.currentVehicleId && !state.vehicles[employee.currentVehicleId]) {
      resetAttendantJob(employee);
    }
    if (
      employee.assignedPumpId &&
      !state.pumps[employee.assignedPumpId] &&
      !state.buildings[employee.assignedPumpId]
    ) {
      employee.assignedPumpId = null;
    }
  }

  // Repair half-written or old-save employee claims. Without this, a car can
  // remain marked EMPLOYEE after its worker moved, vanished, or got stuck in
  // the wrong state; staff then ignore it and the player is locked out too.
  for (const employee of Object.values(state.employees)) {
    if (!employee.currentVehicleId) continue;
    const vehicle = state.vehicles[employee.currentVehicleId];
    const servicePointId = vehicle?.chargingBuildingId ?? vehicle?.targetPumpId ?? null;
    const stageMatches =
      !!vehicle &&
      ((employee.state === 'PREPARE' && vehicle.state === 'AT_PUMP') ||
        (employee.state === 'FUELING' && vehicle.state === 'FUELING') ||
        (employee.state === 'PAYMENT' && vehicle.state === 'PAYMENT'));
    if (
      !vehicle ||
      vehicle.assignedActor !== 'EMPLOYEE' ||
      employee.assignedPumpId !== servicePointId ||
      !stageMatches
    ) {
      resetAttendantJob(employee);
    }
  }

  for (const vehicle of Object.values(state.vehicles)) {
    if (vehicle.assignedActor !== 'EMPLOYEE') continue;
    const servicePointId = vehicle.chargingBuildingId ?? vehicle.targetPumpId ?? null;
    const hasOwner = Object.values(state.employees).some((employee) => {
      if (
        employee.role !== 'PUMP_ATTENDANT' ||
        employee.currentVehicleId !== vehicle.id ||
        employee.assignedPumpId !== servicePointId
      ) return false;
      return (
        (employee.state === 'PREPARE' && vehicle.state === 'AT_PUMP') ||
        (employee.state === 'FUELING' && vehicle.state === 'FUELING') ||
        (employee.state === 'PAYMENT' && vehicle.state === 'PAYMENT')
      );
    });
    if (!hasOwner) {
      vehicle.assignedActor =
        vehicle.state === 'FUELING' || vehicle.state === 'PAYMENT' ? 'PLAYER' : null;
    }
  }
}

/**
 * The mirror of releaseOrphanedHolds: a vehicle standing in a pump state
 * whose pump now belongs to somebody else. Nothing in those states asks
 * whether the pump is still yours, so such a car stood at the bay for ever
 * while the next customer was served through it (Emre, 2026-09-07: a lorry
 * that neither fuelled nor left). It gives back what it holds — never the
 * pump, which is not its to give — and goes. A driver holding no pump at all
 * is the walk-up to a dead bay, which has its own rule and its own cost.
 */
const PUMP_STATES: VehicleState[] = ['AT_PUMP', 'REQUEST', 'FUELING', 'PAYMENT'];

function dismissOrphanedAtPump(state: GameState): void {
  for (const vehicle of Object.values(state.vehicles)) {
    if (!PUMP_STATES.includes(vehicle.state) || !vehicle.targetPumpId) continue;
    if (vehicle.chargingBuildingId) continue;
    const pump = state.pumps[vehicle.targetPumpId];
    if (pump && pump.currentVehicleId && pump.currentVehicleId !== vehicle.id) {
      vehicle.targetPumpId = null;
      dismissVehicle(state, vehicle);
    }
  }
}

function tickVehicles(
  state: GameState,
  dt: number,
  effects: SimEffects,
  mods: EventModifiers
): void {
  releaseOrphanedHolds(state);
  dismissOrphanedAtPump(state);
  const vehicles = Object.values(state.vehicles);

  // Queue order is stable by arrival so slots do not shuffle between ticks,
  // and each block queues on its own concrete rather than sharing a line.
  const queues: Record<DrivewaySide, VehicleEntity[]> = { near: [], far: [] };
  // Electric customers wait in their own line, behind a post.
  const chargeQueues: Record<DrivewaySide, VehicleEntity[]> = { near: [], far: [] };
  for (const v of vehicles) {
    if (v.state !== 'QUEUE') continue;
    const electric = !!GAME_CONFIG.customerTypes[v.archetype]?.requiresCharger;
    (electric ? chargeQueues : queues)[vehicleSide(v)].push(v);
  }
  for (const side of ['near', 'far'] as const) {
    queues[side].sort((a, b) => b.waitingTimeSeconds - a.waitingTimeSeconds);
    chargeQueues[side].sort((a, b) => b.waitingTimeSeconds - a.waitingTimeSeconds);
  }

  for (const vehicle of vehicles) {
    const side = vehicleSide(vehicle);
    const queued = queues[side];
    const chargeQueued = chargeQueues[side];
    const block = blockFor(state, vehicle);

    switch (vehicle.state) {
      case 'SPAWN': {
        // Normally toggleStationOpen has already converted this car in
        // closeForecourt. Keep the simulation rule here too for direct state
        // changes and old saves paused on exactly this tick.
        if (!state.station.open) {
          continuePastStation(state, vehicle);
          turnAway(state);
          break;
        }

        const approach = approachRoute(state, vehicle);
        if (!approach) {
          setVehicleState(vehicle, 'PASSING');
          setRoute(vehicle, [[block.roadEndX, 0, block.roadLaneZ]]);
          turnAway(state);
          break;
        }

        setVehicleState(vehicle, 'ROAD_APPROACH');
        setRoute(vehicle, approach);
        break;
      }

      case 'PASSING': {
        if (driveInTraffic(state, vehicle, block, dt)) {
          setVehicleState(vehicle, 'DESPAWN');
          break;
        }
        // Katı yapılarla bir turn-away rotası duvara dayanabilir; duvarın
        // dibinde sonsuza dek titreyen bir hayalet bırakmak yerine, uzun
        // süredir kımıldayamayan araç sessizce sahneden alınır.
        if (isWedged(vehicle) || (vehicle.solidStuckSeconds ?? 0) > 20) {
          setVehicleState(vehicle, 'DESPAWN');
        }
        break;
      }

      case 'ROAD_APPROACH': {
        // Decide while still out on the road, not once the car is committed to
        // the mouth. A driver who turns in and only then finds the forecourt
        // full blocks the entrance, and everything behind them stacks up on
        // the carriageway waiting for a gap that cannot open.
        const stillOnRoad = Math.abs(vehicle.worldPosition[2] - block.roadLaneZ) < 1;
        if (!state.station.open && stillOnRoad) {
          continuePastStation(state, vehicle);
          turnAway(state);
          break;
        }

        const electric = !!GAME_CONFIG.customerTypes[vehicle.archetype]?.requiresCharger;
        const chargeLine = electric ? chargeQueueLine(state, block, side) : null;
        if (
          stillOnRoad &&
          !vehicle.facilityIntent &&
          (electric
            ? !findFreeCharger(state, side) && chargeQueued.length >= (chargeLine?.slots.length ?? 0)
            : !findAvailablePump(state, vehicle.fuelType, mods, side) &&
              queued.length >= maxQueueLength(state, block))
        ) {
          setVehicleState(vehicle, 'PASSING');
          setRoute(vehicle, [[block.roadEndX, 0, block.roadLaneZ]]);
          turnAway(state);
          break;
        }

        const arrived = driveInTraffic(state, vehicle, block, dt);
        if (isWedged(vehicle) && stillOnRoad) {
          // Still on the carriageway, so nothing to release — carry on down
          // the road rather than standing in the entrance blocking it. Once
          // a car has crossed the kerb it must finish the visit it committed
          // to; converting it to PASSING there draws a road-bound diagonal
          // across the forecourt and looks like it entered only to leave.
          setVehicleState(vehicle, 'PASSING');
          setRoute(vehicle, [[block.roadEndX, 0, block.roadLaneZ]]);
          turnAway(state);
          break;
        }
        if (!arrived) break;

        // Do not judge every arrival against the generic head-of-queue point.
        // A harmless building at the tail of that line can make this one
        // probe fail even while the customer's actual pump, charger or queue
        // route is body-clear. Each concrete destination below performs its
        // own reachability check and reports a real manoeuvre failure there.

        // Here for the toilet, the café or a bed, not for fuel: straight to
        // the park, or a visit booked from where they stand if there is none.
        // A driver who finds nothing they want after all simply drives on.
        if (vehicle.facilityIntent) {
          startFacilityVisit(state, vehicle, effects);
          break;
        }

        // An electric customer wants a socket, not a nozzle.
        if (GAME_CONFIG.customerTypes[vehicle.archetype]?.requiresCharger) {
          const point = findFreeCharger(state, side, vehicle, block);
          const toCharger = point ? chargerRoute(state, vehicle, point.position, point.id) : null;
          const toQueue =
            chargeLine && chargeQueued.length < chargeLine.slots.length
              ? chargeJoinRoute(state, vehicle, block, chargeLine, chargeQueued.length)
              : null;

          if (point && toCharger) {
            vehicle.chargingBuildingId = point.id;
            vehicle.chargeSecondsLeft =
              point.kind === 'dc'
                ? GAME_CONFIG.ev.dcChargeSeconds
                : GAME_CONFIG.ev.acChargeSeconds;
            setVehicleState(vehicle, 'PUMP_RESERVED');
            setRoute(vehicle, toCharger);
          } else if (toQueue) {
            setVehicleState(vehicle, 'QUEUE');
            setRoute(vehicle, toQueue);
            chargeQueued.push(vehicle);
          } else {
            const hadRoomButNoRoute =
              (!!point && !toCharger) ||
              (!!chargeLine && chargeQueued.length < chargeLine.slots.length && !toQueue);
            if (hadRoomButNoRoute) {
              turnAwayForNoManeuver(state, vehicle, effects);
            } else {
              sendAway(state, vehicle);
              turnAway(state);
            }
          }
          break;
        }

        const pump = findAvailablePump(state, vehicle.fuelType, mods, side, vehicle, block);
        const deadForecourt = !pump && blockHasPumps(state, side) && cannotServe(state, vehicle);

        if (pump && reservePumpFor(state, vehicle, pump)) {
          // Reserved and on its way.
        } else if (deadForecourt) {
          // Nothing here works, but the driver has no way of knowing that from
          // the road. They pull up to a bay, see it, and go — rather than
          // joining a queue for fuel that is never coming.
          const walkUp = Object.values(state.pumps)
            .filter((p) => pumpSide(p) === side)
            .map((p) => ({ p, route: pumpRoute(state, vehicle, p) }))
            .find((candidate) => candidate.route !== null);

          if (!walkUp) {
            sendAway(state, vehicle);
            turnAway(state);
            break;
          }
          setVehicleState(vehicle, 'PUMP_RESERVED');
          setRoute(vehicle, walkUp.route!);
        } else if (!blockHasPumps(state, side)) {
          // Nothing here to fuel with, so this driver came for the shop.
          // Queueing for a pump that does not exist would only strand them.
          vehicle.facilityIntent = true;
          startFacilityVisit(state, vehicle, effects);
        } else {
          const hasQueueRoom = queued.length < maxQueueLength(state, block);
          const joining = hasQueueRoom
            ? queueJoinRoute(state, vehicle, block, queued.length, side, queued)
            : null;

          if (joining) {
            setVehicleState(vehicle, 'QUEUE');
            setRoute(vehicle, joining);
            queued.push(vehicle);
          } else {
            // Forecourt is full, or walled off — this driver never even stops.
            if (hasQueueRoom) {
              turnAwayForNoManeuver(state, vehicle, effects);
            } else {
              sendAway(state, vehicle);
              turnAway(state);
            }
          }
        }
        break;
      }

      case 'QUEUE': {
        driveInTraffic(state, vehicle, block, dt);
        vehicle.waitingTimeSeconds += dt;
        vehicle.patience -= dt;

        // The service this queue is for can be sold out from under it. The
        // driver can see the hardware being carted off — they leave then, not
        // when their patience runs out, and it costs the station its name the
        // same as any other lost customer: the player withdrew the service
        // while people were waiting on it.
        const wantsCharge = GAME_CONFIG.customerTypes[vehicle.archetype]?.requiresCharger;
        if (wantsCharge && chargingPoints(state, side).length === 0) {
          loseCustomer(
            state,
            vehicle,
            'Şarj ünitesi kaldırıldı — elektrikli müşteri hizmet alamadan ayrıldı.',
            effects
          );
          break;
        }
        if (!wantsCharge && !blockHasPumps(state, side)) {
          loseCustomer(
            state,
            vehicle,
            'Pompa kaldırıldı — kuyruktaki müşteri yakıt alamadan ayrıldı.',
            effects
          );
          break;
        }

        if (vehicle.patience <= 0) {
          loseCustomer(
            state,
            vehicle,
            serviceFailureReason(state, vehicle, 'Kuyrukta bekleyen müşteri sabrını yitirdi.'),
            effects
          );
          break;
        }

        // An electric customer's place is in the line behind the post.
        const chargeLine = wantsCharge ? chargeQueueLine(state, block, side) : null;
        const slot = wantsCharge ? chargeQueued.indexOf(vehicle) : queued.indexOf(vehicle);
        const lineSlot = chargeLine?.slots[slot] ?? null;
        if (wantsCharge && !lineSlot && slot !== 0) {
          // The line has shrunk under them — something built across it, a
          // post sold. Beyond the head, there is nowhere to stand: leave.
          loseCustomer(state, vehicle, 'Şarj kuyruğunda yer kalmadı — elektrikli müşteri ayrıldı.', effects);
          break;
        }
        if (slot >= 0 && (!wantsCharge || lineSlot)) {
          const slotPos = wantsCharge
            ? lineSlot!
            : queueSlotPosition(state, slot, side, queueSetback(queued, slot));
          // Judged by where the car is ultimately headed, not by its next
          // waypoint: with something to steer round, the next waypoint is a
          // corner of the way round rather than the slot itself.
          const heading =
            vehicle.route.length > 0
              ? vehicle.route[vehicle.route.length - 1]
              : vehicle.targetWaypoint;

          // Already standing on its slot: nothing to re-route. Handing the
          // car a fresh route to the spot it occupies every tick kept its
          // waypoint permanently set — so the straighten-out below never ran
          // once, and queues froze at whatever angle each arrival ended on.
          const parked =
            Math.hypot(
              vehicle.worldPosition[0] - slotPos[0],
              vehicle.worldPosition[2] - slotPos[2]
            ) < 0.8;

          if (
            !parked &&
            (!heading || heading[0] !== slotPos[0] || heading[2] !== slotPos[2])
          ) {
            const shuffleUp = driveable(state, vehicle, block, [slotPos]);
            // No way to the slot it has been given: better to stay where it is
            // than to shuffle forward through a wall.
            if (shuffleUp) setRoute(vehicle, shuffleUp);
          }

          // Standing at the slot, straighten out along the lane. Cars arrive
          // at whatever angle their last swerve left them on, and a queue of
          // them frozen mid-turn reads as chaos, not a queue.
          if (parked) {
            // In the pump queue, along the lane; behind a post, nose to the bay.
            const laneHeading = chargeLine
              ? Math.atan2(chargeLine.dir[0], chargeLine.dir[1])
              : block.roadEndX > block.roadStartX ? Math.PI / 2 : -Math.PI / 2;
            const turn =
              ((laneHeading - vehicle.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            vehicle.heading += turn * Math.min(1, dt * 2.5);
          }
        }

        // A charger line leads to one kind of service point, so only its head
        // may claim a socket. The mixed fuel queue below is different.
        if (slot === 0 && wantsCharge) {
          const point = findFreeCharger(state, side, vehicle, block);
          const toPost = point ? chargerRoute(state, vehicle, point.position, point.id) : null;
          if (point && toPost) {
            vehicle.chargingBuildingId = point.id;
            vehicle.chargeSecondsLeft =
              point.kind === 'dc'
                ? GAME_CONFIG.ev.dcChargeSeconds
                : GAME_CONFIG.ev.acChargeSeconds;
            setVehicleState(vehicle, 'PUMP_RESERVED');
            setRoute(vehicle, toPost);
            chargeQueued.shift();
          }
          break;
        }

        if (!wantsCharge && slot >= 0) {
          // One mixed queue feeds every fuel island. A diesel customer at the
          // head must not leave five petrol bays idle while every petrol car
          // waits behind it. The earliest driver who can use any bay that is
          // free *now* is dispatched; FIFO is still preserved among drivers
          // competing for the same available service.
          const firstServiceable = queued.find((waiting) =>
            !!findAvailablePump(state, waiting.fuelType, mods, side, waiting, block)
          );
          if (firstServiceable?.id === vehicle.id) {
            const pump = findAvailablePump(state, vehicle.fuelType, mods, side, vehicle, block);
            if (pump && reservePumpFor(state, vehicle, pump)) {
              queued.splice(slot, 1);
            }
          }
        }
        break;
      }

      case 'PUMP_RESERVED': {
        // Katı yapı kuralına uzun süredir takılı bir araç bay'ine asla
        // varamayacak demektir — rezervasyonu rehin tutmak yerine bırakır ve
        // gider. Güvenlik valfi: bay kırpması düzgünken hiç tetiklenmez.
        if ((vehicle.solidStuckSeconds ?? 0) > 20) {
          if (vehicle.targetPumpId && state.pumps[vehicle.targetPumpId]) {
            releasePump(state.pumps[vehicle.targetPumpId]);
            vehicle.targetPumpId = null;
          }
          vehicle.chargingBuildingId = null;
          sendAway(state, vehicle);
          break;
        }

        // The post they were promised can be sold, carried off, or cut off at
        // the substation while they are still rolling up to it. A powered
        // point is one chargingPoints still lists; anything else is dead.
        if (
          vehicle.chargingBuildingId &&
          !chargingPoints(state, side).some((p) => p.id === vehicle.chargingBuildingId)
        ) {
          loseCustomer(
            state,
            vehicle,
            'Şarj hizmeti kesildi — müşteri hizmet alamadan ayrıldı.',
            effects
          );
          break;
        }

        if (driveInTraffic(state, vehicle, block, dt)) {
          setVehicleState(vehicle, 'AT_PUMP');
          const pump = vehicle.targetPumpId ? state.pumps[vehicle.targetPumpId] : null;
          if (pump) setPumpState(pump, 'REQUEST_READY');
        }
        vehicle.patience -= dt * 0.5; // waiting is gentler while rolling up

        // A driver who cannot reach the bay they were promised gives it up.
        // Holding the pump reserved for one would shut it for everybody else.
        if (vehicle.patience <= 0 || isWedged(vehicle)) {
          loseCustomer(state, vehicle, 'Pompaya ulaşamayan müşteri vazgeçti.', effects);
        }
        break;
      }

      case 'AT_PUMP':
      case 'REQUEST': {
        // Pulled up and found nothing on offer. No point standing there.
        if (!vehicle.chargingBuildingId && cannotServe(state, vehicle)) {
          vehicle.noServiceSeconds = (vehicle.noServiceSeconds ?? 0) + dt;
          if (vehicle.noServiceSeconds >= GIVE_UP_SECONDS) {
            loseCustomer(state, vehicle, serviceFailureReason(state, vehicle, 'Müşteri hizmet alamadan ayrıldı.'), effects);
          }
          break;
        }

        // A plugged-in car waits for somebody to start the charge — the
        // attendant on the post, or the player — and loses patience like
        // anyone at a pump. The post being sold, or its substation, is the
        // one thing that sends it away at once.
        if (vehicle.chargingBuildingId) {
          if (!chargingPoints(state, side).some((p) => p.id === vehicle.chargingBuildingId)) {
            loseCustomer(
              state,
              vehicle,
              'Şarj hizmeti kesildi — müşteri hizmet alamadan ayrıldı.',
              effects
            );
            break;
          }
          if (energyAvailable(state, side) < 1) {
            vehicle.noServiceSeconds = (vehicle.noServiceSeconds ?? 0) + dt;
            if (vehicle.noServiceSeconds >= GIVE_UP_SECONDS) {
              loseCustomer(state, vehicle, serviceFailureReason(state, vehicle, 'Müşteri şarj alamadan ayrıldı.'), effects);
            }
            break;
          }
          vehicle.waitingTimeSeconds += dt;
          vehicle.patience -= dt;
          if (vehicle.patience <= 0) {
            loseCustomer(state, vehicle, 'Şarj için bekleyen müşteri sabrını yitirdi.', effects);
          }
          break;
        }

        vehicle.waitingTimeSeconds += dt;
        vehicle.patience -= dt;
        if (vehicle.patience <= 0) {
          loseCustomer(
            state,
            vehicle,
            serviceFailureReason(state, vehicle, 'Pompada hizmet bekleyen müşteri ayrıldı.'),
            effects
          );
        }
        break;
      }

      case 'FUELING': {
        // A charging car draws its kWh out of the block's banks as it goes;
        // an empty bank stalls the charge until the grid tops it up, and a
        // driver will only sit through so much of that.
        if (vehicle.chargingBuildingId) {
          const point = chargingPoints(state, side).find((p) => p.id === vehicle.chargingBuildingId);
          if (!point) {
            loseCustomer(state, vehicle, 'Şarj hizmeti kesildi — müşteri hizmet alamadan ayrıldı.', effects);
            break;
          }
          const seconds =
            point.kind === 'dc' ? GAME_CONFIG.ev.dcChargeSeconds : GAME_CONFIG.ev.acChargeSeconds;
          const need = (vehicle.request.calculatedLiters / seconds) * dt;
          const drawn = drawEnergy(state, side, need);
          vehicle.request.dispensedLiters += drawn;
          vehicle.chargeSecondsLeft = (vehicle.chargeSecondsLeft ?? seconds) - dt * (need > 0 ? drawn / need : 1);
          if (drawn < need * 0.999) {
            vehicle.patience -= dt * 0.5;
            if (vehicle.patience <= 0) {
              loseCustomer(state, vehicle, 'Batarya boş — şarjı yarım kalan müşteri ayrıldı.', effects);
              break;
            }
          }
          if ((vehicle.chargeSecondsLeft ?? 0) <= 0) finalizeCharge(state, vehicle, effects);
          break;
        }
        // Once the player starts the pump, the latched nozzle belongs to the
        // simulation rather than to the modal. Closing the card, pausing, and
        // relaxed speed therefore all obey the same forecourt clock.
        if (vehicle.assignedActor === 'PLAYER') {
          vehicle.patience -= dt * 0.25;
          dispenseStep(state, vehicle, dt, effects);
        }
        break;
      }

      case 'PAYMENT': {
        // Employee-served customers settle automatically; a player-served car
        // waits for the hand-over button even though its pour ran in the world.
        if (vehicle.assignedActor !== 'PLAYER') finalizeSale(state, vehicle, effects);
        break;
      }

      case 'OPTIONAL_SHOP': {
        // The building they are inside can be sold or carted off around them.
        // The one exception is an upgrade: a café absorbed into a rest complex
        // is still open — the coffee moves with it.
        if (!facilityStillOpen(state, vehicle, side, effects)) break;

        // The visit was booked on arrival; the pause is the driver's moment
        // of deciding there is nowhere to leave the car, and going.
        vehicle.waitingTimeSeconds += dt;
        if (vehicle.waitingTimeSeconds >= VIRTUAL_VISIT_SECONDS) {
          vehicle.visitBuildingId = null;
          vehicle.visitMode = null;
          sendAway(state, vehicle);
        }
        break;
      }

      case 'TO_PARK': {
        if (!facilityStillOpen(state, vehicle, side, effects)) break;

        // The park itself can be sold while a car is rolling up to it.
        if (!vehicle.parkingBuildingId || !state.buildings[vehicle.parkingBuildingId]) {
          endVisit(state, vehicle);
          break;
        }

        if (driveInTraffic(state, vehicle, block, dt)) {
          // Square in the lines, facing the kerb, whatever angle the last
          // leg came in at.
          const park = state.buildings[vehicle.parkingBuildingId];
          vehicle.heading = parkingBay(park, vehicle.parkingSlot ?? 0, vehicleBodyHalfExtents(vehicle)).heading;
          setVehicleState(vehicle, 'VISITING');
          vehicle.waitingTimeSeconds = 0;
          spawnVisitor(state, vehicle, state.buildings[vehicle.visitBuildingId!]);
          break;
        }

        // Boxed in on the way to the bay: give the bay up and go, rather
        // than stand in the aisle for the rest of the day.
        if (isWedged(vehicle) || (vehicle.solidStuckSeconds ?? 0) > 20) {
          giveUpParking(state, vehicle, effects);
        }
        break;
      }

      case 'VISITING': {
        if (!facilityStillOpen(state, vehicle, side, effects)) break;

        // The park sold from under a parked car: the driver comes back to
        // find it on the concrete and drives off. No penalty — nobody was
        // left unserved, the visit already happened.
        if (
          vehicle.visitMode === 'PARK' &&
          (!vehicle.parkingBuildingId || !state.buildings[vehicle.parkingBuildingId])
        ) {
          endVisit(state, vehicle);
          break;
        }

        vehicle.waitingTimeSeconds += dt;
        const building = state.buildings[vehicle.visitBuildingId!];
        if (
          !vehicle.visitor ||
          vehicle.waitingTimeSeconds > VISIT_TIMEOUT_SECONDS ||
          advanceVisitor(state, vehicle, building, dt, effects)
        ) {
          endVisit(state, vehicle);
        }
        break;
      }

      case 'EXIT': {
        // This customer is already counted; letting a wedged one sit on the
        // forecourt only blocks the cars still trying to be served. A car the
        // solid-structure rule has pinned against a wall for good goes the
        // same way — pressed steel is honest for a while, a permanent statue
        // is not.
        if (
          isWedged(vehicle) ||
          (vehicle.solidStuckSeconds ?? 0) > 20 ||
          driveInTraffic(state, vehicle, block, dt)
        ) {
          setVehicleState(vehicle, 'DESPAWN');
        }
        break;
      }

      case 'DESPAWN': {
        delete state.vehicles[vehicle.id];
        break;
      }
    }
  }
}

/**
 * Whether the building a visiting driver is in, or headed for, is still
 * there. Sold out from under them, they leave unserved and the station's
 * name pays for it — unless a rest complex has gone up in its place, in which
 * case the café they wanted is still open, under a bigger roof. False means
 * the caller's work for this tick is done.
 */
function facilityStillOpen(
  state: GameState,
  vehicle: VehicleEntity,
  side: DrivewaySide,
  effects: SimEffects
): boolean {
  if (!vehicle.visitBuildingId || state.buildings[vehicle.visitBuildingId]) return true;

  const complex = Object.values(state.buildings).find(
    (b) => b.type === 'rest_complex' && drivewaySideAt(b.position[1]) === side
  );
  if (!complex) {
    loseCustomer(
      state,
      vehicle,
      'Kullandığı tesis kaldırıldı — müşteri hizmet alamadan ayrıldı.',
      effects
    );
    return false;
  }

  vehicle.visitBuildingId = complex.id;
  // A driver already on foot heads for the new door.
  const visitor = vehicle.visitor;
  if (visitor && visitor.phase === 'TO_BUILDING') {
    const route = walkRoute(
      state,
      blockFor(state, vehicle),
      visitor.worldPosition,
      facilityDoor(complex),
      [complex.id, vehicle.parkingBuildingId]
    );
    visitor.route = route.slice(1);
    visitor.targetWaypoint = route[0] ?? null;
  }
  return true;
}

/**
 * An attendant on a charging post: waits by it, plugs each arriving car in
 * after the usual moment's preparation, and counts the charge when it is
 * done. True when the post exists and was handled here.
 */
function tickChargerAttendant(
  state: GameState,
  employee: EmployeeEntity,
  dt: number,
  tier: { actionDelaySeconds: number }
): boolean {
  const post = employee.assignedPumpId ? state.buildings[employee.assignedPumpId] : null;
  if (!post || (post.type !== 'ev_charger_ac' && post.type !== 'ev_charger_dc')) return false;

  employee.worldPosition = [post.position[0] - 0.7, 0, post.position[1] + 0.7];
  if (employee.state === 'UNASSIGNED') setEmployeeState(employee, 'IDLE');

  const vehicle = Object.values(state.vehicles).find((v) => v.chargingBuildingId === post.id) ?? null;
  if (!vehicle) {
    if (employee.state === 'FUELING') employee.serviceCount++;
    if (employee.state !== 'IDLE') {
      setEmployeeState(employee, 'RETURN_IDLE');
      setEmployeeState(employee, 'IDLE');
    }
    employee.currentVehicleId = null;
    employee.actionTimerSeconds = 0;
    return true;
  }

  if (vehicle.assignedActor === 'PLAYER') return true;

  if (vehicle.state === 'AT_PUMP' && vehicle.assignedActor === null && employee.state === 'IDLE') {
    employee.currentVehicleId = vehicle.id;
    setEmployeeState(employee, 'SELECT_JOB');
    setEmployeeState(employee, 'MOVING');
    setEmployeeState(employee, 'PREPARE');
    employee.actionTimerSeconds = tier.actionDelaySeconds;
    vehicle.assignedActor = 'EMPLOYEE';
    return true;
  }

  if (employee.state === 'PREPARE') {
    if (employee.currentVehicleId !== vehicle.id || vehicle.state !== 'AT_PUMP') {
      employee.currentVehicleId = null;
      employee.actionTimerSeconds = 0;
      setEmployeeState(employee, 'IDLE');
      return true;
    }
    employee.actionTimerSeconds -= dt;
    if (employee.actionTimerSeconds <= 0) {
      if (beginCharging(state, vehicle, 'EMPLOYEE')) {
        setEmployeeState(employee, 'FUELING');
      } else {
        vehicle.assignedActor = null;
        employee.currentVehicleId = null;
        setEmployeeState(employee, 'IDLE');
      }
    }
    return true;
  }

  // The charge runs on its own once started; the attendant stands by it
  // and the vehicle's departure closes the job above.
  return true;
}

function tickEmployees(state: GameState, dt: number, effects: SimEffects): void {
  for (const employee of Object.values(state.employees)) {
    if (employee.role !== 'PUMP_ATTENDANT') continue;

    const tier =
      GAME_CONFIG.employees.pumpAttendant.tierLevels[employee.level - 1] ||
      GAME_CONFIG.employees.pumpAttendant.tierLevels[0];

    if (!employee.assignedPumpId) {
      setEmployeeState(employee, 'UNASSIGNED');
      continue;
    }

    const pump = state.pumps[employee.assignedPumpId];
    if (!pump) {
      // Not a pump: a charging post, perhaps. Same job, different nozzle.
      if (tickChargerAttendant(state, employee, dt, tier)) continue;
      setEmployeeState(employee, 'UNASSIGNED');
      continue;
    }
    employee.worldPosition = [pump.position[0] - 0.6, 0, pump.position[1] + 0.6];

    if (employee.state === 'UNASSIGNED') setEmployeeState(employee, 'IDLE');

    const vehicle = pump.currentVehicleId ? state.vehicles[pump.currentVehicleId] : null;
    if (!vehicle) {
      if (employee.state !== 'IDLE') {
        setEmployeeState(employee, employee.state === 'PAYMENT' ? 'RETURN_IDLE' : 'IDLE');
        setEmployeeState(employee, 'IDLE');
      }
      employee.currentVehicleId = null;
      employee.actionTimerSeconds = 0;
      continue;
    }

    // Wrap up the previous job before a new car can be taken on. The pump may
    // already hold the next customer by the time the sale is settled.
    if (
      employee.state === 'PAYMENT' &&
      (employee.currentVehicleId !== vehicle.id || vehicle.state !== 'PAYMENT')
    ) {
      setEmployeeState(employee, 'RETURN_IDLE');
      setEmployeeState(employee, 'IDLE');
      employee.currentVehicleId = null;
    }

    // A customer the player has claimed is off-limits to staff.
    if (vehicle.assignedActor === 'PLAYER') continue;

    // Only an idle attendant may take on a car. Without this an attendant
    // already preparing or settling up would try to start a second job.
    if (
      vehicle.state === 'AT_PUMP' &&
      vehicle.assignedActor === null &&
      employee.state === 'IDLE'
    ) {
      employee.currentVehicleId = vehicle.id;
      setEmployeeState(employee, 'SELECT_JOB');
      setEmployeeState(employee, 'MOVING');
      setEmployeeState(employee, 'PREPARE');
      employee.actionTimerSeconds = tier.actionDelaySeconds;
      vehicle.assignedActor = 'EMPLOYEE';
      continue;
    }

    if (employee.state === 'PREPARE') {
      // The car being prepared for can leave — out of patience, or served by
      // the player — and the pump can be holding the next one before the
      // attendant looks up. Serving whoever happens to be standing there would
      // start a sale on a car still rolling up to the bay.
      if (employee.currentVehicleId !== vehicle.id || vehicle.state !== 'AT_PUMP') {
        employee.currentVehicleId = null;
        employee.actionTimerSeconds = 0;
        setEmployeeState(employee, 'IDLE');
        continue;
      }

      // Attendants take a moment to greet the driver and pick the nozzle up.
      // Then they pour what was asked for: a named sum is a named sum, not an
      // invitation to fill the tank.
      employee.actionTimerSeconds -= dt;
      if (employee.actionTimerSeconds <= 0) {
        const started = beginFueling(
          state,
          vehicle,
          vehicle.request.mode,
          vehicle.request.targetValue,
          'EMPLOYEE',
          effects
        );
        if (started) {
          setEmployeeState(employee, 'FUELING');
        } else {
          vehicle.assignedActor = null;
          employee.currentVehicleId = null;
          setEmployeeState(employee, 'IDLE');
        }
      }
      continue;
    }

    if (employee.state === 'FUELING' && vehicle.state === 'FUELING') {
      const done = dispenseStep(state, vehicle, dt * tier.speedMultiplier, effects);
      if (done) {
        setEmployeeState(employee, 'PAYMENT');
        employee.serviceCount++;
      }
    }
  }
}

/**
 * How fast a pump ages, per second, whether or not it is being used.
 *
 * Wear used to be charged per litre dispensed, which quietly punished the
 * busiest bay and left an idle one pristine for ever. Hardware standing in the
 * weather ages either way — and tying it to time makes maintenance something
 * the player schedules rather than something that ambushes their best pump.
 * Slow on purpose: a bay goes from new to needing attention over about a
 * fortnight of trading.
 */
const PUMP_AGEING_PER_SECOND = 0.022;

/**
 * What that rate becomes while the station is shut.
 *
 * Wear goes on — a closed forecourt is still hardware standing in the weather,
 * and shutting up shop must never be the cheap way to keep a bay pristine. But
 * most of what wears a pump is the pumping, and at the full rate a station left
 * closed for a few days came back to bays that needed servicing without having
 * served anybody (Emre, 2026-09-10). A quarter: the fortnight a trading pump
 * lasts becomes a couple of months of standing idle.
 */
const PUMP_AGEING_CLOSED_SHARE = 0.25;

function tickStationCondition(state: GameState, dt: number, effects: SimEffects): void {
  // Idle grime accumulates slowly across the whole forecourt.
  state.station.cleanliness = clamp(state.station.cleanliness - 0.035 * dt, 0, 100);
  tickSolarGrime(state, dt);

  const wear = state.station.open ? 1 : PUMP_AGEING_CLOSED_SHARE;

  for (const pump of Object.values(state.pumps)) {
    if (pump.state === 'BROKEN' || pump.state === 'MAINTENANCE') continue;

    pump.health = Math.max(0, pump.health - PUMP_AGEING_PER_SECOND * wear * dt);

    // Level 3 hardware is markedly more reliable (GDD: -%25 arıza riski). A
    // shut bay is no more likely to fail on a given day than it is to wear:
    // nothing is running through it, so the same share applies.
    const reliability = (pump.level >= 3 ? 0.75 : 1) * wear;
    if (pump.health <= 0) {
      breakPump(
        state,
        pump,
        effects,
        `${pumpName(state, pump)} tamamen devre dışı kaldı. Bakım yaparak tekrar hizmete alın.`
      );
      continue;
    }

    if (pump.health < 25 && Math.random() < 0.004 * reliability * dt) {
      breakPump(state, pump, effects, `${pumpName(state, pump)} aşırı yıpranma nedeniyle durdu. Bakım gerekiyor.`);
    }
  }
}

/**
 * Takes a bay out of service, and sends whoever was using it on their way.
 *
 * Wiping currentVehicleId on its own left the car behind (Emre, 2026-09-07):
 * the pump forgot the driver, so the attendant went idle and no pump state
 * ever advanced them, while the driver still held the pump, the fuel
 * reservation and their spot on the apron — neither fuelling nor leaving,
 * and invisible to the orphan sweep, which only knows a pump that has moved
 * on to *somebody else*. So the customer is evicted first, through the same
 * path as a pump that is sold from under them, and the bay fails once it is
 * empty. Whatever was already in their tank goes unpaid, the way it does when
 * the station shuts mid-fill.
 */
function breakPump(
  state: GameState,
  pump: PumpEntity,
  effects: SimEffects,
  message: string
): void {
  const { evicted } = evictFromPump(state, pump.id);
  setPumpState(pump, 'BROKEN');
  pump.currentVehicleId = null;
  notify(effects, 'CRITICAL', 'Pompa Arızalandı!', message);
  if (evicted > 0) {
    notify(
      effects,
      'WARNING',
      'Müşteri Kaybedildi!',
      `Pompa arızalanınca müşteri hizmet alamadan ayrıldı. (-0.015 İtibar)`
    );
  }
}

/** Game hours between the manager's rounds of the tills. */
export const MANAGER_COLLECT_EVERY_HOURS = 2;

function tickManagerAutomation(state: GameState, dt: number, effects: SimEffects): void {
  if (!state.station.managerId) return;
  const settings = state.managerSettings;

  const logAction = (
    category: 'FUEL_ORDER' | 'PRICING' | 'STAFF' | 'MAINTENANCE' | 'ALERT' | 'FINANCE',
    reason: string,
    result: 'SUCCESS' | 'SKIPPED_RESERVE' | 'FAILED',
    amount?: number
  ) => {
    const hour = Math.floor(hourOfDay(state.dayState.gameTime));
    const minute = Math.floor((state.dayState.gameTime % 1) * 60);
    state.managerLogs.unshift({
      id: 'mlog_' + Math.random().toString(36).substring(2, 8),
      timestamp: Date.now(),
      gameTimeStr: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      category,
      reason,
      amount,
      result
    });
    if (state.managerLogs.length > 60) state.managerLogs.pop();
  };

  // The rounds of the tills. Without a manager the player walks to each
  // building and clicks the money out; with one, it turns up in the cash
  // every couple of hours with a line in the log saying so. This keeps its
  // own clock, in game hours, and is not part of the rounds below.
  if (dutyActive(state, 'collectTills')) {
    const every = settings.collectIntervalHours ?? MANAGER_COLLECT_EVERY_HOURS;
    const now = state.dayState.gameTime;
    const last = state.station.lastTillCollectAt;
    if (last === undefined || now - last >= every || now < last) {
      state.station.lastTillCollectAt = now;
      // The first tick after hiring starts the clock rather than emptying
      // every till at once — the rounds are rounds, not a windfall.
      if (last !== undefined) {
        const round = collectAllTills(state);
        if (round.total > 0) {
          logAction(
            'FINANCE',
            `${round.buildings} tesisin kasası toplandı: ₺${round.total.toLocaleString('tr-TR')}.`,
            'SUCCESS',
            round.total
          );
        }
      }
    }
  }

  // Everything else the manager does, they do in rounds, not every tick:
  // they walk the station, see what needs doing and do it, then go back to
  // the office for a while. A tank can run down and a bay can fail between
  // two looks, and a better grade looks more often — that gap is what
  // promotion buys. The first round happens the moment they are hired.
  const left = (state.station.managerTourSecondsLeft ?? 0) - dt;
  if (left > 0) {
    state.station.managerTourSecondsLeft = left;
    return;
  }
  state.station.managerTourSecondsLeft = managerTier(state).tourSeconds;

  const estimatedWages =
    Object.values(state.employees).reduce((sum, e) => sum + e.wage, 0) + managerDailyWage(state);
  const dueInstallments = state.loans
    .filter((l) => l.state === 'ACTIVE')
    .reduce((sum, l) => sum + Math.min(l.dailyPayment, l.remaining), 0);
  let budget = calculateManagerAvailableBudget(
    state.player.cash,
    settings.kasaReserve,
    dueInstallments,
    estimatedWages
  );

  if (dutyActive(state, 'fuelOrder')) {
    // Only what the station can actually sell. The tank farm stocks all three
    // fuels from day one, so ordering by capacity alone had the manager
    // paying for LPG deliveries at a station with no LPG nozzle — three
    // tankers a day threading a forecourt that needed one.
    for (const fuelType of fuelsOnSale(state)) {
      const tank = state.tanks[fuelType];
      if (tank.capacity <= 0) continue;

      const fillPercent = (tank.stock / tank.capacity) * 100;
      if (fillPercent > settings.orderThresholdPercent) continue;
      if (state.fuelOrders.some((o) => o.fuelType === fuelType)) continue;

      const needed = tank.capacity * (settings.orderTargetPercent / 100) - tank.stock;
      const conf = GAME_CONFIG.fuels[fuelType];
      const orderLiters = Math.max(
        conf.orderMinLiters,
        Math.floor(needed / conf.orderStepLiters) * conf.orderStepLiters
      );
      if (orderLiters > tank.capacity - tank.stock) continue;

      const cost = orderLiters * state.pricing[fuelType].todayWholesaleCost + conf.deliveryFee;
      const reason = `${conf.shortName} stoku %${fillPercent.toFixed(0)} seviyesine düştü.`;

      if (cost > budget) {
        logAction('FUEL_ORDER', `${reason} Kasa rezervi korunduğu için sipariş verilmedi.`, 'SKIPPED_RESERVE', orderLiters);
        continue;
      }

      const placed = placeFuelOrder(state, fuelType, orderLiters, effects);
      logAction('FUEL_ORDER', reason, placed ? 'SUCCESS' : 'FAILED', orderLiters);
      if (placed) budget -= cost;
    }
  }

  // The supplier's minute of cheap fuel. A sharp manager fills every tank the
  // station sells from while it lasts — whatever the reorder rule says, and
  // right up to the brim, because this is the one time a full tank is cheap.
  if (dutyActive(state, 'dealStock') && isFuelDealOn(state)) {
    for (const fuelType of fuelsOnSale(state)) {
      const tank = state.tanks[fuelType];
      if (tank.capacity <= 0) continue;
      if (state.fuelOrders.some((o) => o.fuelType === fuelType)) continue;

      const conf = GAME_CONFIG.fuels[fuelType];
      const room = tank.capacity - tank.stock;
      const orderLiters = Math.floor(room / conf.orderStepLiters) * conf.orderStepLiters;
      if (orderLiters < conf.orderMinLiters) continue;

      const cost = orderLiters * wholesaleNow(state, fuelType) + conf.deliveryFee;
      const reason = `${conf.shortName} indirimdeyken depo fullendi.`;
      if (cost > budget) {
        logAction('FUEL_ORDER', `İndirim var ama kasa rezervi ${conf.shortName} için yetmedi.`, 'SKIPPED_RESERVE', orderLiters);
        continue;
      }

      const placed = placeFuelOrder(state, fuelType, orderLiters, effects);
      logAction('FUEL_ORDER', reason, placed ? 'SUCCESS' : 'FAILED', orderLiters);
      if (placed) budget -= cost;
    }
  }

  if (dutyActive(state, 'pricing')) {
    for (const fuelType of Object.keys(state.pricing) as FuelType[]) {
      if (state.tanks[fuelType].capacity <= 0) continue;
      const pricing = state.pricing[fuelType];

      // Track the regional average while defending the configured minimum margin.
      const floorPrice = pricing.todayWholesaleCost + settings.minMargin;
      const target = clamp(
        pricing.regionalAverage - 0.1,
        floorPrice,
        pricing.regionalAverage + settings.maxRegionalDiff
      );
      const rounded = Number(target.toFixed(2));

      if (Math.abs(rounded - pricing.playerPrice) >= 0.05) {
        const previous = pricing.playerPrice;
        pricing.playerPrice = rounded;
        pricing.priceStrategy = 'BALANCED';
        logAction(
          'PRICING',
          `${GAME_CONFIG.fuels[fuelType].shortName} fiyatı ${previous.toFixed(2)} TL'den ${rounded.toFixed(2)} TL'ye çekildi.`,
          'SUCCESS'
        );
      }
    }
  }

  if (dutyActive(state, 'assignAttendants')) {
    const idlePumps = Object.values(state.pumps).filter(
      (p) => p.state !== 'BROKEN' && !Object.values(state.employees).some((e) => e.assignedPumpId === p.id)
    );
    for (const employee of Object.values(state.employees)) {
      if (employee.role !== 'PUMP_ATTENDANT' || employee.assignedPumpId) continue;
      const pump = idlePumps.shift();
      if (!pump) break;
      employee.assignedPumpId = pump.id;
      pump.employeeId = employee.id;
      logAction('STAFF', `${employee.name} boştaki ${pumpName(state, pump)} pompasına atandı.`, 'SUCCESS');
    }
  }

  // Pumps: a worn bay is serviced before it fails, a failed one is put back
  // to work. Two separate duties, because they are two grades of manager —
  // the first knows to call the fitter, the second is trusted with the bill
  // for a dead bay. Both come out of the automation budget, so a thin reserve
  // leaves the pumps to wear like it leaves the tanks to run down.
  for (const pump of Object.values(state.pumps)) {
    const broken = pump.state === 'BROKEN';
    if (broken ? !dutyActive(state, 'repair') : !dutyActive(state, 'maintenance')) continue;
    if (!broken && pump.health >= settings.minHealthThreshold) continue;
    // A preventive service waits for the bay to be empty rather than
    // turning a paying customer out of it.
    if (!broken && (pump.currentVehicleId || pump.state !== 'IDLE')) continue;

    const cost = calculateRepairCost(GAME_CONFIG.buildings.pump_standard.price, pump.health);
    const what = broken ? 'arızası giderildi' : `bakımı yapıldı (sağlık %${pump.health.toFixed(0)})`;
    if (cost > budget) {
      // Once per stretch of not affording it, not once per round.
      const last = state.managerLogs.find(
        (l) => l.category === 'MAINTENANCE' && l.reason.includes(pumpName(state, pump))
      );
      if (last?.result !== 'SKIPPED_RESERVE') {
        logAction(
          'MAINTENANCE',
          `${pumpName(state, pump)} ${broken ? 'arızalı' : 'yıpranmış'}; kasa rezervi tamir için yetmedi (₺${cost.toLocaleString('tr-TR')}).`,
          'SKIPPED_RESERVE',
          cost
        );
      }
      continue;
    }

    const paid = servicePump(state, pump, `${pumpName(state, pump)} ${broken ? 'arıza onarımı' : 'bakımı'} (müdür)`);
    logAction('MAINTENANCE', `${pumpName(state, pump)} ${what}.`, paid === null ? 'FAILED' : 'SUCCESS', cost);
    if (paid !== null) {
      budget -= paid;
      trackMissionMetric(state, 'PUMPS_REPAIRED', 1, effects);
    }
  }

  // The forecourt. Grime costs custom and, on the roof panels, sun; a sweep
  // is one of the cheaper things the manager pays for, so it waits on the
  // reserve like the rest.
  if (dutyActive(state, 'cleanStation') && state.station.cleanliness < MANAGER_CLEAN_BELOW) {
    const cost = GAME_CONFIG.economy.siteCleanCost;
    if (cost > budget) {
      const last = state.managerLogs.find((l) => l.category === 'MAINTENANCE' && l.reason.includes('temizli'));
      if (last?.result !== 'SKIPPED_RESERVE') {
        logAction('MAINTENANCE', 'Saha kirlendi; kasa rezervi temizlik için yetmedi.', 'SKIPPED_RESERVE', cost);
      }
    } else {
      const tx = TransactionService.executeCashTransaction(state, {
        type: 'CLEAN',
        amount: -cost,
        description: 'Saha temizliği (müdür)'
      });
      if (tx.success) {
        budget -= cost;
        state.station.cleanliness = Math.min(100, state.station.cleanliness + 25);
        state.player.statistics.cleanActionsCount++;
        trackMissionMetric(state, 'STATION_CLEANED', 1, effects);
        logAction('MAINTENANCE', `Saha temizlendi (%${Math.round(state.station.cleanliness)}).`, 'SUCCESS', cost);
      }
    }
  }

  // The same duty covers the glass: a roof of panels below half is washed.
  if (dutyActive(state, 'cleanStation')) {
    for (const pump of Object.values(state.pumps)) {
      if (!pump.hasCanopy || !pump.hasSolarCanopy) continue;
      if (solarCleanlinessOf(pump) >= MANAGER_CLEAN_BELOW) continue;
      const cost = solarCleanCost(GAME_CONFIG.buildings.canopy.size);
      if (cost > budget) {
        const last = state.managerLogs.find((l) => l.category === 'MAINTENANCE' && l.reason.includes('panel'));
        if (last?.result !== 'SKIPPED_RESERVE') {
          logAction('MAINTENANCE', 'Güneş panelleri kirlendi; kasa rezervi yıkama için yetmedi.', 'SKIPPED_RESERVE', cost);
        }
        break;
      }
      const paid = washSolarPanels(state, pump, `${pumpName(state, pump)} güneş paneli yıkama (müdür)`);
      if (paid !== null) {
        budget -= paid;
        logAction('MAINTENANCE', `${pumpName(state, pump)} güneş panelleri yıkandı.`, 'SUCCESS', paid);
      }
    }
  }

  if (settings.autoMaintenanceAlert) {
    for (const pump of Object.values(state.pumps)) {
      if (pump.health >= settings.minHealthThreshold) continue;
      // No need to nag about a bay the manager is about to service anyway.
      if (dutyActive(state, 'maintenance') && pump.state !== 'BROKEN') continue;
      const alreadyWarned = state.managerLogs.some(
        (l) => l.category === 'MAINTENANCE' && l.reason.includes(pumpName(state, pump))
      );
      if (alreadyWarned) continue;

      logAction('MAINTENANCE', `${pumpName(state, pump)} sağlığı %${pump.health.toFixed(0)} seviyesine düştü.`, 'SUCCESS');
      notify(
        effects,
        'WARNING',
        'Bakım Uyarısı',
        `${pumpName(state, pump)} sağlığı %${pump.health.toFixed(0)}. Arızalanmadan önce bakım yapın.`
      );
    }
  }
}

/**
 * Puts a pump back to full health and into service, and pays for it.
 *
 * Shared by the player's repair button and the manager's rounds, so what a
 * repair costs and what it does is decided in one place. Whoever is at the
 * bay is sent away first: a service that only forgot the car left it
 * standing at the pump for ever, neither fuelling nor leaving — the same
 * failure as a breakdown used to be — and turning a customer out to service
 * the bay under them costs what turning a customer out always costs.
 *
 * Returns what was paid, or null if the till could not cover it.
 */
export function servicePump(state: GameState, pump: PumpEntity, description: string): number | null {
  const cost = calculateRepairCost(GAME_CONFIG.buildings.pump_standard.price, pump.health);
  const tx = TransactionService.executeCashTransaction(state, {
    type: 'REPAIR',
    amount: -cost,
    description
  });
  if (!tx.success) return null;

  evictFromPump(state, pump.id);
  pump.health = 100;
  // A broken pump has to go through MAINTENANCE before it can serve again.
  setPumpState(pump, 'MAINTENANCE');
  setPumpState(pump, 'IDLE');
  releasePump(pump);
  state.player.statistics.repairActionsCount++;
  state.dayState.todayStats.repairs += cost;
  return cost;
}

/* ------------------------------------------------------------------ */
/* Shared order placement (used by the player and the manager alike)   */
/* ------------------------------------------------------------------ */

/**
 * Litres of this fuel bought and not yet in the tank: on the road, at the
 * gate, or still unloading. They are as good as in the tank for the question
 * "how much more can I order" — Emre, 2026-09-09: a 1499 L tanker on its way
 * and the order card still offered another 1499, which would have arrived to
 * a full tank and gone straight back as a refund.
 */
export function litersOnOrder(state: GameState, fuelType: FuelType): number {
  return state.fuelOrders
    .filter((o) => o.fuelType === fuelType && o.state !== 'COMPLETED')
    .reduce((sum, o) => sum + o.liters, 0);
}

/** What the tank still has room for, counting what is already on its way. */
export function orderableLiters(state: GameState, fuelType: FuelType): number {
  const tank = state.tanks[fuelType];
  if (!tank) return 0;
  return Math.max(0, tank.capacity - tank.stock - litersOnOrder(state, fuelType));
}

export function placeFuelOrder(
  state: GameState,
  fuelType: FuelType,
  liters: number,
  effects: SimEffects,
  supplierId: string = 'standart'
): boolean {
  const conf = GAME_CONFIG.fuels[fuelType];
  const tank = state.tanks[fuelType];

  if (!conf || !tank || tank.capacity <= 0) {
    notify(effects, 'WARNING', 'Tank Bulunmuyor', `${fuelType} tankı henüz inşa edilmedi!`);
    return false;
  }

  const onOrder = litersOnOrder(state, fuelType);
  const freeCapacity = orderableLiters(state, fuelType);
  if (!Number.isFinite(liters) || liters < 1) {
    notify(effects, 'WARNING', 'Geçersiz Miktar', 'En az 1 litre sipariş edilebilir.');
    return false;
  }
  if (liters > freeCapacity) {
    notify(
      effects,
      'WARNING',
      'Kapasite Yetersiz',
      onOrder > 0
        ? `Sipariş kalan kapasiteyi (${freeCapacity.toFixed(0)} L) aşamaz — ${onOrder.toFixed(0)} L zaten yolda.`
        : `Sipariş boş kapasiteyi (${freeCapacity.toFixed(0)} L) aşamaz.`
    );
    return false;
  }

  // Tedarikçi çarpanları: bilinmeyen id gelirse standart kabul edilir.
  const supplier = GAME_CONFIG.suppliers.find((s) => s.id === supplierId)
    ?? GAME_CONFIG.suppliers.find((s) => s.id === 'standart')!;

  const baseUnitCost = wholesaleNow(state, fuelType);
  const unitCost = Number((baseUnitCost * supplier.priceMultiplier).toFixed(2));
  const totalCost = liters * unitCost + conf.deliveryFee;

  const tx = TransactionService.executeCashTransaction(state, {
    type: 'FUEL_ORDER',
    amount: -totalCost,
    description: `${liters} L ${conf.name} tanker siparişi (${supplier.name})`
  });
  if (!tx.success) {
    notify(effects, 'WARNING', 'Yetersiz Bakiye', tx.error || 'Sipariş tutarı kasayı aşıyor.');
    return false;
  }

  const baseDuration = Math.floor(
    GAME_CONFIG.economy.tankerSpeedSecondsMin +
      Math.random() *
        (GAME_CONFIG.economy.tankerSpeedSecondsMax - GAME_CONFIG.economy.tankerSpeedSecondsMin)
  );
  const duration = Math.round(baseDuration * supplier.speedMultiplier);

  state.fuelOrders.push({
    id: 'order_' + Math.random().toString(36).substring(2, 8),
    fuelType,
    liters,
    unitCost,
    deliveryFee: conf.deliveryFee,
    totalCost,
    totalDurationSeconds: duration,
    remainingSeconds: duration,
    state: 'TRAVELLING',
    transactionId: tx.transactionId,
    supplierId: supplier.id
  });

  trackMissionMetric(state, 'ORDERS_PLACED', 1, effects);
  playCue(effects, 'buildPlace');
  // No toast: the order shows up at once in the corner widget, which is
  // where its whole journey is followed from.
  return true;
}

/* ------------------------------------------------------------------ */
/* Main tick                                                           */
/* ------------------------------------------------------------------ */

export function runSimulationTick(
  state: GameState,
  deltaSeconds: number,
  effects: SimEffects
): void {
  const speed = state.dayState.timeSpeed;
  if (speed === 0 || !state.dayState.isDayActive) return;

  const dt = deltaSeconds * speed;

  // Old/interrupted saves could keep a tank-wide hold after the customer that
  // owned it had vanished. Rebuild it once per simulation turn, before a new
  // arrival decides the forecourt is dry. Doing this outside the vehicle
  // substeps avoids multiplying the work on long/catch-up ticks.
  reconcileFuelReservations(state);

  const hoursPerSecond = 1 / GAME_CONFIG.economy.realSecondsPerGameHour;
  state.dayState.gameTime += dt * hoursPerSecond;

  if (state.dayState.gameTime >= GAME_CONFIG.economy.dayEndHour) {
    state.dayState.gameTime = GAME_CONFIG.economy.dayEndHour;
    state.dayState.isDayEnding = true;
    effects.dayEnded = true;
    return;
  }

  tickEvents(state, dt * hoursPerSecond, dt, effects);
  const mods = getEventModifiers(state);

  syncPriceSign(state);
  tickWayWatch(state, effects);
  tickFuelOrders(state, dt, effects);
  tickRush(state, dt, effects);
  tickFuelDeal(state, dt, effects);
  trySpawnVehicle(state, dt, mods);
  const vehicleSteps = Math.max(1, Math.ceil(dt / MAX_VEHICLE_STEP));
  for (let step = 0; step < vehicleSteps; step++) {
    tickVehicles(state, dt / vehicleSteps, effects, mods);
  }
  tickEmployees(state, dt, effects);
  tickEnergy(state, dt);
  tickStationCondition(state, dt, effects);
  tickManagerAutomation(state, dt, effects);
}
