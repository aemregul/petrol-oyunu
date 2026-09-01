/**
 * Project Highway - Simulation Engine
 *
 * Every function here mutates a GameState draft in place and pushes its side
 * effects (notifications, sound cues) into a SimEffects collector. Nothing in
 * this module reads or writes the Zustand store, so a single simulation tick
 * can advance the whole world and the store commits the result exactly once.
 */

import {
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
  legIsClear,
  inRects,
  Rect as PathRect
} from './pathfinding';
import {
  GAME_EVENTS,
  GameEventConfig,
  DAILY_MISSION_TEMPLATES
} from '../../config/eventConfig';
import { TransactionService } from './TransactionService';
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
  clamp
} from '../formulas/economy';
import { FAR_SIDE_FRONT, farSideBounds } from './land';

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
  message: string
): void {
  effects.notifications.push({ type, title, message });
}

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
   */
  roadMargin: 42,
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
  pumps: Array<{ position: [number, number] }>,
  side: DrivewaySide,
  spans: Array<[number, number]>
): number {
  const relevant = pumps.filter((p) => drivewaySideAt(p.position[1]) === side);
  const clearance = (z: number) =>
    Math.min(
      relevant.reduce((worst, p) => Math.min(worst, Math.abs(p.position[1] - z)), Infinity),
      // A line of cars parked inside the shop is as wrong as one driving
      // through it, so the lay-by clears the buildings too.
      laneClearance(z, spans)
    );


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
  const queueHeadX = side === 'far' ? box.maxX - headIn : box.minX + headIn;
  const drivenX: [number, number] = [
    Math.min(mouths.entry.x, mouths.exit.x, queueHeadX, ...bayXs),
    Math.max(mouths.entry.x, mouths.exit.x, queueHeadX, ...bayXs)
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
  const layByZ = queueLayByZ(laneZ, exitLaneZ, inward, pumps, side, padded);

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

/** True when a quarter turn has put a pump's serving faces on the z axis. */
export function pumpFacesAcrossZ(pump: { rotation?: number }): boolean {
  const turn = ((pump.rotation ?? 0) % 360 + 360) % 360;
  return turn === 90 || turn === 270;
}

/**
 * Where a car stands to be served, relative to the island.
 *
 * A pump island serves from its two long faces — PumpMesh draws a till and a
 * holster on each, at local ±x — and those faces turn with the island. The bay
 * was pinned to world x regardless, so turning a pump moved the hardware and
 * left the car parked against its blank end: the player aims the pump at the
 * entrance and the drivers still pull up sideways to it.
 *
 * Unturned, the side is chosen by where the queue feeds from, so the car pulls
 * in rather than swinging across the island. Turned, the faces look up and down
 * the plot instead, and the near one is the one the circulation lane is on.
 */
export function pumpBayOffset(
  block: Pick<BlockLayout, 'queueStep' | 'laneZ'>,
  pump: { position: [number, number]; rotation?: number }
): [number, number] {
  if (!pumpFacesAcrossZ(pump)) {
    return [block.queueStep < 0 ? PUMP_BAY_OFFSET : -PUMP_BAY_OFFSET, 0];
  }
  return [0, block.laneZ <= pump.position[1] ? -PUMP_BAY_OFFSET : PUMP_BAY_OFFSET];
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
const FOLLOW_CORRIDOR = 1.2;

/**
 * Nobody comes closer than this to anybody, whatever direction either is
 * facing. A car is about this wide, so it is the line between passing beside
 * someone and passing through them.
 */
const CAR_CLEARANCE = 1.4;

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
  const wanted = FOLLOW_DISTANCE * pace;

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
    const noGap = traffic.some((other) => {
      if (other.id === vehicle.id) return false;
      if (Math.abs(other.worldPosition[2] - block.roadLaneZ) >= 1) return false;
      const behind = (target[0] - other.worldPosition[0]) * flow;
      return behind > -CAR_CLEARANCE && behind < MERGE_GAP;
    });
    if (noGap) return { throttle: 0, gap: Infinity };
  }

  // The return lane is the other place cars merge rather than follow: they
  // pull out of the bays sideways into traffic already running along it.
  if (joining(block.exitLaneZ, 1)) {
    const occupied = traffic.some(
      (other) =>
        other.id !== vehicle.id &&
        Math.abs(other.worldPosition[2] - block.exitLaneZ) < 1 &&
        Math.abs(other.worldPosition[0] - target[0]) < MERGE_GAP
    );
    if (occupied) return { throttle: 0, gap: Infinity };
  }
  const toTarget = Math.hypot(
    target[0] - vehicle.worldPosition[0],
    target[2] - vehicle.worldPosition[2]
  );

  let nearest = Infinity;

  for (const other of traffic) {
    if (other.id === vehicle.id) continue;

    // Routes meet at shared points — the mouth of a ramp, the head of the
    // exit lane. Two cars converging on one from different directions cannot
    // see each other ahead until they are already touching, so at a shared
    // waypoint the one closer to it goes first.
    const merging = other.targetWaypoint;
    if (merging && merging[0] === target[0] && merging[2] === target[2]) {
      const theirs = Math.hypot(
        merging[0] - other.worldPosition[0],
        merging[2] - other.worldPosition[2]
      );
      if (theirs < toTarget) nearest = Math.min(nearest, toTarget - theirs);
    }

    const gap = other.id.startsWith('truck_')
      ? truckBodyAhead(vehicle, other, dir)
      : distanceAhead(vehicle, other, dir);
    if (gap === null || gap >= nearest) continue;

    // Two cars nose to nose would both give way and neither would ever move
    // again. One of them has to have right of way, and the id decides so that
    // the choice is the same on every tick.
    const theirDir = headingVector(other);
    const mutual = theirDir !== null && distanceAhead(other, vehicle, theirDir) !== null;
    if (mutual && vehicle.id < other.id) continue;

    // Whoever gives way holds back by a full car rather than creeping up to
    // the other's bumper, so it is not left sitting across the path of the car
    // it just waved through.
    nearest = mutual ? gap - CAR_CLEARANCE : gap;
  }

  if (nearest === Infinity) return { throttle: 1, gap: Infinity };
  return { throttle: clamp((nearest - wanted) / wanted, 0, 1), gap: nearest };
}

/** True once a driver has spent longer than anyone would getting nowhere. */
function isWedged(vehicle: VehicleEntity): boolean {
  return (vehicle.blockedSeconds ?? 0) > STUCK_LIMIT_SECONDS;
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

  return driveToward(vehicle, dt * pace * (held ? Math.max(throttle, CRAWL_THROTTLE) : throttle));
}

/** The block a vehicle is working with, falling back to the station's own. */
function blockFor(state: GameState, vehicle: VehicleEntity): BlockLayout {
  return blockLayout(state, vehicleSide(vehicle)) ?? blockLayout(state, 'near')!;
}

/**
 * How many cars fit in the queue lane without the tail running off the
 * concrete. Derived from the block so widening the station lengthens the
 * queue — and so the block across the road gets its own limit.
 */
function maxQueueLength(state: GameState, block: BlockLayout): number {
  const m = LAYOUT.apronMargin;
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
  const at = clampToApron(block, raw);
  return Math.abs(at[0] - raw[0]) > 0.01 ? null : at;
}

export function queueSlotPosition(
  state: GameState,
  index: number,
  side: DrivewaySide = 'near'
): [number, number, number] {
  const block = blockLayout(state, side) ?? blockLayout(state, 'near')!;
  // Only walls: a car queueing right beside a pump island is exactly where it
  // is meant to be waiting.
  const rects = wallRects(state, block.side);

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
    if (++clear === index) return at;
  }

  // Asked for a place further back than the lay-by has: the queue is capped to
  // the slots that exist, so this is the tail rather than a spot in a wall.
  return last ?? clampToApron(block, [block.queueHeadX, 0, block.queueZ]);
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
  ignoreBuildingId?: string
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
    parkedTruckRects(state)
  );
}

