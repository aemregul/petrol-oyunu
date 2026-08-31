/**
 * Project Highway - GameState & Entity Interfaces (v1.0.0)
 * Sourced directly from GDD Section 27
 */

export type FuelType = 'gasoline' | 'diesel' | 'lpg';

export type VehicleArchetype = 'commuter' | 'family' | 'taxi' | 'courier' | 'commercial' | 'truck' | 'luxury' | 'ev';

export type VehicleState =
  | 'SPAWN'
  /** Driving straight past: this one never had any reason to pull in. */
  | 'PASSING'
  | 'ROAD_APPROACH'
  | 'QUEUE'
  | 'PUMP_RESERVED'
  | 'AT_PUMP'
  | 'REQUEST'
  | 'FUELING'
  | 'PAYMENT'
  | 'OPTIONAL_SHOP'
  | 'EXIT'
  | 'DESPAWN';

export type PumpState =
  | 'IDLE'
  | 'RESERVED'
  | 'VEHICLE_ARRIVING'
  | 'REQUEST_READY'
  | 'FUELING'
  | 'PAYMENT'
  | 'RELEASE'
  | 'MAINTENANCE'
  | 'BROKEN';

export type EmployeeRole = 'PUMP_ATTENDANT' | 'MANAGER';

export type EmployeeState =
  | 'UNASSIGNED'
  | 'IDLE'
  | 'SELECT_JOB'
  | 'MOVING'
  | 'PREPARE'
  | 'FUELING'
  | 'PAYMENT'
  | 'RETURN_IDLE';

export type OrderState = 'TRAVELLING' | 'QUEUED_AT_GATE' | 'UNLOADING' | 'COMPLETED';

export type LoanState = 'ACTIVE' | 'PAID_OFF' | 'RESTRUCTURED';

export interface PlayerState {
  id: string;
  level: number;
  xp: number;
  cash: number;
  reputation: number; // 1.00 - 5.00
  statistics: {
    totalFuelSoldLiters: number;
    totalRevenue: number;
    totalCustomersServed: number;
    totalCustomersLost: number;
    totalTips: number;
    daysCompleted: number;
    cleanActionsCount: number;
    repairActionsCount: number;
    /** Net profit of the last three completed days, oldest first. */
    recentNetProfits?: number[];
  };
  unlocks: string[];
}

export interface FuelTankEntity {
  id: string;
  fuelType: FuelType;
  level: number;
  capacity: number; // 1500, 3000, 6000
  stock: number;
  reservedStock: number;
  averageCost: number; // Ağırlıklı ortalama alış maliyeti (TL/L)
  health: number; // 0 - 100
}

export interface FuelPricingState {
  fuelType: FuelType;
  playerPrice: number;
  todayWholesaleCost: number;
  regionalAverage: number;
  priceStrategy: 'CHEAP' | 'BALANCED' | 'HIGH_MARGIN' | 'CUSTOM';
}

export interface PumpEntity {
  id: string;
  level: number;
  position: [number, number]; // Grid [x, z]
  rotation: 0 | 90 | 180 | 270;
  supportedFuels: FuelType[];
  state: PumpState;
  health: number; // 0 - 100
  employeeId: string | null;
  currentVehicleId: string | null;
  flowRateLps: number; // 8, 10, 13 L/s
}

export interface VehicleEntity {
  id: string;
  archetype: VehicleArchetype;
  fuelType: FuelType;
  tankCapacity: number;
  currentFuel: number;
  request: {
    mode: 'LITERS' | 'MONEY' | 'FULL';
    targetValue: number;
    calculatedLiters: number;
    calculatedPrice: number;
    dispensedLiters: number;
    isFinished: boolean;
    /**
     * Litres actually held against the tank right now. Zero until fueling
     * begins: `calculatedLiters` before that is only what the driver intends
     * to buy, and releasing an intention would eat somebody else's hold.
     */
    reservedLiters?: number;
  };
  patience: number;
  maxPatience: number;
  satisfaction: number; // 0 - 100
  state: VehicleState;
  targetPumpId: string | null;
  assignedActor: 'PLAYER' | 'EMPLOYEE' | null;
  worldPosition: [number, number, number]; // [x, y, z]
  targetWaypoint: [number, number, number] | null;
  /** Remaining waypoints of the current leg; targetWaypoint is route[0]. */
  route: Array<[number, number, number]>;
  /** Facing in radians, derived from the direction of travel. */
  heading: number;
  speed: number;
  routeProgress: number;
  waitingTimeSeconds: number;
  /**
   * How long this driver has been held up by the car in front. Nothing may
   * wait for ever, so past a few seconds they edge past whatever is in the way.
   */
  blockedSeconds?: number;
  /** Charging point this driver is plugged into, for electric customers. */
  chargingBuildingId?: string | null;
  /**
   * The facility an OPTIONAL_SHOP customer is actually inside. The till bills
   * the parade in aggregate, but the person is standing in one building — and
   * if the player sells that building, it is this visitor who storms off.
   */
  visitBuildingId?: string | null;
  /** Seconds of charging still to go. */
  chargeSecondsLeft?: number;
  /**
   * How long this driver has been stood at a bay that cannot serve them. They
   * take a moment to work it out, then leave — they do not queue for fuel that
   * is not there.
   */
  noServiceSeconds?: number;
  shoppingIntent: boolean;
}

