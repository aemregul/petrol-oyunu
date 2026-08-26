/**
 * Project Highway - Central Zustand Game Store
 * Connects domain engine, simulation loop and UI components.
 */

import { create } from 'zustand';
import { GameState, FuelType, VehicleArchetype, BuildingEntity, GameNotification } from '../domain/types/gameState';
import { SaveManager } from '../domain/services/SaveManager';
import { TransactionService } from '../domain/services/TransactionService';
import { GAME_CONFIG } from '../config/gameConfig';
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
  defaultMouthX,
  getLayout,
  DRIVEWAY_Z
} from '../domain/services/simulationEngine';
import { evaluatePlacement, snapPlacement } from '../domain/services/placement';
import {
  stationBounds,
  parcelKey,
  isBuyable,
  parcelPrice,
  paveCost,
  isOwned
} from '../domain/services/land';
import { sounds } from '../audio/soundEffects';

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
  landMode: LandModeState;
  cameraAngle: number; // 0, 90, 180, 270
  cameraZoom: number; // 1 to 7
  /** Point on the ground the camera orbits, in world units. */
  cameraTarget: [number, number];
  perfMetrics: PerformanceMetrics;
  lastUndoBuildingId: string | null;
  lastUndoTimer: number;

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
  setTimeSpeed: (speed: 0 | 1 | 2 | 4) => void;
  addNotification: (notif: Omit<GameNotification, 'id' | 'timestamp'>) => void;
  dismissNotification: (id: string) => void;

  // Build Mode
  enterBuildMode: (buildingType: string) => void;
  exitBuildMode: () => void;
  setBuildPreviewPos: (pos: [number, number]) => void;
  rotateBuildPreview: () => void;
  confirmBuildPlacement: () => boolean;
  undoLastBuild: () => void;
  enterLandMode: () => void;
  exitLandMode: () => void;
  hoverParcel: (col: number, row: number) => void;
  buyHoveredParcel: () => boolean;
  paveHoveredParcel: () => boolean;
  /** Widens the highway to a dual carriageway and opens the far side. */
  upgradeRoad: () => boolean;
  upgradePump: (pumpId: string) => boolean;
  repairPump: (pumpId: string) => boolean;
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
  landMode: { active: false, hovered: null, action: 'NONE', price: 0, canBuy: false },
  cameraAngle: 225, // Yol sol üstten sağ alta iner, istasyon sağında kalır
  cameraZoom: 4,
  cameraTarget: [16, 12], // Küçük başlangıç arsasının merkezi (dünya birimi)
  perfMetrics: {
    fps: 60,
    activeVehicles: 0,
    drawCalls: 120,
    simTickMs: 0.5
  },
  lastUndoBuildingId: null,
  lastUndoTimer: 0,

  setActiveModal: (modal) => {
    sounds.playClick();
    set({ activeModal: modal });
  },

  selectVehicle: (id) => set({ selectedVehicleId: id }),
  selectPump: (id) => set({ selectedPumpId: id }),
  selectBuilding: (id) => set({ selectedBuildingId: id }),

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

      return {
        cameraTarget: [
          Math.max(-30, Math.min(90, state.cameraTarget[0] - worldX)),
          Math.max(-30, Math.min(80, state.cameraTarget[1] - worldZ))
        ]
      };
    });
  },

  resetCamera: () => {
    sounds.playClick();
    set({ cameraTarget: [16, 12], cameraZoom: 4, cameraAngle: 225 });
  },

  setTimeSpeed: (speed) => {
    sounds.playClick();
    set((state) => ({
      gameState: {
        ...state.gameState,
        dayState: { ...state.gameState.dayState, timeSpeed: speed }
      }
    }));
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
    set({
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

    if (gameState.player.cash < catalog.price) {
      get().addNotification({
        type: 'WARNING',
        title: 'Yetersiz Bakiye',
        message: `${catalog.name} için ${catalog.price.toLocaleString('tr-TR')} TL gerekiyor.`
      });
      return false;
    }

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    const tx = TransactionService.executeCashTransaction(state, {
      type: 'BUILD',
      amount: -catalog.price,
      description: `${catalog.name} inşası`
    });

    if (!tx.success) return false;

    if (catalog.category === 'tank') {
      const TANK_FUELS: Record<string, FuelType> = {
        tank_gasoline: 'gasoline',
        tank_diesel: 'diesel',
        tank_lpg: 'lpg'
      };
      const fuelType = TANK_FUELS[buildMode.buildingType];

      if (fuelType) {
        // Each package adds storage, so a second tank doubles the capacity
        // instead of silently replacing the first.
        const tank = state.tanks[fuelType];
        tank.capacity += 1500;
        tank.level = Math.max(1, tank.level);
        if (!state.player.unlocks.includes(`fuel_${fuelType}`)) {
          state.player.unlocks.push(`fuel_${fuelType}`);
        }
      }

      // The tank itself is buried, but its filler caps and vent stack are
      // above ground — and the player should see what they paid for.
      const tankId = 'bld_' + Math.random().toString(36).substring(2, 7);
      state.buildings[tankId] = {
        id: tankId,
        type: buildMode.buildingType,
        level: 1,
        position: buildMode.position,
        rotation: buildMode.rotation,
        size: catalog.size,
        health: 100,
        constructionState: 'ACTIVE',
        builtAtTimestamp: Date.now()
      };
    } else if (catalog.category === 'pump') {
      const newPumpId = 'pump_' + (Object.keys(state.pumps).length + 1);
      state.pumps[newPumpId] = {
        id: newPumpId,
        level: 1,
        position: buildMode.position,
        rotation: buildMode.rotation,
        supportedFuels: ['gasoline'],
        state: 'IDLE',
        health: 100,
        employeeId: null,
        currentVehicleId: null,
        flowRateLps: 8
      };
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

      const bId = 'bld_' + Math.random().toString(36).substring(2, 7);
      state.buildings[bId] = {
        id: bId,
        type: buildMode.buildingType,
        level: 1,
        position: buildMode.position,
        rotation: buildMode.rotation,
        size: catalog.size,
        health: 100,
        constructionState: 'ACTIVE',
        builtAtTimestamp: Date.now()
      };
      if (buildMode.buildingType === 'mini_market') {
        state.market.active = true;
        state.market.stock = 50;
      }
    }

    // Award XP
    const xpReward = Math.min(150, Math.round((catalog.price / 1000) * 3));
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
      lastUndoBuildingId: buildMode.buildingType,
      lastUndoTimer: Date.now() + GAME_CONFIG.economy.undoTimeoutSeconds * 1000
    });

    get().addNotification({
      type: 'INFO',
      title: 'İnşaat Tamamlandı',
      message: `${catalog.name} başarıyla kuruldu. (+${xpReward} XP)`
    });

    return true;
  },

  undoLastBuild: () => {
    // 10s undo logic
    const { gameState, lastUndoBuildingId, lastUndoTimer } = get();
    if (!lastUndoBuildingId || Date.now() > lastUndoTimer) return;

    const catalog = GAME_CONFIG.buildings[lastUndoBuildingId];
    if (!catalog) return;

    const state = JSON.parse(JSON.stringify(gameState)) as GameState;
    TransactionService.executeCashTransaction(state, {
      type: 'REFUND',
      amount: catalog.price,
      description: `${catalog.name} inşası geri alındı`
    });

    sounds.playCashSound();
    SaveManager.saveGame(state);
    set({ gameState: state, lastUndoBuildingId: null, lastUndoTimer: 0 });
    get().addNotification({
      type: 'INFO',
      title: 'İnşaat Geri Alındı',
      message: `${catalog.price.toLocaleString('tr-TR')} TL iade edildi.`
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
    if (nextLevel >= 2 && state.tanks.diesel.capacity > 0) {
      if (!state.pumps[pumpId].supportedFuels.includes('diesel')) {
        state.pumps[pumpId].supportedFuels.push('diesel');
      }
    }
    if (nextLevel >= 3 && state.tanks.lpg.capacity > 0) {
      if (!state.pumps[pumpId].supportedFuels.includes('lpg')) {
        state.pumps[pumpId].supportedFuels.push('lpg');
      }
    }

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

    if (gameState.player.level < conf.minLevel || gameState.player.reputation < conf.minReputation) {
      get().addNotification({
        type: 'WARNING',
        title: 'Şartlar Sağlanmadı',
        message: `Müdür için Seviye ${conf.minLevel} ve ${conf.minReputation} İtibar gerekiyor.`
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
      const wasBeingServed = vehicle.state !== 'EXIT' && vehicle.state !== 'DESPAWN';
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

    const totalWages = Object.values(state.employees).reduce((sum, e) => sum + e.wage, 0);

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

    // Reputation follows the day's actual average service score.
    const served = state.dayState.todayStats.customersServed;
    const avgScore = served > 0 ? state.dayState.todayStats.serviceScoreSum / served : 60;
    const lostPenalty = state.dayState.todayStats.customersLost * 0.01;
    state.player.reputation = calculateEndOfDayReputation(
      state.player.reputation,
      avgScore,
      -lostPenalty
    );
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
