/**
 * Project Highway - Central Zustand Game Store
 * Connects domain engine, simulation loop and UI components.
 */

import { create } from 'zustand';
import { GameState, FuelType, VehicleArchetype, BuildingEntity, GameNotification } from '../domain/types/gameState';
import { SaveManager } from '../domain/services/SaveManager';
import { TransactionService } from '../domain/services/TransactionService';
import { GAME_CONFIG, upgradePathFor, TANK_PACKAGE_LITERS } from '../config/gameConfig';
import {
  calculateEndOfDayReputation,
  calculateRepairCost,
  calculateDailyWholesalePrice
} from '../domain/formulas/economy';
import {
  SimEffects,
  SoundCue,
  createEffects,
  runSimulationTick,
  beginFueling,
  dispenseStep,
  finalizeSale,
  placeFuelOrder,
  trackMissionMetric,
  generateDailyMissions,
  rollDailyEvent,
  getWholesaleEventModifier,
  applyLevelProgression,
  releasePump,
  setPumpState,
  drivewayRole,
  drivewaySideAt,
  syncPriceSign,
  defaultMouthX,
  getLayout,
  closeForecourt,
  evictFromPump,
  dailyPriceReputationDelta,
  dismissVehicle,
  DRIVEWAY_Z
} from '../domain/services/simulationEngine';
import {
  evaluatePlacement,
  snapPlacement,
  absorbedByRestComplex
} from '../domain/services/placement';
import {
  stationBounds,
  ownedBounds,
  FAR_SIDE_FRONT,
  parcelKey,
  isBuyable,
  parcelPrice,
  paveCost,
  isOwned
} from '../domain/services/land';
import { sounds } from '../audio/soundEffects';
import { zoomToFit } from '../rendering/cameraFrame';

const SOUND_PLAYERS: Record<SoundCue, () => void> = {
  click: () => sounds.playClick(),
  cash: () => sounds.playCashSound(),
  alert: () => sounds.playAlert(),
  levelUp: () => sounds.playLevelUp(),
  pumpStart: () => sounds.playPumpStart(),
  fuelTick: () => sounds.playFuelFlowTick(),
  buildPlace: () => sounds.playBuildPlace()
};

/**
 * Appends the notifications an engine call produced onto a state draft and
 * fires its sound cues. Effects are flushed against the same draft the engine
 * mutated, so a tick still commits with exactly one `set`.
 */
function flushEffects(state: GameState, effects: SimEffects): void {
  for (const cue of effects.sounds) SOUND_PLAYERS[cue]();

  if (effects.notifications.length === 0) return;

  const created: GameNotification[] = effects.notifications.map((n) => ({
    ...n,
    id: 'notif_' + Math.random().toString(36).substring(2, 9),
    timestamp: Date.now()
  }));

  state.notifications = [...created.reverse(), ...state.notifications].slice(0, 20);
}

/** The level at which rearranging what is already built unlocks. */
export const EDIT_MODE_LEVEL = 5;

/**
 * How far the camera may be panned, in world units: the land the player owns
 * plus a margin, so the edges of the plot can be brought to the middle of the
 * screen rather than only to its corner. The highway itself always stays
 * reachable, even before anything is bought across it.
 */
/** Camera target and zoom that hold every parcel the player owns on screen. */
function frameOwnedLand(state: GameState): {
  cameraTarget: [number, number];
  cameraZoom: number;
} {
  const owned = ownedBounds(state.station.plots.ownedParcels);
  const minX = owned.minX * 2;
  const maxX = owned.width * 2;
  const minZ = owned.minZ * 2;
  const maxZ = owned.height * 2;

  return {
    cameraTarget: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    cameraZoom: zoomToFit(Math.max(maxX - minX, maxZ - minZ))
  };
}