/** Whether this car could actually get to a spot from where it stands. */
function reachable(
  state: GameState,
  vehicle: VehicleEntity,
  block: BlockLayout,
  waypoints: Array<[number, number, number]>,
  ignorePumpId?: string
): boolean {
  return canReach(
    state,
    vehicle,
    block.side,
    waypoints,
    { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
    frontageKeepOut(block),
    ignorePumpId
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
function pumpRoute(
  state: GameState,
  vehicle: VehicleEntity,
  pump: PumpEntity
): Array<[number, number, number]> | null {
  const block = blockFor(state, vehicle);
  const bay = pumpBay(block, pump);

  // Pull straight out of the waiting bay before turning along the lane. Cutting
  // the corner would take the car back down the line it was just standing in,
  // through everyone still waiting there.
  //
  // A car ends up facing the way its last leg ran, and it has to come to rest
  // alongside the island rather than nosed into it — so the final approach runs
  // down whichever axis the island is long on. Unturned that is z, straight off
  // the lane; turned a quarter, it is x, which needs one more corner to line the
  // car up before it rolls in.
  const legs: Array<[number, number, number]> = pumpFacesAcrossZ(pump)
    ? [
        [vehicle.worldPosition[0], 0, block.laneZ],
        [bay[0] + Math.sign(block.queueStep) * PUMP_APPROACH_RUN, 0, block.laneZ],
        [bay[0] + Math.sign(block.queueStep) * PUMP_APPROACH_RUN, 0, bay[2]],
        bay
      ]
    : [[vehicle.worldPosition[0], 0, block.laneZ], [bay[0], 0, block.laneZ], bay];

  return driveable(state, vehicle, block, legs, pump.id);
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
  const offset = block.queueStep < 0 ? PUMP_BAY_OFFSET : -PUMP_BAY_OFFSET;
  const bay = clampToApron(block, [point[0] + offset, 0, point[1]]);

  return driveable(
    state,
    vehicle,
    block,
    [[vehicle.worldPosition[0], 0, block.laneZ], [bay[0], 0, block.laneZ], bay],
    undefined,
    postId
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
  const rects = wallRects(state, block.side);
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
  const route = exitRoute(state, vehicle);
  if (route === null) {
    setVehicleState(vehicle, 'DESPAWN');
    return;
  }

  setVehicleState(vehicle, 'EXIT');
  setRoute(vehicle, route);
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
  // waiting bay. Anywhere else it is out among the pumps. The tolerance is
  // tight because those are exact spots a car parks on — measuring loosely
  // catches a pump island that happens to sit near the waiting bay and sends
  // cars that did reach a pump back out through the arriving traffic.
  const atFrontOfPlot =
    Math.abs(from.worldPosition[2] - block.laneZ) < 1 ||
    Math.abs(from.worldPosition[2] - block.queueZ) < 1;

  // A car at a bay whose exit mouth lies AHEAD of it pulls back onto the
  // front lane and drives on out, the way any real forecourt flows. The lap
  // around the back of the plot is kept only for when the mouth is behind —
  // turning against the incoming traffic would be worse than the detour.
  const flow = Math.sign(block.roadEndX - block.roadStartX) || 1;
  // Attempted only when the straight run to the mouth is actually open: the
  // full search is expensive exactly on the cramped plots where the forward
  // way is usually walled off anyway.
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
    const a: [number, number] = [from.worldPosition[0], block.laneZ];
    const b: [number, number] = [laneX, block.laneZ];
    return (
      legIsClear(walls, [from.worldPosition[0], from.worldPosition[2]], a) &&
      legIsClear(walls, a, b)
    );
  };
  if (!atFrontOfPlot && (laneX - from.worldPosition[0]) * flow > 1 && forwardOpen()) {
    const forward = routeAroundOrNull(
      state,
      from,
      block.side,
      [
        offWalls(state, block, clampToApron(block, [from.worldPosition[0], 0, block.laneZ])),
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
    if (forward) return forward;
  }

  const throughLane = atFrontOfPlot ? block.laneZ : block.exitLaneZ;

  return routeAroundOrNull(
    state,
    from,
    block.side,
    [
      offWalls(state, block, clampToApron(block, [from.worldPosition[0], 0, throughLane])),
      offWalls(state, block, clampLaneToApron(block, [laneX, 0, throughLane])),
      // Leaving the plot down the exit driveway and away along the highway.
      [laneX, 0, block.roadLaneZ],
      [block.roadEndX, 0, block.roadLaneZ]
    ],
    { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
    frontageKeepOut(block),
    undefined,
    undefined,
    parkedTruckRects(state)
  );
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

    if (distance > 0.001) {
      // Face the way we are going; the mesh reads this straight off.
      vehicle.heading = Math.atan2(dx, dz);
    }

    if (distance > budget) {
      vehicle.worldPosition = [x + (dx / distance) * budget, y, z + (dz / distance) * budget];
      vehicle.routeProgress = clamp(1 - distance / 40, 0, 1);
      return false;
    }

    // Reached this waypoint; spend what is left on the next leg.
    vehicle.worldPosition = [target[0], y, target[2]];
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
}

/** Collapses every running event into the multipliers the tick needs. */
export function getEventModifiers(state: GameState): EventModifiers {
  const mods: EventModifiers = { traffic: 1, tip: 1, pumpsDisabled: false };

  for (const event of state.activeEvents) {
    if (event.effects.trafficMultiplier) mods.traffic *= event.effects.trafficMultiplier;
    if (event.effects.tipMultiplier) mods.tip *= event.effects.tipMultiplier;
    if (event.effects.pumpsDisabled) mods.pumpsDisabled = true;
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
  notify(effects, tone, config.name, description);
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

  // Roughly one in-day event every few game hours, never the same one twice.
  const candidates = GAME_EVENTS.filter(
    (e) =>
      !e.daily &&
      e.minLevel <= state.player.level &&
      !state.todayEventIds.includes(e.id) &&
      !state.activeEvents.some((a) => a.templateId === e.id)
  );
  if (candidates.length === 0) return;

  const chancePerSecond = 0.0016;
  if (Math.random() < chancePerSecond * dt) {
    const chosen = pickWeightedEvent(candidates);
    if (chosen) triggerEvent(state, chosen, effects);
  }
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

  vehicle.request = {
    mode,
    targetValue,
    calculatedLiters: reservation.reservedLiters,
    calculatedPrice: Number((reservation.reservedLiters * unitPrice).toFixed(2)),
    dispensedLiters: 0,
    isFinished: false,
    reservedLiters: reservation.reservedLiters
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

/** Settles payment, tip, XP, market basket and mission progress for one sale. */
/**
 * Settles a charging session and sends the driver on their way.
 *
 * Electricity is billed off the grid rather than out of a tank, so there is no
 * stock to draw down and no wholesale cost to book against it — the tariff is
 * the margin, which is why the substation and the points are the investment.
 */
export function finalizeCharge(state: GameState, vehicle: VehicleEntity, effects: SimEffects): void {
  const point = vehicle.chargingBuildingId
    ? state.buildings[vehicle.chargingBuildingId]
    : null;
  const fast = point?.type === 'ev_charger_dc';
  const tariff = fast ? GAME_CONFIG.ev.dcPricePerKwh : GAME_CONFIG.ev.acPricePerKwh;

  // The "tank" of an electric car is its battery, in kWh.
  const kwh = vehicle.request.calculatedLiters;
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

  // "Uses the facilities while waiting" was flavour text until now: the shop,
  // the wash and the café never saw a kuruş from a charging customer.
  rollSideServices(state, vehicle, effects);

  trackMissionMetric(state, 'CUSTOMERS_SERVED', 1, effects);
  playCue(effects, 'cash');

  vehicle.chargingBuildingId = null;
  vehicle.chargeSecondsLeft = 0;
  sendAway(state, vehicle);
}

/**
 * Everything else on the forecourt gets its chance at a customer on the way
 * out: the wash, the café, the tyre bay. This is what those buildings are
 * for — and it applies to a driver who charged just as much as to one who
 * fuelled; if anything the EV driver had longer to kill in the shop.
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

  const conf = GAME_CONFIG.customerTypes[vehicle.archetype];
  vehicle.shoppingIntent =
    state.market.active &&
    state.market.stock > 0 &&
    Math.random() < (conf ? conf.marketBaseProbability : 0.2);

  let xpEarned = 20;
  if (serviceScore >= 85) xpEarned += 5;
  state.player.xp += xpEarned;
  applyLevelProgression(state, effects);

  const pump = vehicle.targetPumpId ? state.pumps[vehicle.targetPumpId] : null;
  if (pump) releasePump(pump);
  vehicle.assignedActor = null;
  vehicle.targetPumpId = null;

  // PAYMENT -> OPTIONAL_SHOP -> EXIT, or straight out when not shopping.
  if (vehicle.shoppingIntent) {
    setVehicleState(vehicle, 'OPTIONAL_SHOP');
    vehicle.waitingTimeSeconds = 0;
    vehicle.visitBuildingId = pickVisitBuilding(state, vehicleSide(vehicle));
  } else {
    sendAway(state, vehicle);
  }

  trackMissionMetric(state, 'CUSTOMERS_SERVED', 1, effects);
  trackMissionMetric(state, 'FUEL_LITERS_SOLD', dispensed, effects);
  trackMissionMetric(state, 'FUEL_REVENUE', totalSale, effects);
  trackMissionMetric(state, 'TIPS_EARNED', tip, effects);
  if (served >= 1) playCue(effects, 'cash');
}

/**
 * Which of the side's facilities this customer walks into.
 *
 * Revenue is billed in aggregate, but a customer is one person inside one
 * building — and when the player sells that building out from under them, it
 * is that building's visitor who leaves unserved. Weighted by the same service
 * odds the till uses, so the busy facilities hold the most customers.
 */
function pickVisitBuilding(state: GameState, side: DrivewaySide): string | null {
  const weight = (type: string) =>
    GAME_CONFIG.buildingEffects[type]?.service?.chance ??
    (type === 'mini_market' || type === 'toilet' ? 0.2 : 0);

  const candidates = Object.values(state.buildings).filter(
    (b) => drivewaySideAt(b.position[1]) === side && weight(b.type) > 0
  );
  if (candidates.length === 0) return null;

  let roll = Math.random() * candidates.reduce((sum, b) => sum + weight(b.type), 0);
  for (const b of candidates) {
    roll -= weight(b.type);
    if (roll <= 0) return b.id;
  }
  return candidates[candidates.length - 1].id;
}

/** Rings up the mini-market basket for a customer leaving the shop. */
function completeMarketVisit(
  state: GameState,
  vehicle: VehicleEntity,
  effects: SimEffects
): void {
  const conf = GAME_CONFIG.customerTypes[vehicle.archetype];
  const marketBuilding = Object.values(state.buildings).find((b) => b.type === 'mini_market');
  const levelBonus = marketBuilding
    ? [1, 1, 1.2, 1.45][Math.min(3, marketBuilding.level)] || 1
    : 1;

  const basket = Math.round((conf ? conf.marketAvgBasket : 120) * levelBonus);
  state.market.stock = Math.max(0, state.market.stock - 1);
  state.dayState.todayStats.marketRevenue += basket;
  state.dayState.todayStats.marketCost += basket * 0.65;

  TransactionService.executeCashTransaction(state, {
    type: 'MARKET_SALE',
    amount: basket,
    description: `Market satışı (${conf?.name || 'Müşteri'})`
  });
  trackMissionMetric(state, 'MARKET_SALES', 1, effects);
  playCue(effects, 'cash');
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
  const walls = wallRects(state, block.side, 0, tank.id);
  for (const towards of [inward, -inward]) {
    const berth = clampToApron(block, [x, 0, tank.position[1] + towards * (half + 1.3)]);
    if (!inRects(walls, berth[0], berth[2])) return berth;
  }
  return null;
}

/**
 * Whether anything stands in the lorry's path — a customer car, or another
 * lorry (each lorry is three body points long, nose to tail).
 */
function truckHeldUp(
  state: GameState,
  order: FuelOrderEntity,
  truck: NonNullable<FuelOrderEntity['truck']>
): boolean {
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
    if (!inPath(vehicle.worldPosition[0], vehicle.worldPosition[2], 3.2)) continue;

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

  for (const other of state.fuelOrders) {
    if (other === order || !other.truck) continue;
    const odx = Math.sin(other.truck.heading);
    const odz = Math.cos(other.truck.heading);
    for (const along of [-1.1, 0, 1.1]) {
      const x = other.truck.worldPosition[0] + odx * along;
      const z = other.truck.worldPosition[2] + odz * along;
      if (inPath(x, z, 3.8)) return true;
    }
  }
  return false;
}

/**
 * The traffic on the plot, grown to lorry margins, for steering around. Cars
 * and other lorries alike: a tanker does not drive through either, and a
 * queue it cannot pass it goes around.
 */
function truckObstacleRects(state: GameState, order: FuelOrderEntity): PathRect[] {
  const rects: PathRect[] = [];

  for (const vehicle of Object.values(state.vehicles)) {
    const [x, , z] = vehicle.worldPosition;
    rects.push({ minX: x - 1.2, maxX: x + 1.2, minZ: z - 1.2, maxZ: z + 1.2 });
  }
  for (const other of state.fuelOrders) {
    if (other === order || !other.truck) continue;
    const [x, , z] = other.truck.worldPosition;
    rects.push({ minX: x - 2.2, maxX: x + 2.2, minZ: z - 2.2, maxZ: z + 2.2 });
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
  order: FuelOrderEntity,
  truck: NonNullable<FuelOrderEntity['truck']>,
  dt: number
): boolean {
  if (!truckHeldUp(state, order, truck)) {
    truck.blockedSeconds = 0;
    // Highway pace out on the road; walking pace once it turns onto the plot.
    // A tanker crawling down the carriageway put a thirty-second tail of
    // braking traffic behind it.
    const tank = truck.tankBuildingId ? state.buildings[truck.tankBuildingId] : null;
    const side = tank ? drivewaySideAt(tank.position[1]) : 'near';
    const roadZ = blockLayout(state, side)?.roadLaneZ ?? -3;
    truck.speed = Math.abs(truck.worldPosition[2] - roadZ) < 1.2 ? 0.95 : 0.7;
    return driveToward(truck as unknown as VehicleEntity, dt);
  }

  truck.blockedSeconds = (truck.blockedSeconds ?? 0) + dt;
  if (truck.blockedSeconds < 4) return false;
  truck.blockedSeconds = 0;

  const destination = truck.route[truck.route.length - 1] ?? truck.targetWaypoint;
  if (!destination) return false;

  const tank = truck.tankBuildingId ? state.buildings[truck.tankBuildingId] : null;
  const side = tank ? drivewaySideAt(tank.position[1]) : 'near';
  const block = blockLayout(state, side) ?? blockLayout(state, 'near')!;

  const detoured = routeAroundOrNull(
    state,
    { worldPosition: truck.worldPosition } as VehicleEntity,
    block.side,
    [destination],
    { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
    frontageKeepOut(block),
    undefined,
    truck.tankBuildingId ?? undefined,
    truckObstacleRects(state, order)
  );

  if (detoured) {
    truck.route = detoured.slice(1);
    truck.targetWaypoint = detoured[0] ?? null;
    truck.routeProgress = 0;
  }
  return false;
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
      if (order.remainingSeconds <= 0) {
        // The corner widget carries the routine progress; the toast feed is
        // for things that need the player, and a lorry turning up is not one.
        order.state = setOrderState(order.id, order.state, 'QUEUED_AT_GATE');
        order.remainingSeconds = 0;
      }
      continue;
    }

    if (order.state === 'QUEUED_AT_GATE') {
      const tank = tankBuildingFor(state, order.fuelType);

      // No tank standing for this fuel (an old save, or it was sold while
      // the lorry was on the road): fall back to the timer-only delivery
      // rather than a lorry with nowhere to go.
      if (!tank) {
        const bayBusy = state.fuelOrders.some((o) => o.state === 'UNLOADING');
        if (!bayBusy) {
          order.state = setOrderState(order.id, order.state, 'UNLOADING');
          order.remainingSeconds = order.liters / GAME_CONFIG.economy.tankerUnloadSpeedLps;
        }
        continue;
      }

      const side = drivewaySideAt(tank.position[1]);
      const block = blockLayout(state, side) ?? blockLayout(state, 'near')!;

      if (!order.truck) {
        // One lorry on the plot at a time. Three tankers threading a small
        // forecourt at once locked each other in place for good — the one
        // leaving walled in by the two arriving. The others hold at the gate
        // and the corner widget says so.
        const plotBusy = state.fuelOrders.some((o) => o !== order && o.truck);
        if (plotBusy) continue;

        // Turn off the highway at the entry mouth, then straight up to the
        // back service lane and along it to the bay. The front lane belongs
        // to the customers — a forty-tonner idling on it corks the whole
        // forecourt, which is exactly what it did before this route.
        const bay = tankerBay(state, block, tank, order.fuelType);
        if (!bay) continue;

        const flow = Math.sign(block.roadEndX - block.roadStartX) || 1;
        const start: [number, number, number] = [
          block.roadStartX - flow * 8,
          0,
          block.roadLaneZ
        ];
        const laneX = drivewayLaneX(block.entry, 0);
        const carrier = { worldPosition: start } as VehicleEntity;

        // The back lane is still where a lorry belongs — but "up from the
        // mouth, then along the back" was written as fixed waypoints, and on
        // the starting plot the first of them runs straight through the office.
        // The planner could only answer "no", and the code took a raw
        // straight line instead: that is the lorry the player watched drive
        // over the field and unload inside a building.
        //
        // So the back lane is a preference now, not an instruction. If it
        // cannot be reached, the planner is asked for a way in past the front
        // lane instead, and if there is no way at all the lorry holds at the
        // gate — where the corner widget already says it is waiting, and where
        // moving whatever blocks it is the player's to do. Every branch goes
        // through the planner; none of them may ignore the plot.
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
          tank.id
        );
        const route =
          viaBackLane ??
          driveable(
            state,
            carrier,
            block,
            [[laneX, 0, block.roadLaneZ], [laneX, 0, block.laneZ], bay],
            undefined,
            tank.id
          );
        if (!route) continue;

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
        continue;
      }

      if (order.truck.phase === 'ARRIVING') {
        // A lorry that cannot reach its berth — walled in, or nose to nose
        // with something that will not move — unloads where it stands after
        // a couple of minutes. One tanker at a time is on the plot, so a
        // lorry stuck forever is every later delivery stuck behind it.
        order.truck.onPlotSeconds = (order.truck.onPlotSeconds ?? 0) + dt;
        const gaveUp = order.truck.onPlotSeconds > 120;
        const arrived = advanceTruck(state, order, order.truck, dt) || gaveUp;
        // One hose per tank: a second lorry for the same fuel waits its turn.
        const bayBusy = state.fuelOrders.some(
          (o) => o !== order && o.fuelType === order.fuelType && o.state === 'UNLOADING'
        );
        if (arrived && !bayBusy) {
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
          const route =
            driveable(
              state,
              { worldPosition: from } as VehicleEntity,
              block,
              [
                [from[0], 0, block.exitLaneZ],
                [laneX, 0, block.exitLaneZ],
                [laneX, 0, block.roadLaneZ],
                [block.roadEndX, 0, block.roadLaneZ]
              ],
              undefined,
              order.truck.tankBuildingId ?? undefined
            ) ?? [[laneX, 0, block.roadLaneZ], [block.roadEndX, 0, block.roadLaneZ]];

          order.truck.phase = 'LEAVING';
          order.truck.route = route.slice(1);
          order.truck.targetWaypoint = route[0] ?? null;
        } else {
          state.fuelOrders.splice(i, 1);
        }
      }
      continue;
    }

    if (order.state === 'COMPLETED' && order.truck?.phase === 'LEAVING') {
      // Same for the way out: it does not linger on the plot forever.
      order.truck.onPlotSeconds = (order.truck.onPlotSeconds ?? 0) + dt;
      if (advanceTruck(state, order, order.truck, dt) || order.truck.onPlotSeconds > 240) {
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

/** Ceiling on how many of them the scene carries at once. */
const MAX_ACTIVE_VEHICLES = 14;

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
    'Tedarikçi bir dakikalığına tüm yakıtlarda alış fiyatını indirdi — depoları şimdi doldurun.'
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
    'Yola araç yığıldı — birkaç dakika boyunca çok daha fazla müşteri uğrayacak.'
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
    satisfaction += (effect.satisfaction ?? 0) * weight;

    if (effect.service) {
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
  if (!onSide.some((b) => b.type === 'ev_substation')) return [];

  return onSide
    .filter((b) => b.type === 'ev_charger_ac' || b.type === 'ev_charger_dc')
    .map((b) => ({
      id: b.id,
      kind: b.type === 'ev_charger_dc' ? ('dc' as const) : ('ac' as const),
      position: b.position
    }));
}

/** A charging point on this block with nobody plugged into it. */
function findFreeCharger(
  state: GameState,
  side: DrivewaySide
): { id: string; kind: 'ac' | 'dc'; position: [number, number] } | null {
  const taken = new Set(
    Object.values(state.vehicles)
      .map((v) => v.chargingBuildingId)
      .filter(Boolean) as string[]
  );
  return chargingPoints(state, side).find((point) => !taken.has(point.id)) ?? null;
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
    return chargingPoints(state, side).length === 0;
  }

  const tank = state.tanks[vehicle.fuelType];
  if (!tank || tank.stock - tank.reservedStock < 1) return true;
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

  if (!blockHasWorkingPump(state, side)) {
    return 'Çalışır pompa yok — müşteri bekledi ve ayrıldı. Pompayı onarın.';
  }
  if (tank && tank.stock - tank.reservedStock < 1) {
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

  const hasShop =
    state.market.active &&
    Object.values(state.buildings).some(
      (b) => b.type === 'mini_market' && drivewaySideAt(b.position[1]) === side
    );

  return hasShop ? SHOP_ONLY_APPEAL * facilities : 0;
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
  return clamp(0.3 * appeal * price * reputation * rush, 0, MAX_STOP_RATE);
}

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
 * second carriageway exists.
 */
function pickSpawnSide(state: GameState): DrivewaySide {
  return blockLayout(state, 'far') && Math.random() < 0.5 ? 'far' : 'near';
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
  const anyPumps = Object.keys(state.pumps).length > 0;

  const side = pickSpawnSide(state);
  const block = blockLayout(state, side);
  if (!block) return;

  // An electric customer is only servable where there is somewhere to plug in.
  const canCharge = chargingPoints(state, side).length > 0;

  const servable = (Object.keys(GAME_CONFIG.customerTypes) as VehicleArchetype[]).filter((a) => {
    const conf = GAME_CONFIG.customerTypes[a];
    if (conf.requiresCharger) return canCharge;
    // No pumps anywhere: whoever stops here stops for the shop, and what the
    // pumps cannot dispense is no bar to a coffee.
    if (!anyPumps) return true;
    return conf.preferredFuel === 'any' || sellableFuels.includes(conf.preferredFuel as FuelType);
  });

  // A car cannot materialise where one already is. When the road is backed up
  // to the edge of the map, the next driver simply has not arrived yet.
  const spawnBlocked = Object.values(state.vehicles).some(
    (v) =>
      Math.abs(v.worldPosition[2] - block.roadLaneZ) < FOLLOW_CORRIDOR &&
      Math.abs(v.worldPosition[0] - block.roadStartX) < FOLLOW_DISTANCE * 1.5
  );
  if (spawnBlocked) return;

  // Only a driver this station could actually serve is worth stopping — and
  // only one who could get in. A forecourt walled off by what the player has
  // built has no way through to the bays, and a driver reads that from the
  // road rather than pulling in and finding out.
  const wayIn = canReach(
    state,
    { worldPosition: [block.roadStartX, 0, block.roadLaneZ] } as VehicleEntity,
    side,
    [
      [drivewayLaneX(block.entry, 0), 0, block.laneZ],
      queueSlotPosition(state, 0, side)
    ],
    { minX: block.minX, minZ: block.minZ, maxX: block.maxX, maxZ: block.maxZ },
    frontageKeepOut(block)
  );
  const stops = wayIn && servable.length > 0 && Math.random() < stopChance(state, side);
  const archetypes = stops
    ? servable
    : (Object.keys(GAME_CONFIG.customerTypes) as VehicleArchetype[]).filter(
        (a) => !GAME_CONFIG.customerTypes[a].requiresCharger
      );
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
    const preferred = GAME_CONFIG.customerTypes[a].preferredFuel;
    const index =
      preferred !== 'any' && sellableFuels.includes(preferred as FuelType)
        ? fuelPriceIndex(state, preferred as FuelType)
        : meanIndex;
    return archetypeAppetite(GAME_CONFIG.customerTypes[a].priceSensitivity, index);
  });
  const conf = GAME_CONFIG.customerTypes[archetype];
  const fuelType: FuelType =
    conf.preferredFuel === 'any' || !sellableFuels.includes(conf.preferredFuel as FuelType)
      ? sellableFuels[Math.floor(Math.random() * sellableFuels.length)] ?? 'gasoline'
      : (conf.preferredFuel as FuelType);

  const demand = Math.round(conf.minDemand + Math.random() * (conf.maxDemand - conf.minDemand));
  const tankCapacity = Math.round(demand * (1.25 + Math.random() * 0.35));
  const id = 'veh_' + Math.random().toString(36).substring(2, 8);

  state.vehicles[id] = {
    id,
    archetype,
    fuelType,
    tankCapacity,
    currentFuel: Math.max(0, tankCapacity - demand),
    request: {
      mode: 'FULL',
      targetValue: demand,
      calculatedLiters: demand,
      calculatedPrice: Number((demand * state.pricing[fuelType].playerPrice).toFixed(2)),
      dispensedLiters: 0,
      isFinished: false
    },
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
    speed: 0.85 + Math.random() * 0.3,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };

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

/** Finds a free pump that can serve this vehicle's fuel type. */
function findAvailablePump(
  state: GameState,
  fuelType: FuelType,
  mods: EventModifiers,
  side: DrivewaySide = 'near',
  driver?: VehicleEntity
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
  return ordered.find((pump) => pumpRoute(state, driver, pump) !== null) ?? null;
}

/** The spot alongside an island where a car actually stands to be served. */
function pumpBay(block: BlockLayout, pump: PumpEntity): [number, number, number] {
  const [dx, dz] = pumpBayOffset(block, pump);
  return clampToApron(block, [pump.position[0] + dx, 0, pump.position[1] + dz]);
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
    if (employee.currentVehicleId && !state.vehicles[employee.currentVehicleId]) {
      employee.currentVehicleId = null;
      employee.actionTimerSeconds = 0;
    }
    if (employee.assignedPumpId && !state.pumps[employee.assignedPumpId]) {
      employee.assignedPumpId = null;
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
  const vehicles = Object.values(state.vehicles);

  // Queue order is stable by arrival so slots do not shuffle between ticks,
  // and each block queues on its own concrete rather than sharing a line.
  const queues: Record<DrivewaySide, VehicleEntity[]> = { near: [], far: [] };
  for (const v of vehicles) {
    if (v.state === 'QUEUE') queues[vehicleSide(v)].push(v);
  }
  for (const side of ['near', 'far'] as const) {
    queues[side].sort((a, b) => b.waitingTimeSeconds - a.waitingTimeSeconds);
  }

  for (const vehicle of vehicles) {
    const side = vehicleSide(vehicle);
    const queued = queues[side];
    const block = blockFor(state, vehicle);

    switch (vehicle.state) {
      case 'SPAWN': {
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
        }
        break;
      }

      case 'ROAD_APPROACH': {
        // Decide while still out on the road, not once the car is committed to
        // the mouth. A driver who turns in and only then finds the forecourt
        // full blocks the entrance, and everything behind them stacks up on
        // the carriageway waiting for a gap that cannot open.
        const stillOnRoad = Math.abs(vehicle.worldPosition[2] - block.roadLaneZ) < 1;
        if (
          stillOnRoad &&
          !findAvailablePump(state, vehicle.fuelType, mods, side) &&
          queued.length >= maxQueueLength(state, block)
        ) {
          setVehicleState(vehicle, 'PASSING');
          setRoute(vehicle, [[block.roadEndX, 0, block.roadLaneZ]]);
          turnAway(state);
          break;
        }

        const arrived = driveInTraffic(state, vehicle, block, dt);
        if (isWedged(vehicle)) {
          // Never made it in, so nothing to release — just carry on down the
          // road rather than standing in the entrance blocking it.
          setVehicleState(vehicle, 'PASSING');
          setRoute(vehicle, [[block.roadEndX, 0, block.roadLaneZ]]);
          break;
        }
        if (!arrived) break;

        // A forecourt the player has walled in has no way through to the bays,
        // and forcing a line to them would be a car driving through the wall.
        // The driver turns round at the mouth instead.
        if (!reachable(state, vehicle, block, [queueSlotPosition(state, 0, side)])) {
          sendAway(state, vehicle);
          turnAway(state);
          break;
        }

        // An electric customer wants a socket, not a nozzle.
        if (GAME_CONFIG.customerTypes[vehicle.archetype]?.requiresCharger) {
          const point = findFreeCharger(state, side);
          const toCharger = point ? chargerRoute(state, vehicle, point.position, point.id) : null;
          const toQueue =
            queued.length < maxQueueLength(state, block)
              ? driveable(state, vehicle, block, [
                  queueSlotPosition(state, queued.length, side)
                ])
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
            queued.push(vehicle);
          } else {
            sendAway(state, vehicle);
            turnAway(state);
          }
          break;
        }

        const pump = findAvailablePump(state, vehicle.fuelType, mods, side, vehicle);
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
          vehicle.shoppingIntent = true;
          vehicle.waitingTimeSeconds = 0;
          setVehicleState(vehicle, 'OPTIONAL_SHOP');
          vehicle.visitBuildingId = pickVisitBuilding(state, side);
        } else {
          const joining =
            queued.length < maxQueueLength(state, block)
              ? driveable(state, vehicle, block, [
                  queueSlotPosition(state, queued.length, side)
                ])
              : null;

          if (joining) {
            setVehicleState(vehicle, 'QUEUE');
            setRoute(vehicle, joining);
            queued.push(vehicle);
          } else {
            // Forecourt is full, or walled off — this driver never even stops.
            sendAway(state, vehicle);
            turnAway(state);
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

        const slot = queued.indexOf(vehicle);
        if (slot >= 0) {
          const slotPos = queueSlotPosition(state, slot, side);
          // Judged by where the car is ultimately headed, not by its next
          // waypoint: with something to steer round, the next waypoint is a
          // corner of the way round rather than the slot itself.
          const heading =
            vehicle.route.length > 0
              ? vehicle.route[vehicle.route.length - 1]
              : vehicle.targetWaypoint;

          if (!heading || heading[0] !== slotPos[0] || heading[2] !== slotPos[2]) {
            const shuffleUp = driveable(state, vehicle, block, [slotPos]);
            // No way to the slot it has been given: better to stay where it is
            // than to shuffle forward through a wall.
            if (shuffleUp) setRoute(vehicle, shuffleUp);
          }

          // Standing at the slot, straighten out along the lane. Cars arrive
          // at whatever angle their last swerve left them on, and a queue of
          // them frozen mid-turn reads as chaos, not a queue.
          const parked =
            !vehicle.targetWaypoint &&
            Math.hypot(
              vehicle.worldPosition[0] - slotPos[0],
              vehicle.worldPosition[2] - slotPos[2]
            ) < 0.8;
          if (parked) {
            const laneHeading = block.roadEndX > block.roadStartX ? Math.PI / 2 : -Math.PI / 2;
            const turn =
              ((laneHeading - vehicle.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            vehicle.heading += turn * Math.min(1, dt * 2.5);
          }
        }

        // Only the head of the queue may claim a point that has come free.
        if (slot === 0 && GAME_CONFIG.customerTypes[vehicle.archetype]?.requiresCharger) {
          const point = findFreeCharger(state, side);
          const toPost = point ? chargerRoute(state, vehicle, point.position, point.id) : null;
          if (point && toPost) {
            vehicle.chargingBuildingId = point.id;
            vehicle.chargeSecondsLeft =
              point.kind === 'dc'
                ? GAME_CONFIG.ev.dcChargeSeconds
                : GAME_CONFIG.ev.acChargeSeconds;
            setVehicleState(vehicle, 'PUMP_RESERVED');
            setRoute(vehicle, toPost);
            queued.shift();
          }
          break;
        }

        if (slot === 0) {
          const pump = findAvailablePump(state, vehicle.fuelType, mods, side, vehicle);
          if (pump && reservePumpFor(state, vehicle, pump)) {
            queued.shift();
          }
        }
        break;
      }

      case 'PUMP_RESERVED': {
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

        // Charging needs nobody's attention: the driver plugs in and waits —
        // unless the post has been sold, or the substation feeding it has,
        // which is the one thing that sends a plugged-in customer away
        // unserved.
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
          vehicle.chargeSecondsLeft = (vehicle.chargeSecondsLeft ?? 0) - dt;
          if (vehicle.chargeSecondsLeft <= 0) finalizeCharge(state, vehicle, effects);
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
        // The player drives their own dispensing from the fueling modal.
        if (vehicle.assignedActor === 'PLAYER') vehicle.patience -= dt * 0.25;
        break;
      }

      case 'PAYMENT': {
        // Employee-served customers settle up automatically; player sales are
        // finalized from the modal.
        if (vehicle.assignedActor !== 'PLAYER') finalizeSale(state, vehicle, effects);
        break;
      }

      case 'OPTIONAL_SHOP': {
        // The building they are inside can be sold or carted off around them.
        // The one exception is an upgrade: a café absorbed into a rest complex
        // is still open — the coffee moves with it.
        if (vehicle.visitBuildingId && !state.buildings[vehicle.visitBuildingId]) {
          const complex = Object.values(state.buildings).find(
            (b) => b.type === 'rest_complex' && drivewaySideAt(b.position[1]) === side
          );
          if (complex) {
            vehicle.visitBuildingId = complex.id;
          } else {
            loseCustomer(
              state,
              vehicle,
              'Kullandığı tesis kaldırıldı — müşteri hizmet alamadan ayrıldı.',
              effects
            );
            break;
          }
        }

        vehicle.waitingTimeSeconds += dt;
        if (vehicle.waitingTimeSeconds >= 6) {
          completeMarketVisit(state, vehicle, effects);
          vehicle.visitBuildingId = null;
          sendAway(state, vehicle);
        }
        break;
      }

      case 'EXIT': {
        // This customer is already counted; letting a wedged one sit on the
        // forecourt only blocks the cars still trying to be served.
        if (isWedged(vehicle) || driveInTraffic(state, vehicle, block, dt)) {
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
      employee.actionTimerSeconds -= dt;
      if (employee.actionTimerSeconds <= 0) {
        const started = beginFueling(
          state,
          vehicle,
          'FULL',
          vehicle.request.calculatedLiters,
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

function tickStationCondition(state: GameState, dt: number, effects: SimEffects): void {
  // Idle grime accumulates slowly across the whole forecourt.
  state.station.cleanliness = clamp(state.station.cleanliness - 0.035 * dt, 0, 100);

  for (const pump of Object.values(state.pumps)) {
    if (pump.state === 'BROKEN' || pump.state === 'MAINTENANCE') continue;

    pump.health = Math.max(0, pump.health - PUMP_AGEING_PER_SECOND * dt);

    // Level 3 hardware is markedly more reliable (GDD: -%25 arıza riski).
    const reliability = pump.level >= 3 ? 0.75 : 1;
    if (pump.health <= 0) {
      setPumpState(pump, 'BROKEN');
      pump.currentVehicleId = null;
      notify(
        effects,
        'CRITICAL',
        'Pompa Arızalandı!',
        `${pump.id} tamamen devre dışı kaldı. Bakım yaparak tekrar hizmete alın.`
      );
      continue;
    }

    if (pump.health < 25 && Math.random() < 0.004 * reliability * dt) {
      setPumpState(pump, 'BROKEN');
      pump.currentVehicleId = null;
      notify(
        effects,
        'CRITICAL',
        'Pompa Arızalandı!',
        `${pump.id} aşırı yıpranma nedeniyle durdu. Bakım gerekiyor.`
      );
    }
  }
}

function tickManagerAutomation(state: GameState, dt: number, effects: SimEffects): void {
  if (!state.station.managerId) return;
  const settings = state.managerSettings;

  const estimatedWages = Object.values(state.employees).reduce((sum, e) => sum + e.wage, 0);
  const dueInstallments = state.loans
    .filter((l) => l.state === 'ACTIVE')
    .reduce((sum, l) => sum + Math.min(l.dailyPayment, l.remaining), 0);
  const budget = calculateManagerAvailableBudget(
    state.player.cash,
    settings.kasaReserve,
    dueInstallments,
    estimatedWages
  );

  const logAction = (
    category: 'FUEL_ORDER' | 'PRICING' | 'STAFF' | 'MAINTENANCE' | 'ALERT',
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

  if (settings.autoFuelOrder) {
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
    }
  }

  if (settings.autoPricing) {
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

  if (settings.autoAssignAttendants) {
    const idlePumps = Object.values(state.pumps).filter(
      (p) => p.state !== 'BROKEN' && !Object.values(state.employees).some((e) => e.assignedPumpId === p.id)
    );
    for (const employee of Object.values(state.employees)) {
      if (employee.role !== 'PUMP_ATTENDANT' || employee.assignedPumpId) continue;
      const pump = idlePumps.shift();
      if (!pump) break;
      employee.assignedPumpId = pump.id;
      logAction('STAFF', `${employee.name} boştaki ${pump.id} pompasına atandı.`, 'SUCCESS');
    }
  }

  if (settings.autoMaintenanceAlert) {
    for (const pump of Object.values(state.pumps)) {
      if (pump.health >= settings.minHealthThreshold) continue;
      const alreadyWarned = state.managerLogs.some(
        (l) => l.category === 'MAINTENANCE' && l.reason.includes(pump.id)
      );
      if (alreadyWarned) continue;

      logAction('MAINTENANCE', `${pump.id} sağlığı %${pump.health.toFixed(0)} seviyesine düştü.`, 'SUCCESS');
      notify(
        effects,
        'WARNING',
        'Bakım Uyarısı',
        `${pump.id} sağlığı %${pump.health.toFixed(0)}. Arızalanmadan önce bakım yapın.`
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Shared order placement (used by the player and the manager alike)   */
/* ------------------------------------------------------------------ */

export function placeFuelOrder(
  state: GameState,
  fuelType: FuelType,
  liters: number,
  effects: SimEffects
): boolean {
  const conf = GAME_CONFIG.fuels[fuelType];
  const tank = state.tanks[fuelType];

  if (!conf || !tank || tank.capacity <= 0) {
    notify(effects, 'WARNING', 'Tank Bulunmuyor', `${fuelType} tankı henüz inşa edilmedi!`);
    return false;
  }

  const freeCapacity = tank.capacity - tank.stock;
  if (liters > freeCapacity) {
    notify(
      effects,
      'WARNING',
      'Kapasite Yetersiz',
      `Sipariş boş kapasiteyi (${freeCapacity.toFixed(0)} L) aşamaz.`
    );
    return false;
  }

  const unitCost = wholesaleNow(state, fuelType);
  const totalCost = liters * unitCost + conf.deliveryFee;

  const tx = TransactionService.executeCashTransaction(state, {
    type: 'FUEL_ORDER',
    amount: -totalCost,
    description: `${liters} L ${conf.name} tanker siparişi`
  });
  if (!tx.success) {
    notify(effects, 'WARNING', 'Yetersiz Bakiye', tx.error || 'Sipariş tutarı kasayı aşıyor.');
    return false;
  }

  const duration = Math.floor(
    GAME_CONFIG.economy.tankerSpeedSecondsMin +
      Math.random() *
        (GAME_CONFIG.economy.tankerSpeedSecondsMax - GAME_CONFIG.economy.tankerSpeedSecondsMin)
  );

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
    transactionId: tx.transactionId
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
  tickFuelOrders(state, dt, effects);
  tickRush(state, dt, effects);
  tickFuelDeal(state, dt, effects);
  trySpawnVehicle(state, dt, mods);
  const vehicleSteps = Math.max(1, Math.ceil(dt / MAX_VEHICLE_STEP));
  for (let step = 0; step < vehicleSteps; step++) {
    tickVehicles(state, dt / vehicleSteps, effects, mods);
  }
  tickEmployees(state, dt, effects);
  tickStationCondition(state, dt, effects);
  tickManagerAutomation(state, dt, effects);
}
