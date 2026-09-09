/**
 * Project Highway - GameState & Entity Interfaces (v1.0.0)
 * Sourced directly from GDD Section 27
 */

export type FuelType = 'gasoline' | 'diesel' | 'lpg';

export type VehicleArchetype =
  | 'commuter'
  | 'family'
  | 'taxi'
  | 'courier'
  | 'commercial'
  | 'truck'
  | 'luxury'
  | 'ev'
  | 'police'
  | 'ambulance'
  | 'firetruck'
  | 'bus'
  | 'monster';

export type VehicleModelVariant =
  | 'sedan'
  | 'hatchback'
  | 'suv'
  | 'taxi'
  | 'van'
  | 'pickup'
  | 'truck'
  | 'truck-with-trailer'
  | 'sports'
  | 'roadster'
  | 'muscle'
  | 'muscle-2'
  | 'limousine'
  | 'police-sedan'
  | 'police-suv'
  | 'police-sports'
  | 'police-muscle'
  | 'ambulance'
  | 'firetruck'
  | 'bus'
  | 'monster-truck'
  // Kenney Car Kit (GLB) — the fleet the game shipped with, kept in rotation
  // beside the RgsDev pack so the road carries as many shapes as possible.
  | 'kenney-sedan'
  | 'kenney-suv'
  | 'kenney-taxi'
  | 'kenney-van'
  | 'kenney-delivery'
  | 'kenney-truck'
  | 'kenney-suv-luxury'
  | 'kenney-sedan-sports'
  | 'kenney-hatchback-sports';

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
  /**
   * A visit the driver never got out of the car for: no room to park, so the
   * facility earns a fraction and the car pauses a moment before leaving.
   */
  | 'OPTIONAL_SHOP'
  /** Driving to a bay in a car park, to walk over to a facility from there. */
  | 'TO_PARK'
  /** Standing still — in a park bay or at the pump — while the driver is inside a facility. */
  | 'VISITING'
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
  /**
   * A roof of this island's own, on a single column bolted to it.
   *
   * Optional because saves written before canopies became part of the pump
   * have no such field, and an absent one reads as no roof.
   */
  hasCanopy?: boolean;
  /** Panels on that roof, feeding the block's battery bank by day. */
  hasSolarCanopy?: boolean;
  /**
   * How clean the glass is, 0–100. Dust takes it down, rain and a wash bring
   * it back, and a dirty roof makes less. Absent reads as clean.
   */
  solarCleanliness?: number;
}

