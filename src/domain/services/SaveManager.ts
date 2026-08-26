/**
 * Project Highway - Master Save & Persistence Manager
 * GDD Section 25: Save strategy, schema migration, 3-slot backup, atomic saving
 */

import { GameState } from '../types/gameState';
import { createInitialGameState } from '../types/initialState';

const PRIMARY_SAVE_KEY = 'project_highway_v1_save';
const BACKUP_SAVE_KEYS = [
  'project_highway_v1_backup_1',
  'project_highway_v1_backup_2',
  'project_highway_v1_backup_3'
];

export class SaveManager {
  private static lastSaveTime: number = 0;

  /**
   * Save game state with 3-generation backup rotation
   */
  public static saveGame(state: GameState): boolean {
    try {
      state.updatedAt = Date.now();
      const serialized = JSON.stringify(state);

      // Rotate backups before overwriting primary
      const existingPrimary = localStorage.getItem(PRIMARY_SAVE_KEY);
      if (existingPrimary) {
        const b2 = localStorage.getItem(BACKUP_SAVE_KEYS[1]);
        if (b2) localStorage.setItem(BACKUP_SAVE_KEYS[2], b2);
        const b1 = localStorage.getItem(BACKUP_SAVE_KEYS[0]);
        if (b1) localStorage.setItem(BACKUP_SAVE_KEYS[1], b1);
        localStorage.setItem(BACKUP_SAVE_KEYS[0], existingPrimary);
      }

      localStorage.setItem(PRIMARY_SAVE_KEY, serialized);
      this.lastSaveTime = Date.now();
      return true;
    } catch (err) {
      console.error('[SaveManager] Kayıt hatası:', err);
      return false;
    }
  }

  /**
   * Load game state with migration and fallback to backups
   */
  public static loadGame(): GameState {
    try {
      const primaryData = localStorage.getItem(PRIMARY_SAVE_KEY);
      if (primaryData) {
        const parsed = JSON.parse(primaryData);
        return this.migrateState(parsed);
      }

      // Try fallback backups
      for (const backupKey of BACKUP_SAVE_KEYS) {
        const backupData = localStorage.getItem(backupKey);
        if (backupData) {
          console.warn(`[SaveManager] Ana kayıt bulunamadı, ${backupKey} yedeği yüklendi.`);
          const parsed = JSON.parse(backupData);
          return this.migrateState(parsed);
        }
      }
    } catch (err) {
      console.error('[SaveManager] Kayıt okuma hatası, sıfırdan başlatılıyor:', err);
    }

    // Default initial state
    const freshState = createInitialGameState();
    this.saveGame(freshState);
    return freshState;
  }

  /**
   * Migrate old save schemas if necessary
   */
  private static migrateState(rawState: any): GameState {
    const defaultState = createInitialGameState();

    if (!rawState || typeof rawState !== 'object') {
      return defaultState;
    }

    // The plot rework changed the size and meaning of the station grid, so
    // older saves cannot be carried forward and start fresh instead.
    if (rawState.schemaVersion !== defaultState.schemaVersion) {
      console.warn('[SaveManager] Eski kayıt sürümü bulundu, oyun sıfırdan başlatılıyor.');
      return defaultState;
    }

    // Deep merge / fallback for newly introduced fields
    const state: GameState = {
      ...defaultState,
      ...rawState,
      player: { ...defaultState.player, ...(rawState.player || {}) },
      station: { ...defaultState.station, ...(rawState.station || {}) },
      tanks: { ...defaultState.tanks, ...(rawState.tanks || {}) },
      pricing: { ...defaultState.pricing, ...(rawState.pricing || {}) },
      // Entity collections replace rather than merge. Merging the starting
      // pump and buildings back in meant anything the player sold or knocked
      // down quietly reappeared the next time they loaded the game.
      pumps: rawState.pumps ?? defaultState.pumps,
      vehicles: rawState.vehicles || {},
      employees: rawState.employees || {},
      buildings: rawState.buildings ?? defaultState.buildings,
      fuelOrders: rawState.fuelOrders || [],
      loans: rawState.loans || [],
      missions: this.migrateMissions(rawState.missions, defaultState.missions),
      activeEvents: rawState.activeEvents || [],
      todayEventIds: rawState.todayEventIds || [],
      dayState: {
        ...defaultState.dayState,
        ...(rawState.dayState || {}),
        todayStats: {
          ...defaultState.dayState.todayStats,
          ...((rawState.dayState || {}).todayStats || {})
        }
      },
      market: { ...defaultState.market, ...(rawState.market || {}) },
      managerSettings: { ...defaultState.managerSettings, ...(rawState.managerSettings || {}) },
      managerLogs: rawState.managerLogs || [],
      settings: { ...defaultState.settings, ...(rawState.settings || {}) },
      notifications: rawState.notifications || [],
      transactionLog: rawState.transactionLog || []
    };

    return state;
  }

  /**
   * Keeps a save's mission progress while re-syncing the definitions (targets,
   * descriptions, rewards) with the current config.
   */
  private static migrateMissions(
    saved: any,
    defaults: GameState['missions']
  ): GameState['missions'] {
    if (!Array.isArray(saved) || saved.length === 0) return defaults;

    const tutorials = defaults.map((definition) => {
      const previous = saved.find((m: any) => m?.templateId === definition.templateId);
      if (!previous) return definition;

      const progress = Math.min(definition.target, previous.progress ?? 0);
      return {
        ...definition,
        progress,
        completed: previous.claimed ? true : progress >= definition.target,
        claimed: Boolean(previous.claimed)
      };
    });

    // Daily missions are generated at runtime, so carry them over as they are.
    const dailies = saved.filter(
      (m: any) => m && m.type !== 'TUTORIAL' && typeof m.metric === 'string'
    );

    return [...tutorials, ...dailies];
  }

  /**
   * Reset save data
   */
  public static resetSave(): GameState {
    try {
      localStorage.removeItem(PRIMARY_SAVE_KEY);
      for (const key of BACKUP_SAVE_KEYS) {
        localStorage.removeItem(key);
      }
    } catch (err) {
      console.error('[SaveManager] Sıfırlama hatası:', err);
    }
    const freshState = createInitialGameState();
    this.saveGame(freshState);
    return freshState;
  }

  public static getLastSaveTime(): number {
    return this.lastSaveTime;
  }
}