export interface EmployeeEntity {
  id: string;
  name: string;
  role: EmployeeRole;
  level: number;
  wage: number;
  assignedPumpId: string | null;
  state: EmployeeState;
  serviceCount: number;
  currentVehicleId: string | null;
  actionTimerSeconds: number;
  worldPosition: [number, number, number];
}

export interface BuildingEntity {
  /**
   * Set once the player has picked a fixed structure up and put it somewhere
   * of their own choosing. From then on the layout stops deciding for them.
   */
  movedByPlayer?: boolean;
  id: string;
  type: string;
  level: number;
  position: [number, number]; // Grid [x, z]
  rotation: 0 | 90 | 180 | 270;
  size: [number, number];
  health: number;
  constructionState: 'CONSTRUCTING' | 'ACTIVE';
  builtAtTimestamp: number;
}

export interface FuelOrderEntity {
  id: string;
  fuelType: FuelType;
  liters: number;
  unitCost: number;
  deliveryFee: number;
  totalCost: number;
  totalDurationSeconds: number;
  remainingSeconds: number;
  state: OrderState;
  transactionId: string;
}

export interface LoanEntity {
  id: string;
  productId: string;
  name: string;
  principal: number;
  totalDue: number;
  remaining: number;
  dailyPayment: number;
  missedCount: number;
  state: LoanState;
}

/** What a mission counts. Progress is fed by trackMissionMetric(). */
export type MissionMetric =
  | 'CUSTOMERS_SERVED'
  | 'FUEL_LITERS_SOLD'
  | 'FUEL_REVENUE'
  | 'TIPS_EARNED'
  | 'MARKET_SALES'
  | 'ORDERS_PLACED'
  | 'PRICE_SET'
  | 'BUILD_PLACED'
  | 'DAYS_COMPLETED'
  | 'PUMPS_REPAIRED'
  | 'STATION_CLEANED';

export interface MissionEntity {
  id: string;
  templateId: string;
  type: 'TUTORIAL' | 'DAILY_NORMAL' | 'DAILY_MAIN';
  description: string;
  metric: MissionMetric;
  target: number;
  progress: number;
  rewardCash: number;
  rewardXp: number;
  completed: boolean;
  claimed: boolean;
  /** Day this mission was issued; daily missions expire at the next day roll. */
  issuedOnDay: number;
}

export type GameEventCategory = 'ECONOMY' | 'TRAFFIC' | 'INCIDENT' | 'OPPORTUNITY';

export interface GameEventEffects {
  /** Feeds the olayEtkisi term of the daily wholesale price formula. */
  wholesalePriceModifier?: number;
  trafficMultiplier?: number;
  tipMultiplier?: number;
  /** One-shot deltas applied the moment the event fires. */
  reputationDelta?: number;
  cashDelta?: number;
  cleanlinessDelta?: number;
  pumpHealthDelta?: number;
  /** Pumps cannot serve while this event is active. */
  pumpsDisabled?: boolean;
}

export interface ActiveGameEvent {
  id: string;
  templateId: string;
  name: string;
  description: string;
  category: GameEventCategory;
  icon: string;
  effects: GameEventEffects;
  /** Remaining lifetime in game hours; instant events are removed at 0. */
  remainingHours: number;
  totalHours: number;
}

export interface ManagerAutomationSettings {
  autoFuelOrder: boolean;
  orderThresholdPercent: number; // ör. %25
  orderTargetPercent: number; // ör. %90
  kasaReserve: number; // 8.000 TL
  autoPricing: boolean;
  minMargin: number;
  maxRegionalDiff: number;
  autoAssignAttendants: boolean;
  autoMaintenanceAlert: boolean;
  minHealthThreshold: number;
}

