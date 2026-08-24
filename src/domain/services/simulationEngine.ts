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
  FuelType,
  VehicleArchetype,
  VehicleState,
  PumpState,
  OrderState,
  EmployeeState,
  MissionMetric,
  MissionEntity,
  ActiveGameEvent
} from '../types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
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

export type SoundCue =
  | 'click'
  | 'cash'
  | 'alert'
  | 'levelUp'
  | 'pumpStart'
  | 'fuelTick'
  | 'buildPlace';

export interface SimEffects {
  notifications: Array<Omit<GameNotification, 'id' | 'timestamp'>>;
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

/** Frees a pump back to IDLE, walking the RELEASE step when the machine needs it. */
export function releasePump(pump: PumpEntity): void {
  pump.currentVehicleId = null;
  if (pump.state === 'BROKEN' || pump.state === 'MAINTENANCE') return;
  if (!setPumpState(pump, 'IDLE')) {
    setPumpState(pump, 'RELEASE');
    setPumpState(pump, 'IDLE');
  }
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
  /** Half the carriageway width before the road is widened, in grid units. */
  roadHalfWidth: 2.2,
  /** Half-width once the road becomes a dual carriageway. */
  roadHalfWidthWide: 3.4,
  /** Where cars appear and disappear along the highway. */
  roadStartX: -12,
  /** Wide enough that a truck in the queue does not overlap the car behind. */
  queueSpacing: 3.4,
  /**
   * How far inside the concrete a parked vehicle must stay. Half a vehicle
   * length plus a little, so no bodywork overhangs the apron edge.
   */
  apronMargin: 2.5
} as const;

/**
 * Lane and driveway positions, derived from the plot the player owns rather
 * than hard-coded. Buying land therefore moves the exit and lengthens the
 * queue without anything else needing to know.
 */
export interface PlotLayout {
  entryX: number;
  exitX: number;
  laneZ: number;
  exitLaneZ: number;
  queueHeadX: number;
  roadEndX: number;
}

export function getLayout(state: {
  station: { plots: { width: number; height: number } };
}): PlotLayout {
  const { width, height } = state.station.plots;

  return {
    entryX: 3,
    exitX: Math.max(6, width - 3),
    // The circulation lane hugs the road; the return lane runs along the back.
    laneZ: 4,
    exitLaneZ: Math.max(7, height - 3),
    queueHeadX: Math.max(6, Math.min(width - 5, 12)),
    roadEndX: width + 12
  };
}

/** How far to the side of a pump a vehicle parks, in grid units. */
export const PUMP_BAY_OFFSET = 1.4;

const MAX_ACTIVE_VEHICLES = 14;
const BASE_DRIVE_SPEED = 3.6; // grid units per game-second

/**
 * Keeps a forecourt waypoint on the concrete. Highway legs deliberately sit
 * outside the plot and never go through here.
 */
function clampToApron(
  state: GameState,
  point: [number, number, number]
): [number, number, number] {
  const margin = LAYOUT.apronMargin;
  const maxX = state.station.plots.width - margin;
  const maxZ = state.station.plots.height - margin;

  return [
    clamp(point[0], margin, Math.max(margin, maxX)),
    point[1],
    clamp(point[2], margin, Math.max(margin, maxZ))
  ];
}

/**
 * How many cars fit in the queue lane without the tail running off the
 * concrete. Derived from the plot so widening the station lengthens the queue.
 */
function maxQueueLength(state: GameState): number {
  const layout = getLayout(state);
  const usable = layout.queueHeadX - LAYOUT.apronMargin;
  return Math.max(1, Math.min(5, Math.floor(usable / LAYOUT.queueSpacing) + 1));
}

export function queueSlotPosition(state: GameState, index: number): [number, number, number] {
  const layout = getLayout(state);
  return clampToApron(state, [
    layout.queueHeadX - index * LAYOUT.queueSpacing,
    0,
    layout.laneZ
  ]);
}

/** Highway -> entrance driveway -> circulation lane. */
function approachRoute(state: GameState): Array<[number, number, number]> {
  const layout = getLayout(state);
  return [
    [layout.entryX, 0, LAYOUT.roadZ],
    [layout.entryX, 0, layout.laneZ]
  ];
}

/**
 * Circulation lane -> the bay beside the pump. The lateral offset is part of
 * the route rather than a rendering trick, so the car drives to the spot it
 * will actually occupy instead of snapping sideways on arrival.
 */
function pumpRoute(
  state: GameState,
  pump: PumpEntity
): Array<[number, number, number]> {
  const layout = getLayout(state);
  const bay = clampToApron(state, [pump.position[0] + PUMP_BAY_OFFSET, 0, pump.position[1]]);
  return [
    [bay[0], 0, layout.laneZ],
    bay
  ];
}

/** Pump -> return lane -> exit driveway -> off down the highway. */
function exitRoute(
  state: GameState,
  from: VehicleEntity
): Array<[number, number, number]> {
  const layout = getLayout(state);
  return [
    clampToApron(state, [from.worldPosition[0], 0, layout.exitLaneZ]),
    clampToApron(state, [layout.exitX, 0, layout.exitLaneZ]),
    // Leaving the plot down the exit driveway and away along the highway.
    [layout.exitX, 0, LAYOUT.roadZ],
    [layout.roadEndX, 0, LAYOUT.roadZ]
  ];
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
    isFinished: false
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

  const remaining = vehicle.request.calculatedLiters - vehicle.request.dispensedLiters;
  vehicle.request.dispensedLiters += Math.min(remaining, flowRate * deltaSeconds);
  playCue(effects, 'fuelTick');

  // Pumping wears the hardware down.
  if (pump) pump.health = Math.max(0, pump.health - 0.03 * deltaSeconds);

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

  const speedRatio = clamp((vehicle.patience / vehicle.maxPatience) * 100, 0, 100);
  const accuracy = vehicle.request.isFinished ? 100 : 80;
  const serviceScore = calculateServiceScore(speedRatio, accuracy, state.station.cleanliness);
  const mods = getEventModifiers(state);
  const tip = Math.round(
    calculateCustomerTip(totalSale, serviceScore, vehicle.archetype) * mods.tip
  );

  vehicle.satisfaction = serviceScore;

  TransactionService.executeCashTransaction(state, {
    type: 'FUEL_SALE',
    amount: totalSale + tip,
    description: `${vehicle.archetype.toUpperCase()} - ${dispensed.toFixed(1)} L ${vehicle.fuelType} satışı${tip > 0 ? ` (+${tip} TL bahşiş)` : ''}`
  });

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
  state.station.cleanliness = clamp(
    state.station.cleanliness - (hasTrashCan ? 0.21 : 0.3),
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
  } else {
    setVehicleState(vehicle, 'EXIT');
    setRoute(vehicle, exitRoute(state, vehicle));
  }

  trackMissionMetric(state, 'CUSTOMERS_SERVED', 1, effects);
  trackMissionMetric(state, 'FUEL_LITERS_SOLD', dispensed, effects);
  trackMissionMetric(state, 'FUEL_REVENUE', totalSale, effects);
  trackMissionMetric(state, 'TIPS_EARNED', tip, effects);
  if (served >= 1) playCue(effects, 'cash');
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

function tickFuelOrders(state: GameState, dt: number, effects: SimEffects): void {
  for (let i = state.fuelOrders.length - 1; i >= 0; i--) {
    const order = state.fuelOrders[i];

    if (order.state === 'TRAVELLING') {
      order.remainingSeconds -= dt;
      if (order.remainingSeconds <= 0) {
        order.state = setOrderState(order.id, order.state, 'QUEUED_AT_GATE');
        order.remainingSeconds = 0;
        notify(
          effects,
          'INFO',
          'Tanker Kapıda',
          `${order.liters} L ${order.fuelType} tankeri istasyona ulaştı, boşaltım sırası bekliyor.`
        );
      }
      continue;
    }

    if (order.state === 'QUEUED_AT_GATE') {
      // Only one tanker may occupy the unloading bay at a time.
      const bayBusy = state.fuelOrders.some((o) => o.state === 'UNLOADING');
      if (!bayBusy) {
        order.state = setOrderState(order.id, order.state, 'UNLOADING');
        order.remainingSeconds = order.liters / GAME_CONFIG.economy.tankerUnloadSpeedLps;
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
        notify(
          effects,
          'INFO',
          'Tanker Boşaltımı Tamamlandı',
          `${res.addedLiters.toFixed(0)} L ${order.fuelType} tanka aktarıldı.` +
            (res.refundedLiters > 0
              ? ` ${res.refundedLiters.toFixed(0)} L tank dolduğu için iade edildi.`
              : '')
        );
        state.fuelOrders.splice(i, 1);
      }
    }
  }
}

function trySpawnVehicle(state: GameState, dt: number, mods: EventModifiers): void {
  const vehicleCount = Object.keys(state.vehicles).length;
  if (vehicleCount >= MAX_ACTIVE_VEHICLES || !state.station.open) return;

  const hourlyMult = calculateHourlyTrafficMultiplier(state.dayState.gameTime);
  const repMult = calculateReputationTrafficMultiplier(state.player.reputation);
  const priceAttr = calculatePriceAttractiveness(
    state.pricing.gasoline.playerPrice,
    state.pricing.gasoline.regionalAverage
  ).attractiveness;
  const weatherMult =
    state.dayState.weather === 'RAIN' ? 0.78 : state.dayState.weather === 'OVERCAST' ? 0.92 : 1;

  const spawnChancePerSec =
    0.15 * hourlyMult * repMult * priceAttr * weatherMult * mods.traffic;
  if (Math.random() >= spawnChancePerSec * dt) return;

  // Only offer archetypes whose fuel we can actually sell.
  const sellableFuels = (Object.keys(state.tanks) as FuelType[]).filter(
    (f) => state.tanks[f].capacity > 0
  );
  if (sellableFuels.length === 0) return;

  const archetypes = (Object.keys(GAME_CONFIG.customerTypes) as VehicleArchetype[]).filter((a) => {
    const conf = GAME_CONFIG.customerTypes[a];
    // Electric cars wait for the charging system; there is nothing to serve
    // them with yet.
    if (conf.requiresCharger) return false;
    return conf.preferredFuel === 'any' || sellableFuels.includes(conf.preferredFuel as FuelType);
  });
  if (archetypes.length === 0) return;

  const archetype = archetypes[Math.floor(Math.random() * archetypes.length)];
  const conf = GAME_CONFIG.customerTypes[archetype];
  const fuelType: FuelType =
    conf.preferredFuel === 'any'
      ? sellableFuels[Math.floor(Math.random() * sellableFuels.length)]
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
    patience: conf.basePatienceSeconds,
    maxPatience: conf.basePatienceSeconds,
    satisfaction: 100,
    state: 'SPAWN',
    targetPumpId: null,
    assignedActor: null,
    worldPosition: [LAYOUT.roadStartX, 0, LAYOUT.roadZ],
    targetWaypoint: null,
    route: [],
    heading: Math.PI / 2,
    speed: 0.85 + Math.random() * 0.3,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
}

/** Finds a free pump that can serve this vehicle's fuel type. */
function findAvailablePump(
  state: GameState,
  fuelType: FuelType,
  mods: EventModifiers
): PumpEntity | null {
  if (mods.pumpsDisabled) return null;

  const candidates = Object.values(state.pumps).filter(
    (p) => p.state === 'IDLE' && !p.currentVehicleId && p.supportedFuels.includes(fuelType)
  );
  if (candidates.length === 0) return null;
  // Prefer the healthiest pump so worn hardware naturally rotates out of service.
  return candidates.sort((a, b) => b.health - a.health)[0];
}

function reservePumpFor(state: GameState, vehicle: VehicleEntity, pump: PumpEntity): void {
  pump.currentVehicleId = vehicle.id;
  setPumpState(pump, 'RESERVED');
  vehicle.targetPumpId = pump.id;
  setRoute(vehicle, pumpRoute(state, pump));
  setVehicleState(vehicle, 'PUMP_RESERVED');
  setPumpState(pump, 'VEHICLE_ARRIVING');
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
  if (vehicle.request.calculatedLiters > vehicle.request.dispensedLiters) {
    TransactionService.releaseFuelReservation(
      state,
      vehicle.fuelType,
      vehicle.request.calculatedLiters - vehicle.request.dispensedLiters
    );
  }

  vehicle.assignedActor = null;
  setVehicleState(vehicle, 'EXIT');
  setRoute(vehicle, exitRoute(state, vehicle));

  notify(effects, 'WARNING', 'Müşteri Kaybedildi!', `${reason} (-0.015 İtibar)`);
}

function tickVehicles(
  state: GameState,
  dt: number,
  effects: SimEffects,
  mods: EventModifiers
): void {
  const vehicles = Object.values(state.vehicles);

  // Queue order is stable by arrival so slots do not shuffle between ticks.
  const queued = vehicles
    .filter((v) => v.state === 'QUEUE')
    .sort((a, b) => b.waitingTimeSeconds - a.waitingTimeSeconds);

  for (const vehicle of vehicles) {
    switch (vehicle.state) {
      case 'SPAWN': {
        setVehicleState(vehicle, 'ROAD_APPROACH');
        setRoute(vehicle, approachRoute(state));
        break;
      }

      case 'ROAD_APPROACH': {
        const arrived = driveToward(vehicle, dt);
        if (!arrived) break;

        const pump = findAvailablePump(state, vehicle.fuelType, mods);
        if (pump) {
          reservePumpFor(state, vehicle, pump);
        } else if (queued.length < maxQueueLength(state)) {
          setVehicleState(vehicle, 'QUEUE');
          setRoute(vehicle, [queueSlotPosition(state, queued.length)]);
          queued.push(vehicle);
        } else {
          // Forecourt is full — this driver never even stops.
          setVehicleState(vehicle, 'EXIT');
          setRoute(vehicle, exitRoute(state, vehicle));
          state.dayState.todayStats.customersLost++;
          state.player.statistics.totalCustomersLost++;
        }
        break;
      }

      case 'QUEUE': {
        driveToward(vehicle, dt);
        vehicle.waitingTimeSeconds += dt;
        vehicle.patience -= dt;

        if (vehicle.patience <= 0) {
          loseCustomer(state, vehicle, 'Kuyrukta bekleyen müşteri sabrını yitirdi.', effects);
          break;
        }

        const slot = queued.indexOf(vehicle);
        if (slot >= 0) {
          const slotPos = queueSlotPosition(state, slot);
          if (!vehicle.targetWaypoint || vehicle.targetWaypoint[0] !== slotPos[0]) {
            setRoute(vehicle, [slotPos]);
          }
        }

        // Only the head of the queue may claim a freed pump.
        if (slot === 0) {
          const pump = findAvailablePump(state, vehicle.fuelType, mods);
          if (pump) {
            reservePumpFor(state, vehicle, pump);
            queued.shift();
          }
        }
        break;
      }

      case 'PUMP_RESERVED': {
        if (driveToward(vehicle, dt)) {
          setVehicleState(vehicle, 'AT_PUMP');
          const pump = vehicle.targetPumpId ? state.pumps[vehicle.targetPumpId] : null;
          if (pump) setPumpState(pump, 'REQUEST_READY');
        }
        vehicle.patience -= dt * 0.5; // waiting is gentler while rolling up
        break;
      }

      case 'AT_PUMP':
      case 'REQUEST': {
        vehicle.waitingTimeSeconds += dt;
        vehicle.patience -= dt;
        if (vehicle.patience <= 0) {
          loseCustomer(state, vehicle, 'Pompada hizmet bekleyen müşteri ayrıldı.', effects);
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
        vehicle.waitingTimeSeconds += dt;
        if (vehicle.waitingTimeSeconds >= 6) {
          completeMarketVisit(state, vehicle, effects);
          setVehicleState(vehicle, 'EXIT');
          setRoute(vehicle, exitRoute(state, vehicle));
        }
        break;
      }

      case 'EXIT': {
        if (driveToward(vehicle, dt)) {
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

function tickStationCondition(state: GameState, dt: number, effects: SimEffects): void {
  // Idle grime accumulates slowly across the whole forecourt.
  state.station.cleanliness = clamp(state.station.cleanliness - 0.02 * dt, 0, 100);

  for (const pump of Object.values(state.pumps)) {
    if (pump.state === 'BROKEN' || pump.state === 'MAINTENANCE') continue;

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
    const hour = Math.floor(state.dayState.gameTime);
    const minute = Math.floor((state.dayState.gameTime - hour) * 60);
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
    for (const fuelType of Object.keys(state.tanks) as FuelType[]) {
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

  const unitCost = state.pricing[fuelType].todayWholesaleCost;
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
  notify(
    effects,
    'INFO',
    'Tanker Yola Çıktı',
    `${liters} L ${conf.shortName} tankeri ${duration} sn içinde istasyona ulaşacak.`
  );
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

  const hoursPerSecond = 16 / GAME_CONFIG.economy.realSecondsPerDay;
  state.dayState.gameTime += dt * hoursPerSecond;

  if (state.dayState.gameTime >= GAME_CONFIG.economy.dayEndHour) {
    state.dayState.gameTime = GAME_CONFIG.economy.dayEndHour;
    state.dayState.isDayEnding = true;
    effects.dayEnded = true;
    return;
  }

  tickEvents(state, dt * hoursPerSecond, dt, effects);
  const mods = getEventModifiers(state);

  tickFuelOrders(state, dt, effects);
  trySpawnVehicle(state, dt, mods);
  tickVehicles(state, dt, effects, mods);
  tickEmployees(state, dt, effects);
  tickStationCondition(state, dt, effects);
  tickManagerAutomation(state, dt, effects);
}