export interface VehicleEntity {
  id: string;
  archetype: VehicleArchetype;
  /** Stable visual body selected when this road user is spawned. */
  modelVariant?: VehicleModelVariant;
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
  /**
   * How long the solid-structure rule has been refusing this car's next step.
   * Structures are walls — a car pressed against one stays put — but a car
   * that can never move again must eventually be taken off the board.
   */
  solidStuckSeconds?: number;
  /** Charging point this driver is plugged into, for electric customers. */
  chargingBuildingId?: string | null;
  /**
   * The facility an OPTIONAL_SHOP customer is actually inside. The till bills
   * the parade in aggregate, but the person is standing in one building — and
   * if the player sells that building, it is this visitor who storms off.
   */
  visitBuildingId?: string | null;
  /**
   * How this driver is using the facility they came for. PARK: left the car
   * in a bay and walked. PUMP: left it standing at the pump — holding the bay
   * for everyone behind. VIRTUAL: could not park, so the visit is booked
   * without anyone getting out.
   */
  visitMode?: 'PARK' | 'PUMP' | 'VIRTUAL' | null;
  /**
   * Came for the toilet, the café or a bed rather than for fuel. Decided on
   * the road, like everything else about a driver: such a car never joins the
   * pump queue at all.
   */
  facilityIntent?: boolean;
  /** The car park and bay this car is in, or on its way to. */
  parkingBuildingId?: string | null;
  parkingSlot?: number | null;
  /** Backing out of a bay: the nose keeps pointing where it was. */
  reversing?: boolean;
  /** The driver, once they have got out of the car. */
  visitor?: FacilityVisitor;
  /** The player wiped this customer's windscreen — service they remember. */
  windowsCleaned?: boolean;
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

/**
 * A driver on foot: out of the car, across the forecourt, into the building
 * and back. Lives on the vehicle rather than in a collection of its own, so a
 * car that leaves takes its driver with it and nothing is ever orphaned.
 */
export interface FacilityVisitor {
  phase: 'TO_BUILDING' | 'INSIDE' | 'TO_CAR';
  worldPosition: [number, number, number];
  heading: number;
  route: Array<[number, number, number]>;
  targetWaypoint: [number, number, number] | null;
  /** Seconds still to spend inside. */
  insideSecondsLeft: number;
  /** Where the car door is, so the walk back ends beside the car. */
  carDoor: [number, number, number];
  /** A small stable number drawn from the car, for the clothes they wear. */
  look: number;
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
  /**
   * Money a facility has taken and nobody has come to collect. It stays in the
   * building until the player clicks it out — or, with a manager on the
   * payroll, until the manager does the rounds.
   */
  till?: number;
  /** What the facility has taken today, collected or not. Reset each morning. */
  todayRevenue?: number;
  /** Visitors through the door today. */
  todayVisits?: number;
  /** Which price on the facility's tariff card is up: an index into its config. */
  tariff?: number;
  /** A battery bank's charge, in kWh. Absent on saves from before banks held any. */
  energyKwh?: number;
  /** A generator switched off by hand. Absent reads as running. */
  generatorOff?: boolean;
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
  /** Hangi tedarikçiyle verildi — Alım Defteri kaydı için. */
  supplierId: string;
  /**
   * The lorry itself, once it turns off the highway. Absent while the order
   * is still with the supplier — and on old saves, where deliveries were a
   * timer and a parked prop.
   */
  truck?: {
    worldPosition: [number, number, number];
    heading: number;
    route: Array<[number, number, number]>;
    targetWaypoint: [number, number, number] | null;
    routeProgress: number;
    speed: number;
    phase: 'ARRIVING' | 'UNLOADING' | 'LEAVING';
    /** The tank it is here to fill — always its own fuel's tank. */
    tankBuildingId: string | null;
    /** How long the lorry has been stood behind something in its way. */
    blockedSeconds?: number;
    /** How long it has been on the plot at all — its patience with the place. */
    onPlotSeconds?: number;
  };
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
  /**
   * The manager does the rounds of the facility tills. Optional because saves
   * written before facilities had tills carry no such setting; absent reads
   * as on, which is what hiring a manager is for.
   */
  autoCollectTills?: boolean;
  /** Game hours between rounds. */
  collectIntervalHours?: number;
  /**
   * Draw from the grid only in the cheap night window, unless the bank has
   * fallen below the floor. Absent reads as on, like every other duty; a
   * manager below the grade for it fills at any hour regardless.
   */
  nightGridFill?: boolean;
  /**
   * Preventive maintenance: a pump worn below minHealthThreshold is serviced
   * out of the automation budget before it fails. Absent reads as on.
   */
  autoMaintenance?: boolean;
  /** Breakdown repair: a BROKEN pump is put back into service. Absent reads as on. */
  autoRepair?: boolean;
  /** Site cleaning: the forecourt is swept before the grime costs custom and sun. Absent reads as on. */
  autoClean?: boolean;
  /**
   * Fill every tank the station sells from while the supplier's daily
   * discount window is open. Absent reads as on.
   *
   * Every duty defaults to on: the manager arrives with the whole job
   * description and the player takes away what they do not want. What is
   * actually done is still gated by the manager's own level — a duty the
   * tier has not unlocked stays switched off however the toggle reads.
   */
  dealStockUp?: boolean;
}

export interface ManagerLogEntry {
  id: string;
  timestamp: number;
  gameTimeStr: string;
  category: 'FUEL_ORDER' | 'PRICING' | 'STAFF' | 'MAINTENANCE' | 'ALERT' | 'FINANCE';
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
    /** What the grid charged for topping the battery banks up today. */
    energyCost?: number;
    /** kWh the roofs put into the banks today. */
    solarKwh?: number;
    /** Diesel the generator burnt today, in litres, and what it made. */
    generatorLiters?: number;
    generatorKwh?: number;
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
  type: 'FUEL_SALE' | 'FUEL_ORDER' | 'MARKET_SALE' | 'FACILITY_INCOME' | 'WAGE_PAYMENT' | 'UPKEEP' | 'LOAN_TAKEOUT' | 'LOAN_INSTALLMENT' | 'BUILD' | 'UPGRADE' | 'REPAIR' | 'CLEAN' | 'TUTORIAL_REWARD' | 'MISSION_REWARD' | 'REFUND';
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
  /**
   * How many times this same notification fired in a row. Three customers
   * giving up in the same second is one thing that happened three times, not
   * three things — it shows as a single "×3" toast.
   */
  count: number;
  /**
   * How long the toast should stay readable, in ms, when longer than usual.
   * An event's explanation ("refinery hike: wholesale is 8% dearer today") is
   * the only place the player learns what the card in the corner means, so
   * it must not vanish with the four-second "customer lost" pills.
   */
  holdMs?: number;
}

/**
 * What a caller hands the store. Identity, time and the repeat count belong to
 * the log, not to the code that raises the notification.
 */
export type NotificationDraft = Omit<GameNotification, 'id' | 'timestamp' | 'count' | 'read'>;

/**
 * Alım Defteri'ndeki tek bir yakıt ikmali kaydı.
 * transactionLog'dan ayrı tutulur çünkü litre/tedarikçi bilgisi
 * description string'inden parse etmek kırılgan.
 */
export interface FuelPurchaseRecord {
  id: string;
  /** Oyun günü (dayState.currentDay). */
  day: number;
  fuelType: FuelType;
  liters: number;
  unitCost: number;     // TL/L — o anki tedarikçi fiyatıyla
  totalCost: number;    // liters * unitCost + deliveryFee
  /** Hangi tedarikçiyle sipariş verildi. */
  supplierId: string;
  /** Unix ms — teslimat tamamlandığı an. */
  deliveredAt: number;
}

export interface GameState {
  schemaVersion: 6;
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
    /** Game time of the manager's last round of the tills. */
    lastTillCollectAt?: number;
    /**
     * The manager's own grade, 1–3. Each grade adds duties to the job and
     * shortens the round. Absent reads as 1: a save from before grades knew
     * only the one manager.
     */
    managerLevel?: number;
    /**
     * Sim seconds until the manager's next round. Duties are done on rounds,
     * not every tick: the manager walks the station, sees what needs doing,
     * and does it — and a better manager walks it more often.
     */
    managerTourSecondsLeft?: number;
  };
  tanks: Record<FuelType, FuelTankEntity>;
  pricing: Record<FuelType, FuelPricingState>;
  /**
   * What a kWh sells for at each kind of charging post, set from the office
   * like the fuel prices (Emre, 2026-09-08). Optional because saves written
   * before it carry none; absent reads as the catalogue tariff.
   */
  evPricing?: { ac: number; dc: number };
  pumps: Record<string, PumpEntity>;
  vehicles: Record<string, VehicleEntity>;
  employees: Record<string, EmployeeEntity>;
  buildings: Record<string, BuildingEntity>;
  fuelOrders: FuelOrderEntity[];
  /** Alım Defteri: tamamlanan her teslimatın özeti, en yenisi sona eklenir. */
  fuelPurchaseHistory: FuelPurchaseRecord[];
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
    /**
     * The Karton palette in daylight, or the same cards in the dark for a
     * player who does not care for white (Emre, 2026-09-08). Optional so a
     * save from before the switch reads as light.
     */
    theme?: 'light' | 'dark';
    showTutorialTips: boolean;
  };
  notifications: GameNotification[];
  transactionLog: TransactionRecord[];
}