export interface ManagerLogEntry {
  id: string;
  timestamp: number;
  gameTimeStr: string;
  category: 'FUEL_ORDER' | 'PRICING' | 'STAFF' | 'MAINTENANCE' | 'ALERT';
  reason: string;
  amount?: number;
  result: 'SUCCESS' | 'SKIPPED_RESERVE' | 'FAILED';
}

export interface DayState {
  currentDay: number;
  /** Runs from 6.00 up to 30.00 — six in the morning to six the next. */
  gameTime: number;
/**
   * Kept at 1. The clock does not stop: shutting the station is the way to
   * take a breather, and that is a decision with consequences rather than a
   * freeze button. Retained as a field so a tick can still be told to idle.
   */
  timeSpeed: 0 | 1;
  isDayActive: boolean;
  isDayEnding: boolean;
  weather: 'SUNNY' | 'OVERCAST' | 'RAIN';
  /**
   * Seconds of wall-clock time left on the day's discounted fuel window, and
   * whether it has already been offered today. Both of these run on real time
   * rather than the forecourt clock: they are a prompt to the player at the
   * keyboard, not an event in the world.
   */
  fuelDealSecondsLeft?: number;
  fuelDealDoneToday?: boolean;
  /** Hour of the day the discount is due, drawn fresh each morning. */
  fuelDealAtHour?: number;
  /**
   * A burst of custom, in game-seconds remaining. Traffic on the highway is
   * steady; what comes in waves is how many of those drivers decide to stop.
   */
  rushSecondsLeft?: number;
  todayStats: {
    fuelRevenue: number;
    fuelCost: number;
    marketRevenue: number;
    marketCost: number;
    tips: number;
    wages: number;
    upkeep: number;
    loanPayments: number;
    repairs: number;
    customersServed: number;
    /** Customers taken on and then failed: they gave up waiting. */
    customersLost: number;
    /**
     * Drivers who found no room and carried on down the road. Not a service
     * failure — a capacity signal, and counted separately so it reads as one.
     */
    customersTurnedAway?: number;
    /** Running total of service scores, divided by customersServed at day end. */
    serviceScoreSum: number;
  };
}

export interface TransactionRecord {
  id: string;
  timestamp: number;
  type: 'FUEL_SALE' | 'FUEL_ORDER' | 'MARKET_SALE' | 'WAGE_PAYMENT' | 'UPKEEP' | 'LOAN_TAKEOUT' | 'LOAN_INSTALLMENT' | 'BUILD' | 'UPGRADE' | 'REPAIR' | 'CLEAN' | 'TUTORIAL_REWARD' | 'MISSION_REWARD' | 'REFUND';
  amount: number; // + for income, - for expense
  cashBefore: number;
  cashAfter: number;
  description: string;
}

export interface GameNotification {
  id: string;
  type: 'CRITICAL' | 'WARNING' | 'INFO' | 'REWARD';
  title: string;
  message: string;
  timestamp: number;
  icon?: string;
  read?: boolean;
}

export interface GameState {
  schemaVersion: 5;
  saveId: string;
  createdAt: number;
  updatedAt: number;
  player: PlayerState;
  station: {
    id: string;
    name: string;
    open: boolean;
    cleanliness: number; // 0 - 100
    plots: {
      /** Bounding box of owned land, derived from ownedParcels. */
      width: number;
      height: number;
      /** Parcel keys ("col,row") the player owns. The real source of truth. */
      ownedParcels: string[];
      /** Owned parcels that have been paved and can be built on. */
      pavedParcels: string[];
    };
    managerId: string | null;
    /**
     * 1 = single one-way lane, only the near side is developable.
     * 2 = dual carriageway; the land across the road opens up.
     */
    roadLevel: 1 | 2;
  };
  tanks: Record<FuelType, FuelTankEntity>;
  pricing: Record<FuelType, FuelPricingState>;
  pumps: Record<string, PumpEntity>;
  vehicles: Record<string, VehicleEntity>;
  employees: Record<string, EmployeeEntity>;
  buildings: Record<string, BuildingEntity>;
  fuelOrders: FuelOrderEntity[];
  loans: LoanEntity[];
  missions: MissionEntity[];
  activeEvents: ActiveGameEvent[];
  /** Template ids already fired today, so one event cannot stack on itself. */
  todayEventIds: string[];
  dayState: DayState;
  market: {
    stock: number; // max 100
    averageCost: number;
    active: boolean;
  };
  managerSettings: ManagerAutomationSettings;
  managerLogs: ManagerLogEntry[];
  settings: {
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
    graphicsQuality: 'LOW' | 'MEDIUM' | 'HIGH';
    language: 'tr' | 'en';
    showTutorialTips: boolean;
  };
  notifications: GameNotification[];
  transactionLog: TransactionRecord[];
}