function panBounds(ownedParcels: string[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const owned = ownedBounds(ownedParcels);
  const margin = 24;

  return {
    minX: owned.minX * 2 - margin,
    maxX: owned.width * 2 + margin,
    minZ: Math.min(owned.minZ * 2, FAR_SIDE_FRONT * 2) - margin,
    maxZ: owned.height * 2 + margin
  };
}

export type ActiveModalType =
  | 'NONE'
  | 'CUSTOMER_FUEL'
  | 'FUEL_ORDER'
  | 'BUILD'
  | 'PRICING'
  | 'STAFF'
  | 'BANK'
  | 'DAY_REPORT'
  | 'SETTINGS'
  | 'OFFICE'
  | 'MISSIONS';

export interface PerformanceMetrics {
  fps: number;
  activeVehicles: number;
  drawCalls: number;
  simTickMs: number;
}

/** Land-buying mode: hovering a parcel previews it, clicking buys it. */
export interface LandModeState {
  active: boolean;
  /** Parcel under the cursor, or null when it is off the buyable map. */
  hovered: { col: number; row: number } | null;
  /** What clicking would do: buy the land, pave it, or nothing. */
  action: 'BUY' | 'PAVE' | 'NONE';
  price: number;
  canBuy: boolean;
}

export interface BuildModeState {
  active: boolean;
  buildingType: string | null;
  position: [number, number];
  rotation: 0 | 90 | 180 | 270;
  isValid: boolean;
}

interface GameStore {
  gameState: GameState;
  activeModal: ActiveModalType;
  selectedVehicleId: string | null;
  selectedPumpId: string | null;
  selectedBuildingId: string | null;
  buildMode: BuildModeState;
  /** Set while a lifted building is being carried to its new spot. */
  relocating: {
    type: string;
    level: number;
    health: number;
    origin: [number, number];
    rotation: 0 | 90 | 180 | 270;
    wasMoved: boolean;
    /** Set when what is being carried is a bay rather than a building. */
    pump?: {
      supportedFuels: FuelType[];
      flowRateLps: number;
      employeeId: string | null;
    };
  } | null;
  landMode: LandModeState;
  /**
   * The forecourt is unlocked for rearranging. Off, the plot is scenery the
   * player reads; on, every structure is something they can pick up. Keeping
   * that a mode rather than a button on each structure is what stops the map
   * being covered in handles the player did not ask for.
   */
  editMode: boolean;
  cameraAngle: number; // 0, 90, 180, 270
  cameraZoom: number; // 1 to 7
  /** Point on the ground the camera orbits, in world units. */
  cameraTarget: [number, number];
  perfMetrics: PerformanceMetrics;

  // UI / Modal Actions
  setActiveModal: (modal: ActiveModalType) => void;
  selectVehicle: (id: string | null) => void;
  selectPump: (id: string | null) => void;
  selectBuilding: (id: string | null) => void;
  rotateCamera: (dir: 'LEFT' | 'RIGHT') => void;
  setCameraZoom: (zoom: number | ((prev: number) => number)) => void;
  /** Pans the camera by a screen-space delta, rotated into world space. */
  panCamera: (screenDeltaX: number, screenDeltaY: number) => void;
  resetCamera: () => void;
  addNotification: (notif: Omit<GameNotification, 'id' | 'timestamp'>) => void;
  dismissNotification: (id: string) => void;

  // Build Mode
  enterBuildMode: (buildingType: string) => void;
  exitBuildMode: () => void;
  setBuildPreviewPos: (pos: [number, number]) => void;
  rotateBuildPreview: () => void;
  confirmBuildPlacement: () => boolean;
  /** Second-hand value of a pump or building, for the sell button. */
  structureValue: (id: string) => number;
  sellStructure: (id: string) => boolean;
  /** Lifts a building for a small fee and re-enters placement with it. */
  relocateStructure: (id: string) => boolean;
  upgradeBuilding: (id: string) => boolean;
  toggleStationOpen: () => void;
  enterLandMode: () => void;
  exitLandMode: () => void;
  /** Turns rearranging on or off; a click on a structure then lifts it. */
  toggleEditMode: () => void;
  hoverParcel: (col: number, row: number) => void;
  buyHoveredParcel: () => boolean;
  paveHoveredParcel: () => boolean;
  /** Widens the highway to a dual carriageway and opens the far side. */
  upgradeRoad: () => boolean;
  upgradePump: (pumpId: string) => boolean;
  repairPump: (pumpId: string) => boolean;
  addPumpFuel: (pumpId: string, fuel: 'diesel' | 'lpg') => boolean;
  cleanVehicleWindows: (vehicleId: string) => void;
  dismissCustomer: (vehicleId: string) => void;
  cleanStation: () => boolean;
  /** Development aid: unlocks every level-gated feature for testing. */
  devUnlockEverything: () => void;

  // Fueling Actions
  openFuelingPanelForVehicle: (vehicleId: string) => void;
  startVehicleFueling: (vehicleId: string, mode: 'LITERS' | 'MONEY' | 'FULL', targetValue: number) => void;
  dispenseFuelStep: (vehicleId: string, deltaSeconds: number) => boolean; // true if completed
  completeVehicleFueling: (vehicleId: string) => void;

  // Logistics / Orders
  orderFuel: (fuelType: FuelType, liters: number) => boolean;
  cancelFuelOrder: (orderId: string) => void;

  // Economy / Pricing
  setFuelPrice: (fuelType: FuelType, price: number, strategy?: 'CHEAP' | 'BALANCED' | 'HIGH_MARGIN' | 'CUSTOM') => void;
  takeLoan: (loanId: string) => boolean;

  // Employees & Manager
  hirePumpAttendant: () => boolean;
  assignAttendantToPump: (employeeId: string, pumpId: string | null) => void;
  upgradeAttendant: (employeeId: string) => boolean;
  hireManager: () => boolean;
  updateManagerSettings: (settings: Partial<GameState['managerSettings']>) => void;

  // Simulation Step & Day Cycle
  simulationTick: (deltaSeconds: number) => void;
  endDayAndShowReport: () => void;
  startNextDay: () => void;
  claimMissionReward: (missionId: string) => boolean;
  resetGameSave: () => void;
  updatePerfMetrics: (metrics: Partial<PerformanceMetrics>) => void;
}

/**
 * Prepares a loaded save for play. A save can be written at a moment the game
 * cannot resume from — the day already closed, or the clock paused — and
 * without this the station would load frozen with no traffic and no way
 * forward but resetting.
 */
function reviveLoadedSave(loaded: GameState): { state: GameState; modal: ActiveModalType } {
  // Older saves measured the plot across both sides of the highway, which
  // dragged the exit driveway off the forecourt as the far side grew.
  const bounds = stationBounds(loaded.station.plots.ownedParcels);
  loaded.station.plots.width = bounds.width;
  loaded.station.plots.height = bounds.height;

  // Wide ramps used to be ordinary structures and could be dropped anywhere,
  // which left them stranded on the forecourt or out in the road. Pull each
  // one back onto the verge and keep only one per mouth.
  const seenMouths = new Set<string>();
  for (const building of Object.values(loaded.buildings)) {
    const role = drivewayRole(building.type);
    if (!role) continue;

    const mouth = `${drivewaySideAt(building.position[1])}-${role}`;
    if (seenMouths.has(mouth)) {
      delete loaded.buildings[building.id];
      continue;
    }
    seenMouths.add(mouth);

    building.position = snapPlacement(loaded, building.type, building.position);
    building.size = GAME_CONFIG.buildings[building.type]?.size ?? building.size;

    // A ramp saved while the two blocks shared one set of mouths can be
    // sitting on the opposite mouth's ground — which reads in game as the
    // exit having been replaced by a second entrance. Put it back on its own.
    if (!evaluatePlacement(loaded, building.type, building.position, 0).valid) {
      const side = drivewaySideAt(building.position[1]);
      building.position = snapPlacement(loaded, building.type, [
        defaultMouthX(role, side, loaded.station.plots.width),
        building.position[1]
      ]);
    }
  }

  // The price board is infrastructure: it belongs between the mouths, not
  // wherever an older save happened to leave it.
  syncPriceSign(loaded);

  // Storage went through two shapes before the farm: bare capacity with no
  // building, then one package building per fuel. Both fold into the single
  // Yakıt Tank Sahası — the legacy packages are folded in at the highest
  // level any of them reached, and every fuel wakes at the farm's floor so
  // no save is left in the old dizel-locked trap.
  {
    const legacy = Object.values(loaded.buildings).filter((b) =>
      ['tank_gasoline', 'tank_diesel', 'tank_lpg'].includes(b.type)
    );
    let farm = Object.values(loaded.buildings).find((b) => b.type === 'tank_farm');

    if (!farm && legacy.length > 0) {
      const keeper = legacy[0];
      keeper.type = 'tank_farm';
      keeper.level = Math.max(...legacy.map((b) => b.level));
      keeper.size = GAME_CONFIG.buildings.tank_farm.size;
      farm = keeper;
      for (const extra of legacy.slice(1)) delete loaded.buildings[extra.id];
    } else if (farm) {
      for (const extra of legacy) delete loaded.buildings[extra.id];
    }

    if (!farm) {
      outer: for (let z = 3; z <= loaded.station.plots.height - 2; z++) {
        for (let x = 2; x <= loaded.station.plots.width - 2; x++) {
          if (!evaluatePlacement(loaded, 'tank_farm', [x, z], 0).valid) continue;
          const id = 'bld_tank_farm_' + Math.random().toString(36).substring(2, 6);
          loaded.buildings[id] = {
            id,
            type: 'tank_farm',
            level: 1,
            position: [x, z],
            rotation: 0,
            size: GAME_CONFIG.buildings.tank_farm.size,
            health: 100,
            constructionState: 'ACTIVE',
            builtAtTimestamp: Date.now()
          };
          farm = loaded.buildings[id];
          break outer;
        }
      }
    }

    const floor = TANK_PACKAGE_LITERS[farm?.level ?? 1] ?? 1500;
    for (const fuel of ['gasoline', 'diesel', 'lpg'] as const) {
      const tank = loaded.tanks[fuel];
      tank.capacity = Math.max(tank.capacity, floor);
      tank.level = Math.max(tank.level, farm?.level ?? 1);
      if (!loaded.player.unlocks.includes(`fuel_${fuel}`)) {
        loaded.player.unlocks.push(`fuel_${fuel}`);
      }
    }
  }

  // Day one should open with its daily goals already posted.
  if (!loaded.missions.some((m) => m.type !== 'TUTORIAL')) {
    generateDailyMissions(loaded);
  }

  // Pausing is a moment-to-moment control, not something to restore.
  if (loaded.dayState.isDayActive && loaded.dayState.timeSpeed === 0) {
    loaded.dayState.timeSpeed = 1;
  }

  // The day had already closed: reopen its report so the player can move on.
  if (!loaded.dayState.isDayActive) {
    return { state: loaded, modal: 'DAY_REPORT' };
  }

  return { state: loaded, modal: 'NONE' };
}

export const useGameStore = create<GameStore>((set, get) => {
  const revived = reviveLoadedSave(SaveManager.loadGame());

  return {
  gameState: revived.state,
  activeModal: revived.modal,
  selectedVehicleId: null,
  selectedPumpId: null,
  selectedBuildingId: null,
  buildMode: {
    active: false,
    buildingType: null,
    position: [10, 10],
    rotation: 0,
    isValid: true
  },
  relocating: null,
  landMode: { active: false, hovered: null, action: 'NONE', price: 0, canBuy: false },
  editMode: false,
  cameraAngle: 225, // Yol sol üstten sağ alta iner, istasyon sağında kalır
  // Framed on the land in the save rather than on the starting forecourt: a
  // player coming back to a grown plot should not open on a corner of it.
  // A new game owns the 2x2 starting block, which frames to the same view
  // this used to hold outright.
  ...frameOwnedLand(revived.state),
  perfMetrics: {
    fps: 60,
    activeVehicles: 0,
    drawCalls: 120,
    simTickMs: 0.5
  },

  setActiveModal: (modal) => {
    sounds.playClick();
    set({ activeModal: modal });
  },

  selectVehicle: (id) => set({ selectedVehicleId: id }),
  selectPump: (id) => set({ selectedPumpId: id, selectedBuildingId: null }),
  // One thing is selected at a time: picking a building lets go of the pump
  // and the other way round, or the panel stays stuck on the older choice.
  selectBuilding: (id) => set({ selectedBuildingId: id, selectedPumpId: null }),

  rotateCamera: (dir) => {
    sounds.playClick();
    set((state) => ({
      cameraAngle: dir === 'LEFT' ? (state.cameraAngle - 90 + 360) % 360 : (state.cameraAngle + 90) % 360
    }));
  },

  setCameraZoom: (zoom) => {
    set((state) => {
      const nextZoom = typeof zoom === 'function' ? zoom(state.cameraZoom) : zoom;
      return { cameraZoom: Math.max(1, Math.min(7, nextZoom)) };
    });
  },

  panCamera: (screenDeltaX, screenDeltaY) => {
    set((state) => {
      // Drag should move the ground under the cursor whichever way the
      // camera is facing, so rotate the screen delta by the camera yaw.
      const rad = (state.cameraAngle * Math.PI) / 180;
      const sin = Math.sin(rad);
      const cos = Math.cos(rad);

      // Panning further per pixel when zoomed out keeps the feel constant.
      const scale = 0.055 * (8 - state.cameraZoom);

      const worldX = (screenDeltaX * cos + screenDeltaY * sin) * scale;
      const worldZ = (-screenDeltaX * sin + screenDeltaY * cos) * scale;

      // How far the view may travel follows the land, rather than a box drawn
      // around the starting plot: a parcel bought across the highway sits at
      // negative z, well outside that box, and could never be centred on.
      const limit = panBounds(state.gameState.station.plots.ownedParcels);

      return {
        cameraTarget: [
          Math.max(limit.minX, Math.min(limit.maxX, state.cameraTarget[0] - worldX)),
          Math.max(limit.minZ, Math.min(limit.maxZ, state.cameraTarget[1] - worldZ))
        ]
      };
    });
  },

  resetCamera: () => {
    sounds.playClick();
    // Centre on everything the player owns and pull back far enough to hold
    // it all. Returning to a fixed spot over the starting forecourt is no use
    // once the plot has grown, least of all across the highway.
    set({ ...frameOwnedLand(get().gameState), cameraAngle: 225 });
  },

  addNotification: (notif) => {
    const id = 'notif_' + Math.random().toString(36).substring(2, 8);
    const newNotif: GameNotification = {
      ...notif,
      id,
      timestamp: Date.now()
    };
    if (notif.type === 'CRITICAL' || notif.type === 'WARNING') sounds.playAlert();
    else if (notif.type === 'REWARD') sounds.playLevelUp();

    set((state) => ({
      gameState: {
        ...state.gameState,
        notifications: [newNotif, ...state.gameState.notifications.slice(0, 19)]
      }
    }));
  },

  dismissNotification: (id) => {
    set((state) => ({
      gameState: {
        ...state.gameState,
        notifications: state.gameState.notifications.filter((n) => n.id !== id)
      }
    }));
  },

  // BUILD MODE
  enterBuildMode: (buildingType) => {
    // Fixed structures come with the station; the only way into placement for
    // one of those is picking up the one that already exists.
    if (GAME_CONFIG.buildings[buildingType]?.fixed) return;

    sounds.playClick();
    set((state) => {
      // A ramp opens where the mouth it replaces already is, so the preview
      // starts on a spot that is legal and shows what it is about to change.
      const role = drivewayRole(buildingType);
      const layout = getLayout(state.gameState);
      const start: [number, number] = role
        ? [role === 'entry' ? layout.entryX : layout.exitX, DRIVEWAY_Z]
        : [12, 12];
      const position = snapPlacement(state.gameState, buildingType, start);
      return {
        buildMode: {
          active: true,
          buildingType,
          position,
          rotation: 0,
          isValid: evaluatePlacement(state.gameState, buildingType, position, 0).valid
        },
        activeModal: 'NONE'
      };
    });
  },

  exitBuildMode: () => {
    sounds.playClick();
    const { relocating, buildMode, gameState } = get();

    // Backing out of a move must put the building back, not lose it. It was
    // lifted off the plot to be carried, and the player has already paid for
    // it once — twice, counting the move fee.
    if (relocating && buildMode.buildingType === relocating.type) {
      const catalog = GAME_CONFIG.buildings[relocating.type];
      const state = JSON.parse(JSON.stringify(gameState)) as GameState;

      if (relocating.pump) {
        const id = 'pump_' + Math.random().toString(36).substring(2, 7);
        state.pumps[id] = {
          id,
          level: relocating.level,
          position: relocating.origin,
          rotation: relocating.rotation,
          supportedFuels: relocating.pump.supportedFuels,
          state: 'IDLE',
          health: relocating.health,
          employeeId: relocating.pump.employeeId,
          currentVehicleId: null,
          flowRateLps: relocating.pump.flowRateLps
        };
        const attendant = relocating.pump.employeeId
          ? state.employees[relocating.pump.employeeId]
          : null;
        if (attendant) attendant.assignedPumpId = id;
      } else {
        const id = 'bld_' + Math.random().toString(36).substring(2, 7);
        state.buildings[id] = {
          id,
          type: relocating.type,
          level: relocating.level,
          position: relocating.origin,
          rotation: relocating.rotation,
          size: catalog?.size ?? [2, 2],
          health: relocating.health,
          movedByPlayer: relocating.wasMoved,
          constructionState: 'ACTIVE',
          builtAtTimestamp: Date.now()
        };
      }

      SaveManager.saveGame(state);
      set({ gameState: state });
      get().addNotification({
        type: 'INFO',
        title: 'Taşıma İptal Edildi',
        message: `${catalog?.name ?? 'Yapı'} eski yerine geri kondu.`
      });
    }

    set({
      relocating: null,
      buildMode: {
        active: false,
        buildingType: null,
        position: [0, 0],
        rotation: 0,
        isValid: true
      }
    });
  },

  setBuildPreviewPos: (pos) => {
    set((state) => {
      const { buildingType, rotation } = state.buildMode;
      if (!buildingType) return { buildMode: { ...state.buildMode, position: pos, isValid: false } };

      // A driveway ramp ignores the pointer's z entirely and rides the verge.
      const snapped = snapPlacement(state.gameState, buildingType, pos);
      const isValid = evaluatePlacement(state.gameState, buildingType, snapped, rotation).valid;
      return { buildMode: { ...state.buildMode, position: snapped, isValid } };
    });
  },

  rotateBuildPreview: () => {
    sounds.playClick();
    set((state) => {
      // A ramp only makes sense pointing across the verge, so it does not turn.
      if (state.buildMode.buildingType && drivewayRole(state.buildMode.buildingType)) {
        return { buildMode: state.buildMode };
      }

      const rot = ((state.buildMode.rotation + 90) % 360) as 0 | 90 | 180 | 270;
      const { buildingType, position } = state.buildMode;
      const isValid = buildingType
        ? evaluatePlacement(state.gameState, buildingType, position, rot).valid
        : false;
      return { buildMode: { ...state.buildMode, rotation: rot, isValid } };
    });
  },

  confirmBuildPlacement: () => {
    const { gameState, buildMode } = get();
    if (!buildMode.active || !buildMode.buildingType) return false;

    const catalog = GAME_CONFIG.buildings[buildMode.buildingType];
    if (!catalog) return false;

    const carried =
      get().relocating && get().relocating!.type === buildMode.buildingType
        ? get().relocating
        : null;

    const placement = evaluatePlacement(
      gameState,
      buildMode.buildingType,
      buildMode.position,
      buildMode.rotation
    );
    if (!placement.valid) {
      get().addNotification({
        type: 'WARNING',
        title: 'Buraya İnşa Edilemez',
        message: placement.reason || 'Seçilen konum uygun değil.'
      });
      return false;
    }

    if (!carried && gameState.player.cash < catalog.price) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `${catalog.name} için ${catalog.price.toLocaleString('tr-TR')} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;

    // A building being set back down was already paid for; the move fee came
    // off when it was lifted.
    if (!carried) {
      const tx = TransactionService.executeCashTransaction(state, {
        type: 'BUILD',
        amount: -catalog.price,
        description: `${catalog.name} inşası`
      });
      if (!tx.success) return false;
    }

    if (catalog.category === 'tank') {
      // A structure being set back down after a move already had its effect;
      // only a fresh purchase changes the litres. The one buyable tank
      // structure is the expansion, and it doubles everything.
      if (buildMode.buildingType === 'tank_expansion' && !carried) {
        for (const fuel of Object.keys(state.tanks) as FuelType[]) {
          state.tanks[fuel].capacity *= 2;
        }
      }

      // The tank itself is buried, but its filler caps and vent stack are
      // above ground — and the player should see what they paid for.
      const tankId = 'bld_' + Math.random().toString(36).substring(2, 7);
      state.buildings[tankId] = {
        id: tankId,
        type: buildMode.buildingType,
        level: carried?.level ?? 1,
        position: buildMode.position,
        rotation: buildMode.rotation,
        size: catalog.size,
        health: carried?.health ?? 100,
        movedByPlayer: carried ? true : undefined,
        constructionState: 'ACTIVE',
        builtAtTimestamp: Date.now()
      };
    } else if (catalog.category === 'pump') {
      // A bay set back down keeps the grades it dispensed and the wear it had;
      // only a newly bought one starts as a plain petrol pump.
      const newPumpId = 'pump_' + Math.random().toString(36).substring(2, 7);
      state.pumps[newPumpId] = {
        id: newPumpId,
        level: carried?.level ?? 1,
        position: buildMode.position,
        rotation: buildMode.rotation,
        supportedFuels: carried?.pump?.supportedFuels ?? ['gasoline'],
        state: 'IDLE',
        health: carried?.health ?? 100,
        employeeId: null,
        currentVehicleId: null,
        flowRateLps: carried?.pump?.flowRateLps ?? 8
      };

      // The attendant who worked this bay follows it to its new spot.
      const attendant = carried?.pump?.employeeId
        ? state.employees[carried.pump.employeeId]
        : null;
      if (attendant) {
        attendant.assignedPumpId = newPumpId;
        state.pumps[newPumpId].employeeId = attendant.id;
      }
    } else {
      // A wide ramp replaces the mouth it stands in for rather than adding a
      // second one beside it, so the ramp it supersedes is torn out first. The
      // two blocks have their own pair, so only the same side is superseded.
      const role = drivewayRole(buildMode.buildingType);
      if (role) {
        const side = drivewaySideAt(buildMode.position[1]);
        for (const existing of Object.values(state.buildings)) {
          if (
            drivewayRole(existing.type) === role &&
            drivewaySideAt(existing.position[1]) === side
          ) {
            delete state.buildings[existing.id];
          }
        }
      }

      // A rest complex is the shop, the restaurant, the café and the toilets
      // under one roof — so it takes their place on this block rather than
      // standing next to duplicates of itself.
      if (buildMode.buildingType === 'rest_complex') {
        const side = drivewaySideAt(buildMode.position[1]);
        for (const absorbed of absorbedByRestComplex(state, side)) {
          delete state.buildings[absorbed.id];
        }
      }

      const bId = 'bld_' + Math.random().toString(36).substring(2, 7);
      state.buildings[bId] = {
        id: bId,
        type: buildMode.buildingType,
        level: carried?.level ?? 1,
        position: buildMode.position,
        rotation: buildMode.rotation,
        size: catalog.size,
        health: carried?.health ?? 100,
        // Put down by hand, so the layout leaves it where it was put.
        movedByPlayer: carried ? true : undefined,
        constructionState: 'ACTIVE',
        builtAtTimestamp: Date.now()
      };
      if (buildMode.buildingType === 'mini_market' || buildMode.buildingType === 'rest_complex') {
        // The complex carries a shop inside it, so the market keeps trading.
        state.market.active = true;
        state.market.stock = 50;
      }
    }

    // Building something new is progress; shuffling what is already there is
    // not, so a move earns nothing.
    const xpReward = carried ? 0 : Math.min(150, Math.round((catalog.price / 1000) * 3));
    state.player.xp += xpReward;

    const effects = createEffects();
    applyLevelProgression(state, effects);
    trackMissionMetric(state, 'BUILD_PLACED', 1, effects);
    flushEffects(state, effects);

    sounds.playBuildPlace();
    SaveManager.saveGame(state);

    set({
      gameState: state,
      buildMode: { ...buildMode, active: false, buildingType: null },
      relocating: null
    });

    get().addNotification({
      type: 'INFO',
      title: carried ? 'Taşıma Tamamlandı' : 'İnşaat Tamamlandı',
      message: carried
        ? `${catalog.name} yeni yerine kondu.`
        : `${catalog.name} başarıyla kuruldu. (+${xpReward} XP)`
    });

    return true;
  },

  /**
   * What a structure is worth second hand. Well under what it cost, and worn
   * hardware fetches less still — selling is a way out of a mistake, not a
   * way to park money.
   */
  structureValue: (id) => {
    const { gameState } = get();
    const pump = gameState.pumps[id];
    const building = pump ? null : gameState.buildings[id];
    if (!pump && !building) return 0;

    const type = pump ? 'pump_standard' : building!.type;
    const level = pump ? pump.level : building!.level;
    const health = pump ? pump.health : building!.health;

    const catalog = GAME_CONFIG.buildings[type];
    if (!catalog) return 0;

    // Money sunk into upgrades counts towards the sale, at the same rate.
    let invested = catalog.price;
    const upgrades = GAME_CONFIG.buildingUpgrades[upgradePathFor(type)];
    for (let step = 2; step <= level; step++) {
      invested += upgrades?.[step]?.cost ?? 0;
    }

    const wear = 0.6 + 0.4 * (health / 100);
    return Math.round((invested * GAME_CONFIG.economy.refundRatio * wear) / 10) * 10;
  },

  sellStructure: (id) => {
    const { gameState } = get();
    const value = get().structureValue(id);
    const pump = gameState.pumps[id];
    const building = pump ? null : gameState.buildings[id];
    if (!pump && !building) return false;

    const name = GAME_CONFIG.buildings[pump ? 'pump_standard' : building!.type]?.name ?? 'Yapı';

    // Infrastructure is not the player's to dispose of: a forecourt without a
    // price board is not a forecourt.
    if (building && GAME_CONFIG.buildings[building.type]?.fixed) {
      get().addNotification({
        type: 'WARNING',
        title: 'Bu Yapı Sökülemez',
        message: `${name} istasyonun zorunlu donanımıdır; yalnızca yükseltilebilir.`
      });
      return false;
    }

    // The last pump is the station's whole business; selling it would leave
    // the player with nothing to serve anyone with and no way back.
    if (pump && Object.keys(gameState.pumps).length <= 1) {
      get().addNotification({
        type: 'WARNING',
        title: 'Son Pompa Satılamaz',
        message: 'İstasyonun hizmet verebilmesi için en az bir pompa gerekiyor.'
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;

    let evicted = { unpaidLiters: 0, evicted: 0 };
    if (pump) {
      // Whoever was using it drives off unserved — with the reputation hit
      // that losing a customer always carries — rather than vanishing where
      // they stood, which is what used to happen.
      evicted = evictFromPump(state, id);
      for (const employee of Object.values(state.employees)) {
        if (employee.assignedPumpId === id) employee.assignedPumpId = null;
      }
      delete state.pumps[id];
    } else {
      delete state.buildings[id];
      if (building!.type === 'mini_market') state.market.active = false;

      // The expansion halves on the way out what it doubled on the way in;
      // fuel that no longer fits is pumped out and lost with the sale.
      if (building!.type === 'tank_expansion') {
        for (const fuel of Object.keys(state.tanks) as FuelType[]) {
          const tank = state.tanks[fuel];
          tank.capacity = Math.round(tank.capacity / 2);
          tank.stock = Math.min(tank.stock, tank.capacity);
          tank.reservedStock = Math.min(tank.reservedStock, tank.stock);
        }
      }
    }

    TransactionService.executeCashTransaction(state, {
      type: 'REFUND',
      amount: value,
      description: `${name} satıldı`
    });

    sounds.playCashSound();
    SaveManager.saveGame(state);
    set({ gameState: state, selectedBuildingId: null, selectedPumpId: null });
    get().addNotification({
      type: 'INFO',
      title: 'Yapı Satıldı',
      message: `${name} elden çıkarıldı, ${value.toLocaleString('tr-TR')} TL kasaya girdi.`
    });
    if (evicted.evicted > 0) {
      get().addNotification({
        type: 'WARNING',
        title: 'Müşteri Kaybedildi!',
        message:
          `Kullanılan pompa satıldı — ${evicted.evicted} müşteri hizmet alamadan ayrıldı.` +
          (evicted.unpaidLiters > 0 ? ` ${evicted.unpaidLiters} L yakıt ödenmeden gitti.` : '') +
          ` (-${(0.015 * evicted.evicted).toFixed(3)} İtibar)`
      });
    }
    return true;
  },

  /**
   * Raises a structure a level in place. An upgrade is the same building doing
   * its job better, not a second one beside it, so nothing is rebuilt and the
   * footprint never moves.
   */
  upgradeBuilding: (id) => {
    const { gameState } = get();
    const building = gameState.buildings[id];
    if (!building) return false;

    const next = building.level + 1;
    const upgrade = GAME_CONFIG.buildingUpgrades[upgradePathFor(building.type)]?.[next];
    const catalog = GAME_CONFIG.buildings[building.type];

    // The ladder the level screen promises for tanks: 3.000 L at 4, 6.000 L
    // at 8 — the same gate pumps carry, or the storage tuning means nothing.
    if (building.type === 'tank_farm') {
      const requiredLevel = next === 3 ? 8 : 4;
      if (gameState.player.level < requiredLevel) {
        get().addNotification({
          type: 'WARNING',
          title: 'Seviye Yetersiz',
          message: `Tank Sv${next} yükseltmesi için Seviye ${requiredLevel} gerekiyor.`
        });
        return false;
      }
    }
    if (!upgrade || !catalog) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yükseltme Yok',
        message: `${catalog?.name ?? 'Bu yapı'} için daha üst seviye bulunmuyor.`
      });
      return false;
    }

    if (gameState.player.cash < upgrade.cost) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `Yükseltme için ${upgrade.cost.toLocaleString('tr-TR')} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'UPGRADE',
      amount: -upgrade.cost,
      description: `${catalog.name} seviye ${next}`
    });
    if (!tx.success) return false;

    state.buildings[id].level = next;
    state.buildings[id].health = 100;

    // A farm upgrade is real litres for all three fuels at once, not a number
    // on a plaque: each gains the difference between the old and new package.
    if (building.type === 'tank_farm') {
      const grown =
        (TANK_PACKAGE_LITERS[next] ?? 0) - (TANK_PACKAGE_LITERS[building.level] ?? 0);
      for (const fuel of Object.keys(state.tanks) as FuelType[]) {
        state.tanks[fuel].capacity += grown;
        state.tanks[fuel].level = Math.max(state.tanks[fuel].level, next);
      }
    }

    sounds.playBuildPlace();
    SaveManager.saveGame(state);
    set({ gameState: state });
    get().addNotification({
      type: 'INFO',
      title: 'Yükseltme Tamamlandı',
      message: `${catalog.name} seviye ${next} oldu. ${upgrade.effectsDescription}`
    });
    return true;
  },

  /**
   * Shutting the station stops new customers coming in; whoever is already on
   * the forecourt is served out. It is the lever for a quiet rebuild, or for
   * riding out a day with no stock.
   */
  /**
   * Picks a structure back up so it can be put down somewhere else. Cheaper
   * than selling and rebuilding — a plot the player can rearrange is a plot
   * they will keep tinkering with, which is the point.
   */
  relocateStructure: (id) => {
    const { gameState } = get();
    // Bays live in their own collection but move exactly like anything else.
    const isPump = !!gameState.pumps[id];
    const source = isPump ? gameState.pumps[id] : gameState.buildings[id];
    if (!source) return false;

    const type = isPump ? 'pump_standard' : gameState.buildings[id].type;
    const catalog = GAME_CONFIG.buildings[type];
    if (!catalog) return false;

    const fee = Math.round((catalog.price * GAME_CONFIG.economy.moveFeeRatio) / 10) * 10;
    if (gameState.player.cash < fee) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `Taşıma için ${fee.toLocaleString('tr-TR')} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    let evicted = { unpaidLiters: 0, evicted: 0 };

    const moved = isPump ? state.pumps[id] : state.buildings[id];
    if (isPump) {
      // Whoever was being served at this bay has to be let go before it is
      // lifted, or they wait for a dispenser that is no longer there.
      evicted = evictFromPump(state, id);
      for (const employee of Object.values(state.employees)) {
        if (employee.assignedPumpId === id) employee.assignedPumpId = null;
      }
      delete state.pumps[id];
    } else {
      delete state.buildings[id];
    }

    if (fee > 0) {
      TransactionService.executeCashTransaction(state, {
        type: 'BUILD',
        amount: -fee,
        description: `${catalog.name} taşındı`
      });
    }

    const pump = isPump ? (moved as GameState['pumps'][string]) : null;
    const building = isPump ? null : (moved as GameState['buildings'][string]);

    set({
      gameState: state,
      selectedBuildingId: null,
      selectedPumpId: null,
      // Straight back into placement, holding what was just lifted, so the
      // level and the wear it had are not quietly reset by a rebuild.
      buildMode: {
        active: true,
        buildingType: type,
        position: snapPlacement(state, type, moved.position),
        rotation: moved.rotation,
        isValid: false
      },
      relocating: {
        type,
        level: moved.level,
        health: moved.health,
        // Kept so backing out puts it back exactly where it was.
        origin: moved.position,
        rotation: moved.rotation,
        // Whether the layout was still placing it before the player stepped in.
        wasMoved: building?.movedByPlayer ?? false,
        ...(pump
          ? {
              pump: {
                supportedFuels: pump.supportedFuels,
                flowRateLps: pump.flowRateLps,
                employeeId: pump.employeeId
              }
            }
          : {})
      }
    });

    if (evicted.evicted > 0) {
      get().addNotification({
        type: 'WARNING',
        title: 'Müşteri Kaybedildi!',
        message:
          `Pompa söküldü — ${evicted.evicted} müşteri hizmet alamadan ayrıldı.` +
          (evicted.unpaidLiters > 0 ? ` ${evicted.unpaidLiters} L yakıt ödenmeden gitti.` : '') +
          ` (-${(0.015 * evicted.evicted).toFixed(3)} İtibar)`
      });
    }

    return true;
  },

  toggleStationOpen: () => {
    sounds.playClick();
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    state.station.open = !state.station.open;

    // Shutting the doors clears the forecourt there and then, rather than
    // letting the cars already on it finish in a station that is closed.
    const cleared = state.station.open ? { left: 0, unpaidLiters: 0 } : closeForecourt(state);

    SaveManager.saveGame(state);
    set({
      gameState: state,
      // A dispensing panel for a car that has just driven off has nothing left
      // to dispense into.
      ...(cleared.left > 0 && get().activeModal === 'CUSTOMER_FUEL'
        ? { activeModal: 'NONE' as const, selectedVehicleId: null }
        : {})
    });

    if (state.station.open) {
      get().addNotification({
        type: 'INFO',
        title: 'İstasyon Açıldı',
        message: 'Yoldan müşteri kabul ediliyor.'
      });
      return;
    }

    get().addNotification({
      type: 'INFO',
      title: 'İstasyon Kapatıldı',
      message:
        cleared.left > 0
          ? `Tabelaya KAPALI yazıldı. Sahadaki ${cleared.left} araç işini bırakıp çıktı` +
            (cleared.unpaidLiters > 0
              ? ` — ${cleared.unpaidLiters} L yakıt ödenmeden gitti.`
              : '.')
          : 'Tabelaya KAPALI yazıldı; yoldan kimse gelmeyecek.'
    });
  },

  enterLandMode: () => {
    sounds.playClick();
    set({
      landMode: { active: true, hovered: null, action: 'NONE', price: 0, canBuy: false },
      buildMode: { active: false, buildingType: null, position: [0, 0], rotation: 0, isValid: true },
      activeModal: 'NONE'
    });
  },

  exitLandMode: () => {
    sounds.playClick();
    set({ landMode: { active: false, hovered: null, action: 'NONE', price: 0, canBuy: false } });
  },

  toggleEditMode: () => {
    sounds.playClick();
    const on = !get().editMode;

    // Rearranging a forecourt is a late-game luxury. Early on the plot is
    // small enough that where things go is a decision to get right, not one to
    // undo — and the move fee means it stays a cost even once it is unlocked.
    if (on && get().gameState.player.level < EDIT_MODE_LEVEL) {
      get().addNotification({
        type: 'WARNING',
        title: 'Düzenleme Kilitli',
        message: `Yapıları taşımak için Seviye ${EDIT_MODE_LEVEL} gerekiyor.`
      });
      return;
    }

    // Buying land and rearranging it are two different jobs, and a structure
    // panel left open belongs to neither.
    set({
      editMode: on,
      selectedBuildingId: null,
      selectedPumpId: null,
      ...(on
        ? {
            landMode: { active: false, hovered: null, action: 'NONE', price: 0, canBuy: false },
            activeModal: 'NONE' as const
          }
        : {})
    });
  },

  hoverParcel: (col, row) => {
    set((state) => {
      const owned = state.gameState.station.plots.ownedParcels;
      const buyable = isBuyable(owned, col, row, state.gameState.station.roadLevel);
      const price = buyable ? parcelPrice(owned, row) : 0;

      // An owned but unpaved parcel offers paving rather than a purchase.
      const paved = state.gameState.station.plots.pavedParcels;
      const needsPaving = isOwned(owned, col, row) && !isOwned(paved, col, row);
      const cost = needsPaving ? paveCost(row) : price;
      const action: LandModeState['action'] = needsPaving
        ? 'PAVE'
        : buyable
          ? 'BUY'
          : 'NONE';
      const canBuy = action !== 'NONE' && state.gameState.player.cash >= cost;

      // Bail out only when nothing at all would change. Comparing the parcel
      // alone would keep a stale offer on screen after the road is widened or
      // the cash balance moves.
      const before = state.landMode;
      if (
        before.hovered?.col === col &&
        before.hovered?.row === row &&
        before.action === action &&
        before.price === cost &&
        before.canBuy === canBuy
      ) {
        return state;
      }

      return {
        landMode: {
          active: before.active,
          hovered: { col, row },
          action,
          price: cost,
          canBuy
        }
      };
    });
  },

  buyHoveredParcel: () => {
    const { gameState, landMode } = get();
    if (!landMode.active || !landMode.hovered) return false;

    const { col, row } = landMode.hovered;
    const owned = gameState.station.plots.ownedParcels;

    if (!isBuyable(owned, col, row, gameState.station.roadLevel)) {
      get().addNotification({
        type: 'WARNING',
        title: 'Bu Arsa Alınamaz',
        message:
          gameState.station.roadLevel < 2 && row < 0
            ? 'Yolun karşısı ancak yol çift şeride çıkarıldıktan sonra açılır.'
            : 'Yalnızca sahip olduğunuz araziye komşu parseller satın alınabilir.'
      });
      return false;
    }

    const price = parcelPrice(owned, row);
    if (gameState.player.cash < price) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `Bu parsel ${price.toLocaleString('tr-TR')} TL. Kasada yeterli para yok.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'BUILD',
      amount: -price,
      description: `Arsa satın alımı (parsel ${col},${row})`
    });
    if (!tx.success) return false;

    // Land arrives bare and fenced; concrete is a separate job.
    state.station.plots.ownedParcels.push(parcelKey(col, row));
    const bounds = stationBounds(state.station.plots.ownedParcels);
    state.station.plots.width = bounds.width;
    state.station.plots.height = bounds.height;

    sounds.playBuildPlace();
    SaveManager.saveGame(state);
    set({
      gameState: state,
      landMode: { active: true, hovered: null, action: 'NONE', price: 0, canBuy: false }
    });

    get().addNotification({
      type: 'INFO',
      title: 'Arsa Satın Alındı',
      message: `${price.toLocaleString('tr-TR')} TL ödendi. Parsel çitle çevrildi — inşaat için beton dökmeniz gerekiyor.`
    });
    return true;
  },

  paveHoveredParcel: () => {
    const { gameState, landMode } = get();
    if (!landMode.active || !landMode.hovered) return false;

    const { col, row } = landMode.hovered;
    const { ownedParcels, pavedParcels } = gameState.station.plots;

    if (!isOwned(ownedParcels, col, row) || isOwned(pavedParcels, col, row)) return false;

    const cost = paveCost(row);
    if (gameState.player.cash < cost) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `Beton dökümü ${cost.toLocaleString('tr-TR')} TL tutuyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'BUILD',
      amount: -cost,
      description: `Beton dökümü (parsel ${col},${row})`
    });
    if (!tx.success) return false;

    state.station.plots.pavedParcels.push(parcelKey(col, row));

    sounds.playBuildPlace();
    SaveManager.saveGame(state);
    set({ gameState: state, landMode: { ...landMode, hovered: null, action: 'NONE', price: 0, canBuy: false } });

    get().addNotification({
      type: 'INFO',
      title: 'Beton Döküldü',
      message: 'Parsel artık inşaata hazır.'
    });
    return true;
  },

  upgradeRoad: () => {
    const { gameState } = get();
    const conf = GAME_CONFIG.roadUpgrade;

    if (gameState.station.roadLevel >= 2) return false;

    if (
      gameState.player.level < conf.minLevel ||
      gameState.player.reputation < conf.minReputation
    ) {
      get().addNotification({
        type: 'WARNING',
        title: 'Şartlar Sağlanmadı',
        message: `Yol genişletmesi için Seviye ${conf.minLevel} ve ${conf.minReputation.toFixed(2)} itibar gerekiyor.`
      });
      return false;
    }

    if (gameState.player.cash < conf.price) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `Yol genişletmesi ${conf.price.toLocaleString('tr-TR')} TL tutuyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'BUILD',
      amount: -conf.price,
      description: 'Karayolu genişletme çalışması'
    });
    if (!tx.success) return false;

    state.station.roadLevel = 2;

    sounds.playLevelUp();
    SaveManager.saveGame(state);
    set({ gameState: state });

    get().addNotification({
      type: 'REWARD',
      title: 'Yol Çift Şeride Çıktı!',
      message: 'Karayolu iki yönlü oldu. Yolun karşısındaki parseller artık satın alınabilir.'
    });
    return true;
  },

  upgradePump: (pumpId) => {
    const { gameState } = get();
    const pump = gameState.pumps[pumpId];
    if (!pump || pump.level >= 3) return false;

    const nextLevel = pump.level + 1;
    const upgradeConf = GAME_CONFIG.buildingUpgrades.pump_standard[nextLevel];
    if (!upgradeConf) return false;

    // The ladder the level screen promises: S2 opens at 3, S3 at 8.
    const requiredLevel = nextLevel === 3 ? 8 : 3;
    if (gameState.player.level < requiredLevel) {
      get().addNotification({
        type: 'WARNING',
        title: 'Seviye Yetersiz',
        message: `Pompa S${nextLevel} yükseltmesi için Seviye ${requiredLevel} gerekiyor.`
      });
      return false;
    }

    if (gameState.player.cash < upgradeConf.cost) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `Pompa Seviye ${nextLevel} için ${upgradeConf.cost.toLocaleString('tr-TR')} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'UPGRADE',
      amount: -upgradeConf.cost,
      description: `${pump.id} Seviye ${nextLevel} yükseltmesi`
    });

    if (!tx.success) return false;

    state.pumps[pumpId].level = nextLevel;
    state.pumps[pumpId].flowRateLps = upgradeConf.flowRateLps || 10;
    // Which fuels the pump dispenses is a separate purchase (addPumpFuel):
    // the ladder buys speed and durability, the nozzles buy reach.

    sounds.playLevelUp();
    SaveManager.saveGame(state);
    set({ gameState: state });
    get().addNotification({
      type: 'REWARD',
      title: 'Pompa Yükseltildi!',
      message: `${pump.id} artık Seviye ${nextLevel}! (${upgradeConf.effectsDescription})`
    });
    return true;
  },

  repairPump: (pumpId) => {
    const { gameState } = get();
    const pump = gameState.pumps[pumpId];
    if (!pump || pump.health >= 100) return false;

    const cost = calculateRepairCost(GAME_CONFIG.buildings.pump_standard.price, pump.health);
    if (gameState.player.cash < cost) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `Tamir için ${cost.toLocaleString('tr-TR')} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'REPAIR',
      amount: -cost,
      description: `${pump.id} bakımı ve onarımı`
    });

    if (!tx.success) return false;

    const repaired = state.pumps[pumpId];
    repaired.health = 100;
    // A broken pump has to go through MAINTENANCE before it can serve again.
    setPumpState(repaired, 'MAINTENANCE');
    setPumpState(repaired, 'IDLE');
    releasePump(repaired);
    state.player.statistics.repairActionsCount++;
    state.dayState.todayStats.repairs += cost;

    const repairEffects = createEffects();
    trackMissionMetric(state, 'PUMPS_REPAIRED', 1, repairEffects);
    flushEffects(state, repairEffects);

    sounds.playBuildPlace();
    SaveManager.saveGame(state);
    set({ gameState: state });
    get().addNotification({
      type: 'INFO',
      title: 'Bakım Tamamlandı',
      message: `${pump.id} tamamen onarıldı (%100 Sağlık).`
    });
    return true;
  },

  addPumpFuel: (pumpId, fuel) => {
    const { gameState } = get();
    const pump = gameState.pumps[pumpId];
    const module = GAME_CONFIG.pumpFuelModules[fuel];
    if (!pump || !module || pump.supportedFuels.includes(fuel)) return false;

    // Access opens with level; ownership is bought — per pump, with money.
    if (gameState.player.level < module.minLevel) {
      get().addNotification({
        type: 'WARNING',
        title: 'Seviye Yetersiz',
        message: `${GAME_CONFIG.fuels[fuel].shortName} tabancası için Seviye ${module.minLevel} gerekiyor.`
      });
      return false;
    }
    if (gameState.player.cash < module.cost) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `${GAME_CONFIG.fuels[fuel].shortName} tabancası için ${module.cost.toLocaleString('tr-TR')} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'UPGRADE',
      amount: -module.cost,
      description: `${pump.id} ${GAME_CONFIG.fuels[fuel].shortName} tabancası`
    });
    if (!tx.success) return false;

    state.pumps[pumpId].supportedFuels.push(fuel);

    sounds.playBuildPlace();
    SaveManager.saveGame(state);
    set({ gameState: state });
    get().addNotification({
      type: 'REWARD',
      title: 'Tabanca Takıldı',
      message: `${pump.id} artık ${GAME_CONFIG.fuels[fuel].shortName} basıyor.`
    });
    return true;
  },

  cleanVehicleWindows: (vehicleId) => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const vehicle = state.vehicles[vehicleId];
    if (!vehicle || vehicle.windowsCleaned) return;

    vehicle.windowsCleaned = true;
    sounds.playClick();
    set({ gameState: state });
  },

  dismissCustomer: (vehicleId) => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const vehicle = state.vehicles[vehicleId];
    if (!vehicle) return;

    dismissVehicle(state, vehicle);
    SaveManager.saveGame(state);
    set({ gameState: state, selectedVehicleId: null, activeModal: 'NONE' });
  },

  cleanStation: () => {
    const { gameState } = get();
    const cost = GAME_CONFIG.economy.siteCleanCost; // 300 TL

    if (gameState.player.cash < cost) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `Saha temizliği için ${cost} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'CLEAN',
      amount: -cost,
      description: 'İstasyon sahası ve cam temizliği'
    });

    if (!tx.success) return false;

    state.station.cleanliness = Math.min(100, state.station.cleanliness + 25);
    state.player.statistics.cleanActionsCount++;

    const cleanEffects = createEffects();
    trackMissionMetric(state, 'STATION_CLEANED', 1, cleanEffects);
    flushEffects(state, cleanEffects);

    sounds.playClick();
    SaveManager.saveGame(state);
    set({ gameState: state });
    get().addNotification({
      type: 'INFO',
      title: 'Saha Temizlendi',
      message: `İstasyon temizlik puanı: %${Math.round(state.station.cleanliness)}`
    });
    return true;
  },

  devUnlockEverything: () => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const topLevel = GAME_CONFIG.levels[GAME_CONFIG.levels.length - 1];

    state.player.level = topLevel.level;
    state.player.xp = Math.max(state.player.xp, topLevel.requiredTotalXp);
    state.player.reputation = 5;
    state.player.cash += 500000;

    // Every fuel needs a tank before it can be priced, ordered or sold.
    for (const fuelType of Object.keys(state.tanks) as FuelType[]) {
      const tank = state.tanks[fuelType];
      if (tank.capacity <= 0) {
        tank.capacity = 1500;
        tank.level = 1;
      }
    }

    // Existing pumps should be able to serve everything we now stock.
    for (const pump of Object.values(state.pumps)) {
      pump.supportedFuels = ['gasoline', 'diesel', 'lpg'];
    }

    // The manager's hiring bar checks the office, the crew and the books;
    // a test mode that leaves any of them short is a test mode that cannot
    // test the manager.
    for (const building of Object.values(state.buildings)) {
      if (building.type === 'office' && building.level < 2) building.level = 2;
    }
    state.player.statistics.recentNetProfits = [1000, 1000, 1000];
    const attendantCount = Object.values(state.employees).filter(
      (e) => e.role === 'PUMP_ATTENDANT'
    ).length;
    for (let i = attendantCount; i < 2; i++) {
      const id = 'emp_dev_' + Math.random().toString(36).substring(2, 7);
      const tier = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];
      state.employees[id] = {
        id,
        name: `Test Pompacı ${i + 1}`,
        role: 'PUMP_ATTENDANT',
        level: 1,
        wage: tier.dailyWage,
        state: 'UNASSIGNED',
        assignedPumpId: null,
        currentVehicleId: null,
        serviceCount: 0,
        actionTimerSeconds: 0,
        worldPosition: [0, 0, 0]
      } as GameState['employees'][string];
    }

    state.player.unlocks = Array.from(
      new Set([
        ...state.player.unlocks,
        'fuel_gasoline',
        'fuel_diesel',
        'fuel_lpg',
        ...Object.keys(GAME_CONFIG.buildings)
      ])
    );

    sounds.playLevelUp();
    SaveManager.saveGame(state);
    set({ gameState: state });

    get().addNotification({
      type: 'REWARD',
      title: 'Test Modu: Her Şey Açıldı',
      message: `Seviye ${topLevel.level}, 5.00 itibar, +500.000 TL ve tüm yapılar kullanıma açıldı.`
    });
  },

  // MANUAL FUELING
  openFuelingPanelForVehicle: (vehicleId) => {
    const { gameState } = get();
    const vehicle = gameState.vehicles[vehicleId];
    if (!vehicle) return;

    sounds.playPumpStart();
    set({
      selectedVehicleId: vehicleId,
      activeModal: 'CUSTOMER_FUEL'
    });
  },

  startVehicleFueling: (vehicleId, mode, targetValue) => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const vehicle = state.vehicles[vehicleId];
    if (!vehicle) return;

    const effects = createEffects();
    beginFueling(state, vehicle, mode, targetValue, 'PLAYER', effects);
    flushEffects(state, effects);
    set({ gameState: state });
  },

  dispenseFuelStep: (vehicleId, deltaSeconds) => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const vehicle = state.vehicles[vehicleId];
    if (!vehicle) return false;

    const effects = createEffects();
    const completed = dispenseStep(state, vehicle, deltaSeconds, effects);
    flushEffects(state, effects);
    set({ gameState: state });
    return completed;
  },

  completeVehicleFueling: (vehicleId) => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const vehicle = state.vehicles[vehicleId];
    if (!vehicle) return;

    const effects = createEffects();
    finalizeSale(state, vehicle, effects);
    flushEffects(state, effects);

    SaveManager.saveGame(state);
    set({
      gameState: state,
      selectedVehicleId: null,
      activeModal: 'NONE'
    });
  },

  // LOGISTICS / ORDERS
  orderFuel: (fuelType, liters) => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const effects = createEffects();

    const placed = placeFuelOrder(state, fuelType, liters, effects);
    flushEffects(state, effects);

    if (placed) SaveManager.saveGame(state);
    set({ gameState: state, activeModal: placed ? 'NONE' : get().activeModal });
    return placed;
  },

  cancelFuelOrder: (orderId) => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const orderIdx = state.fuelOrders.findIndex((o) => o.id === orderId);
    if (orderIdx === -1) return;

    const order = state.fuelOrders[orderIdx];
    if (order.state !== 'TRAVELLING') return;

    // Refund 85% of fuel cost, delivery fee not refunded
    const refundAmount = Math.round(order.liters * order.unitCost * GAME_CONFIG.economy.tankerCancelRefundRatio);
    TransactionService.executeCashTransaction(state, {
      type: 'REFUND',
      amount: refundAmount,
      description: `Tanker siparişi iptal iadesi (${order.fuelType})`
    });

    state.fuelOrders.splice(orderIdx, 1);
    sounds.playCashSound();
    SaveManager.saveGame(state);
    set({ gameState: state });

    get().addNotification({
      type: 'INFO',
      title: 'Sipariş İptal Edildi',
      message: `${refundAmount.toLocaleString('tr-TR')} TL (%85) iade edildi.`
    });
  },

  // PRICING
  setFuelPrice: (fuelType, price, strategy = 'CUSTOM') => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const pricing = state.pricing[fuelType];
    if (!pricing) return;

    pricing.playerPrice = Number(price.toFixed(2));
    pricing.priceStrategy = strategy;

    const effects = createEffects();
    trackMissionMetric(state, 'PRICE_SET', 1, effects);
    flushEffects(state, effects);

    sounds.playClick();
    SaveManager.saveGame(state);
    set({ gameState: state });
  },

  // LOANS
  takeLoan: (loanId) => {
    const { gameState } = get();
    const loanConf = GAME_CONFIG.loans.find((l) => l.id === loanId);
    if (!loanConf) return false;

    if (gameState.player.level < loanConf.minLevel || gameState.player.reputation < loanConf.minReputation) {
      get().addNotification({
        type: 'WARNING',
        title: 'Kredi Kilitli',
        message: `Bu kredi paketi için Seviye ${loanConf.minLevel} ve ${loanConf.minReputation} İtibar gerekiyor.`
      });
      return false;
    }

    const activeCount = gameState.loans.filter((l) => l.state === 'ACTIVE').length;
    if (activeCount >= 2) {
      get().addNotification({
        type: 'WARNING',
        title: 'Kredi Limiti',
        message: 'Aynı anda en fazla 2 aktif kredi kullanabilirsiniz.'
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const totalDue = Math.round(loanConf.principal * (1 + loanConf.totalCostRatio));

    TransactionService.executeCashTransaction(state, {
      type: 'LOAN_TAKEOUT',
      amount: loanConf.principal,
      description: `${loanConf.name} Çekildi`
    });

    state.loans.push({
      id: 'loan_' + Math.random().toString(36).substring(2, 8),
      productId: loanConf.id,
      name: loanConf.name,
      principal: loanConf.principal,
      totalDue,
      remaining: totalDue,
      dailyPayment: loanConf.dailyPayment,
      missedCount: 0,
      state: 'ACTIVE'
    });

    sounds.playCashSound();
    SaveManager.saveGame(state);
    set({ gameState: state, activeModal: 'NONE' });

    get().addNotification({
      type: 'INFO',
      title: 'Kredi Hesaba Yattı',
      message: `${loanConf.principal.toLocaleString('tr-TR')} TL kasaya eklendi. Günlük taksit: ${loanConf.dailyPayment.toLocaleString('tr-TR')} TL`
    });

    return true;
  },

  // EMPLOYEES
  hirePumpAttendant: () => {
    const { gameState } = get();
    const conf = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];
    if (gameState.player.cash < conf.hireCost) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `Pompacı işe alımı için ${conf.hireCost.toLocaleString('tr-TR')} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'WAGE_PAYMENT',
      amount: -conf.hireCost,
      description: 'Pompacı İşe Alım Bedeli'
    });

    if (!tx.success) return false;

    const names = ['Ahmet', 'Mehmet', 'Can', 'Burak', 'Emre', 'Serkan', 'Murat'];
    const randomName = names[Math.floor(Math.random() * names.length)];
    const empId = 'emp_' + Math.random().toString(36).substring(2, 8);

    state.employees[empId] = {
      id: empId,
      name: `${randomName} Usta`,
      role: 'PUMP_ATTENDANT',
      level: 1,
      wage: conf.dailyWage,
      assignedPumpId: 'pump_1',
      state: 'IDLE',
      serviceCount: 0,
      currentVehicleId: null,
      actionTimerSeconds: 0,
      worldPosition: [12, 0, 10]
    };

    sounds.playLevelUp();
    SaveManager.saveGame(state);
    set({ gameState: state, activeModal: 'NONE' });

    get().addNotification({
      type: 'REWARD',
      title: 'Pompacı İşe Alındı!',
      message: `${randomName} Usta göreve başladı. Pompaya gelen araçlara otomatik hizmet verecek.`
    });

    return true;
  },

  assignAttendantToPump: (employeeId, pumpId) => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const emp = state.employees[employeeId];
    if (!emp) return;

    emp.assignedPumpId = pumpId;
    sounds.playClick();
    SaveManager.saveGame(state);
    set({ gameState: state });
  },

  upgradeAttendant: (employeeId) => {
    const { gameState } = get();
    const emp = gameState.employees[employeeId];
    if (!emp || emp.level >= 3) return false;

    const nextLvl = emp.level + 1;
    const conf = GAME_CONFIG.employees.pumpAttendant.tierLevels[nextLvl - 1];
    if (!conf) return false;

    if (gameState.player.cash < conf.hireCost) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `Pompacı eğitimi için ${conf.hireCost.toLocaleString('tr-TR')} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'WAGE_PAYMENT',
      amount: -conf.hireCost,
      description: `${emp.name} Seviye ${nextLvl} Eğitimi`
    });

    if (!tx.success) return false;

    state.employees[employeeId].level = nextLvl;
    state.employees[employeeId].wage = conf.dailyWage;

    sounds.playLevelUp();
    SaveManager.saveGame(state);
    set({ gameState: state });

    get().addNotification({
      type: 'REWARD',
      title: 'Pompacı Eğitildi!',
      message: `${emp.name} artık Seviye ${nextLvl}! Hizmet hızı %${Math.round(conf.speedMultiplier * 100)}'a yükseldi.`
    });

    return true;
  },

  hireManager: () => {
    const { gameState } = get();
    const conf = GAME_CONFIG.employees.manager;

    // Every advertised requirement is enforced, not just the first two — a
    // hiring bar that the button ignores is a lie with a checkbox next to it.
    const officeLevel = Object.values(gameState.buildings)
      .filter((b) => b.type === 'office')
      .reduce((best, b) => Math.max(best, b.level), 0);
    const attendantCount = Object.values(gameState.employees).filter(
      (e) => e.role === 'PUMP_ATTENDANT'
    ).length;
    const recent = gameState.player.statistics.recentNetProfits ?? [];
    const profitableDays = recent.filter((n) => n > 0).length;

    const missing: string[] = [];
    if (gameState.player.level < conf.minLevel) missing.push(`Seviye ${conf.minLevel}`);
    if (gameState.player.reputation < conf.minReputation)
      missing.push(`${conf.minReputation.toFixed(2)} itibar`);
    if (officeLevel < conf.minOfficeLevel)
      missing.push(`Seviye ${conf.minOfficeLevel} Yönetim Ofisi`);
    if (attendantCount < conf.minActiveAttendants)
      missing.push(`${conf.minActiveAttendants} pompacı`);
    if (recent.length < 3 || profitableDays < conf.minProfitableDaysInLast3)
      missing.push(`son 3 günün ${conf.minProfitableDaysInLast3}'si kârlı olmalı`);

    if (missing.length > 0) {
      get().addNotification({
        type: 'WARNING',
        title: 'Şartlar Sağlanmadı',
        message: `Müdür için eksik: ${missing.join(', ')}.`
      });
      return false;
    }

    if (gameState.player.cash < conf.hireCost) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `İstasyon Müdürü işe alımı için ${conf.hireCost.toLocaleString('tr-TR')} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'WAGE_PAYMENT',
      amount: -conf.hireCost,
      description: 'İstasyon Müdürü İşe Alımı'
    });

    if (!tx.success) return false;

    state.station.managerId = 'manager_1';
    state.managerSettings.autoFuelOrder = true;
    state.managerSettings.autoPricing = true;

    sounds.playLevelUp();
    SaveManager.saveGame(state);
    set({ gameState: state, activeModal: 'NONE' });

    get().addNotification({
      type: 'REWARD',
      title: 'İstasyon Müdürü Göreve Başladı!',
      message: 'Otomasyon kuralları devrede. Stok ve fiyat yönetimi artık otomatik.'
    });

    return true;
  },

  updateManagerSettings: (settings) => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    state.managerSettings = { ...state.managerSettings, ...settings };
    sounds.playClick();
    SaveManager.saveGame(state);
    set({ gameState: state });
  },

  // SIMULATION TICK
  simulationTick: (deltaSeconds) => {
    const current = get().gameState;
    if (current.dayState.timeSpeed === 0 || !current.dayState.isDayActive) return;

    const startedAt = performance.now();
    const state = JSON.parse(JSON.stringify(current)) as GameState;
    const effects = createEffects();

    runSimulationTick(state, deltaSeconds, effects);
    flushEffects(state, effects);

    set({
      gameState: state,
      perfMetrics: {
        ...get().perfMetrics,
        activeVehicles: Object.keys(state.vehicles).length,
        simTickMs: Number((performance.now() - startedAt).toFixed(2))
      }
    });

    // The day-end report reads the state we just committed.
    if (effects.dayEnded) get().endDayAndShowReport();
  },


  endDayAndShowReport: () => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const effects = createEffects();

    state.dayState.timeSpeed = 0;
    state.dayState.isDayActive = false;
    state.dayState.isDayEnding = true;

    // Any customer still on the forecourt at closing time is a lost sale.
    for (const vehicle of Object.values(state.vehicles)) {
      // Anyone still waiting when the shutters come down was taken on and then
      // failed; anyone already leaving was not.
      const wasBeingServed =
        vehicle.state !== 'EXIT' && vehicle.state !== 'DESPAWN' && vehicle.state !== 'PASSING';
      if (wasBeingServed) {
        state.dayState.todayStats.customersLost++;
        state.player.statistics.totalCustomersLost++;
      }
      if (vehicle.targetPumpId && state.pumps[vehicle.targetPumpId]) {
        releasePump(state.pumps[vehicle.targetPumpId]);
      }
    }
    state.vehicles = {};
    for (const tank of Object.values(state.tanks)) tank.reservedStock = 0;

    // The manager lives outside the employees collection, which is how their
    // wage went uncollected for as long as the job existed.
    const managerWage = state.station.managerId ? GAME_CONFIG.employees.manager.dailyWage : 0;
    const totalWages =
      Object.values(state.employees).reduce((sum, e) => sum + e.wage, 0) + managerWage;

    let totalUpkeep = 0;
    for (const pump of Object.values(state.pumps)) {
      totalUpkeep += GAME_CONFIG.buildings.pump_standard.dailyUpkeep;
      // Upgraded hardware costs proportionally more to keep running.
      totalUpkeep += (pump.level - 1) * 40;
    }
    for (const bld of Object.values(state.buildings)) {
      const conf = GAME_CONFIG.buildings[bld.type];
      if (conf) totalUpkeep += conf.dailyUpkeep;
    }

    let totalLoans = 0;
    for (const loan of state.loans) {
      if (loan.state !== 'ACTIVE') continue;

      const payment = Math.min(loan.dailyPayment, loan.remaining);
      const affordable = state.player.cash - (totalWages + totalUpkeep + totalLoans) >= payment;

      if (!affordable) {
        loan.missedCount++;
        state.player.reputation = Math.max(1, state.player.reputation - 0.1);
        effects.notifications.push({
          type: 'CRITICAL',
          title: 'Kredi Taksiti Ödenemedi!',
          message: `${loan.name} taksiti karşılanamadı (${loan.missedCount}. gecikme). İtibar -0.10.`
        });
        continue;
      }

      loan.remaining -= payment;
      totalLoans += payment;
      if (loan.remaining <= 0) {
        loan.remaining = 0;
        loan.state = 'PAID_OFF';
        effects.notifications.push({
          type: 'REWARD',
          title: 'Kredi Kapandı',
          message: `${loan.name} tamamen ödendi.`
        });
      }
    }

    state.dayState.todayStats.wages = totalWages;
    state.dayState.todayStats.upkeep = totalUpkeep;
    state.dayState.todayStats.loanPayments = totalLoans;

    const totalDailyExpenses = totalWages + totalUpkeep + totalLoans;
    if (totalDailyExpenses > 0) {
      TransactionService.executeCashTransaction(state, {
        type: 'UPKEEP',
        amount: -totalDailyExpenses,
        description: `Gün sonu sabit giderler (Maaş: ${totalWages} TL, Bakım: ${totalUpkeep} TL, Kredi: ${totalLoans} TL)`,
        allowOverdraft: true
      });
    }

    // Reputation follows the day's actual average service score, and how many
    // of the customers the station *took on* it then failed.
    //
    // This used to dock a flat amount for every lost customer, which included
    // every driver who found the forecourt full and carried on. On a busy road
    // that is dozens a day, so reputation fell however well the place was run —
    // the busier the highway, the worse the station's name. A rate, capped,
    // measures the thing the player can actually do something about.
    const served = state.dayState.todayStats.customersServed;
    const failed = state.dayState.todayStats.customersLost;
    const avgScore = served > 0 ? state.dayState.todayStats.serviceScoreSum / served : 60;
    const tookOn = served + failed;
    const lostPenalty = tookOn > 0 ? Math.min(0.35, (failed / tookOn) * 0.6) : 0;
    state.player.reputation = calculateEndOfDayReputation(
      state.player.reputation,
      avgScore,
      -lostPenalty
    );

    // Word of mouth about the board: priced under the region, the name creeps
    // up; gouging, it slides. The formula produced this figure from day one —
    // it was simply never applied.
    state.player.reputation = Math.min(
      5,
      Math.max(1, state.player.reputation + dailyPriceReputationDelta(state))
    );

    // The last three days' net, for anyone who asks whether the place is
    // actually making money — the manager's hiring bar does.
    const t = state.dayState.todayStats;
    const netProfit =
      t.fuelRevenue + t.tips + t.marketRevenue -
      (t.fuelCost + t.marketCost + t.repairs + totalWages + totalUpkeep + totalLoans);
    state.player.statistics.recentNetProfits = [
      ...(state.player.statistics.recentNetProfits ?? []),
      Math.round(netProfit)
    ].slice(-3);

    state.player.statistics.daysCompleted++;

    trackMissionMetric(state, 'DAYS_COMPLETED', 1, effects);
    flushEffects(state, effects);

    sounds.playLevelUp();
    SaveManager.saveGame(state);

    set({
      gameState: state,
      selectedVehicleId: null,
      activeModal: 'DAY_REPORT'
    });
  },

  startNextDay: () => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    state.dayState.currentDay++;
    state.dayState.gameTime = GAME_CONFIG.economy.dayStartHour;
    state.dayState.timeSpeed = 1;
    // One discounted window a day, at an hour drawn fresh each morning.
    state.dayState.fuelDealDoneToday = false;
    state.dayState.fuelDealSecondsLeft = 0;
    state.dayState.fuelDealAtHour = undefined;
    state.dayState.isDayActive = true;
    state.dayState.isDayEnding = false;
    state.dayState.weather = (['SUNNY', 'SUNNY', 'OVERCAST', 'RAIN'] as const)[
      Math.floor(Math.random() * 4)
    ];

    // Yesterday's events are over; roll a fresh market shock for the new day.
    const effects = createEffects();
    state.activeEvents = [];
    state.todayEventIds = [];
    rollDailyEvent(state, effects);

    // Roll tomorrow's wholesale prices and let the regional average drift with them.
    const eventModifier = getWholesaleEventModifier(state);
    for (const fuelType of Object.keys(state.pricing) as FuelType[]) {
      const conf = GAME_CONFIG.fuels[fuelType];
      const volatility = (Math.random() * 2 - 1) * conf.dailyVolatility;
      const wholesale = calculateDailyWholesalePrice(
        conf.baseWholesale,
        0,
        volatility,
        eventModifier
      );
      state.pricing[fuelType].todayWholesaleCost = wholesale;
      state.pricing[fuelType].regionalAverage = Number(
        (wholesale + conf.targetMargin).toFixed(2)
      );
    }

    generateDailyMissions(state);
    flushEffects(state, effects);

    state.dayState.todayStats = {
      fuelRevenue: 0,
      fuelCost: 0,
      marketRevenue: 0,
      marketCost: 0,
      tips: 0,
      wages: 0,
      upkeep: 0,
      loanPayments: 0,
      repairs: 0,
      customersServed: 0,
      customersLost: 0,
      serviceScoreSum: 0
    };

    // Restock the mini-market shelves for the new day.
    if (state.market.active) state.market.stock = 100;

    sounds.playClick();
    SaveManager.saveGame(state);

    set({
      gameState: state,
      activeModal: 'NONE'
    });
  },

  claimMissionReward: (missionId) => {
    const state = JSON.parse(JSON.stringify(get().gameState)) as GameState;
    const mission = state.missions.find((m) => m.id === missionId);
    if (!mission || !mission.completed || mission.claimed) return false;

    mission.claimed = true;
    if (mission.rewardCash > 0) {
      TransactionService.executeCashTransaction(state, {
        type: 'MISSION_REWARD',
        amount: mission.rewardCash,
        description: `Görev ödülü: ${mission.description}`
      });
    }
    state.player.xp += mission.rewardXp;

    const effects = createEffects();
    applyLevelProgression(state, effects);
    flushEffects(state, effects);

    sounds.playCashSound();
    SaveManager.saveGame(state);
    set({ gameState: state });

    get().addNotification({
      type: 'REWARD',
      title: 'Görev Ödülü Alındı',
      message: `+${mission.rewardCash.toLocaleString('tr-TR')} TL, +${mission.rewardXp} XP`
    });
    return true;
  },

  resetGameSave: () => {
    const fresh = SaveManager.resetSave();
    sounds.playClick();
    set({
      gameState: fresh,
      activeModal: 'NONE',
      selectedVehicleId: null,
      selectedPumpId: null,
      selectedBuildingId: null,
      // The world shrinks back to the starting plot, so a camera left over the
      // old expansion would be staring at empty countryside.
      cameraTarget: [16, 12],
      cameraZoom: 4,
      cameraAngle: 225,
      buildMode: { active: false, buildingType: null, position: [0, 0], rotation: 0, isValid: true },
      landMode: { active: false, hovered: null, action: 'NONE', price: 0, canBuy: false }
    });
  },

  updatePerfMetrics: (metrics) => {
    set((state) => ({
      perfMetrics: { ...state.perfMetrics, ...metrics }
    }));
  }
  };
});

// Development aid: lets browser-driven tests inspect live store state.
// Stripped from production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__store = useGameStore;
}
