import { ATTENDANT_HIRE_LEVEL, EDIT_MODE_LEVEL, GAME_CONFIG } from '../../config/gameConfig';
import type { GameState } from '../types/gameState';
import { STARTING_PARCELS } from './land';

/**
 * The main mission chain (Emre, 2026-09-12). The old tutorial list put six
 * goals on the board at once; one asked for an "İnşaat modu" nobody could
 * find — a player wrote in to say so — and another for a report screen the
 * game no longer has. The chain gives one goal at a time, in the order the
 * game opens up, and a Göster button that walks the player to the thing to
 * press.
 *
 * Progress is read from the station itself — customers served, what stands
 * on the plot, who is on the payroll — so a goal already met when it comes
 * round is simply done, and a save from before the chain can be brought up
 * to where it really stands. Only the step reached is saved.
 */

export interface ChainStep {
  id: string;
  /** What to do: the card's headline. */
  title: string;
  /** Why, in one line. */
  detail: string;
  target: number;
  /** How far the station has come on it, read from the save. */
  progress: (state: GameState) => number;
  /**
   * The level the game opens this at. Below it the card shows the level to
   * reach instead, so the chain never asks for something the game still locks.
   */
  level?: number;
  /** The catalogue item the step builds, if it builds one. */
  builds?: string;
  rewardCash: number;
  rewardXp: number;
  /** The guide its Göster button starts. */
  guide: string;
}

const stats = (state: GameState) => state.player.statistics;
const served = (state: GameState) => stats(state).totalCustomersServed;

/** A step that is done once one of these stands on the station. */
function build(
  type: string,
  title: string,
  detail: string,
  rewardCash: number,
  rewardXp: number,
  alsoCounts: string[] = []
): ChainStep {
  const counted = [type, ...alsoCounts];
  return {
    id: type,
    title,
    detail,
    target: 1,
    progress: (state) => Object.values(state.buildings).filter((b) => counted.includes(b.type)).length,
    level: GAME_CONFIG.buildings[type].unlockLevel,
    builds: type,
    rewardCash,
    rewardXp,
    guide: `guide_build_${type}`
  };
}

export const MISSION_CHAIN: ChainStep[] = [
  {
    id: 'serve_first',
    title: 'İlk müşteriye hizmet et',
    detail: 'Pompaya yanaşan araca tıkla, yakıtını doldur, parasını al.',
    target: 1,
    progress: served,
    rewardCash: 500,
    rewardXp: 50,
    guide: 'guide_serve'
  },
  {
    id: 'set_price',
    title: 'Satış fiyatını ayarla',
    detail: "Ofis'in Fiyat sekmesinde fiyatını bölge ortalamasına göre belirle.",
    target: 1,
    progress: (state) => stats(state).priceChanges ?? 0,
    rewardCash: 500,
    rewardXp: 50,
    guide: 'guide_price'
  },
  {
    id: 'order_fuel',
    title: 'Yakıt siparişi ver',
    detail: "Tank boşalmadan Tedarik'ten tanker çağır.",
    target: 1,
    progress: (state) => state.fuelOrders.length + state.fuelPurchaseHistory.length,
    rewardCash: 500,
    rewardXp: 75,
    guide: 'guide_order'
  },
  {
    id: 'serve_10',
    title: '10 müşteriye hizmet et',
    detail: 'Her hizmet XP getirir; seviye böyle atlanır.',
    target: 10,
    progress: served,
    rewardCash: 800,
    rewardXp: 60,
    guide: 'guide_serve'
  },
  build('trash_can', 'Çöp kutusu kur', 'Saha %30 daha yavaş kirlenir.', 600, 60),
  {
    id: 'finish_day',
    title: 'İlk günü tamamla',
    detail: 'Gün ertesi sabah kapanır; her sabah yeni günlük görevler gelir.',
    target: 1,
    progress: (state) => stats(state).daysCompleted,
    rewardCash: 1000,
    rewardXp: 100,
    guide: 'guide_day'
  },
  {
    id: 'clean_site',
    title: 'Sahayı temizle',
    detail: "Kirli saha müşteri memnuniyetini düşürür; Bakım'dan temizlenir.",
    target: 1,
    progress: (state) => stats(state).cleanActionsCount,
    rewardCash: 600,
    rewardXp: 50,
    guide: 'guide_clean'
  },
  {
    id: 'hire_attendant',
    title: 'Pompacı işe al',
    detail: 'Pompacı gelen araçları senin yerine doldurur.',
    target: 1,
    level: ATTENDANT_HIRE_LEVEL,
    progress: (state) => Object.values(state.employees).filter((e) => e.role === 'PUMP_ATTENDANT').length,
    rewardCash: 2000,
    rewardXp: 100,
    guide: 'guide_attendant'
  },
  build('light_pole', 'Aydınlatma direği kur', 'Gece istasyonun görünür ve güvenli olur.', 800, 60),
  {
    id: 'second_pump',
    title: 'İkinci pompayı kur',
    detail: 'Aynı anda iki araç dolar, kuyruk erir.',
    target: 2,
    level: GAME_CONFIG.buildings.pump_standard.unlockLevel,
    builds: 'pump_standard',
    progress: (state) => Object.keys(state.pumps).length,
    rewardCash: 3000,
    rewardXp: 150,
    guide: 'guide_build_pump_standard'
  },
  build('car_park', 'Otopark kur', 'Yoldan geçenler park edip tesislerine yürür.', 2000, 100),
  {
    id: 'move_structure',
    title: 'Bir yapıyı taşı',
    detail: 'Soldaki Düzenle düğmesiyle bir yapıyı alıp yeni yerine koy.',
    target: 1,
    level: EDIT_MODE_LEVEL,
    progress: (state) => stats(state).structuresMoved ?? 0,
    rewardCash: 1000,
    rewardXp: 80,
    guide: 'guide_move'
  },
  {
    id: 'canopy',
    title: 'Pompaya sundurma tak',
    detail: 'O pompada dolum %5 hızlanır, saha daha az kirlenir.',
    target: 1,
    level: GAME_CONFIG.buildings.canopy.unlockLevel,
    builds: 'canopy',
    progress: (state) => Object.values(state.pumps).filter((p) => p.hasCanopy).length,
    rewardCash: 2500,
    rewardXp: 120,
    guide: 'guide_canopy'
  },
  // The rest complex is the café and the shop of its block, so it counts as both.
  build('cafe', 'Kahveci aç', 'Yakıttan ayrı gelir: sürücüler mola verip harcar.', 4000, 150, ['rest_complex']),
  build('mini_market', 'Mini market aç', 'Yakıt alan müşteriler sepet doldurur.', 5000, 200, ['rest_complex']),
  {
    id: 'buy_land',
    title: 'Yeni arsa al',
    detail: "İnşaat'ın Arsa sekmesinden komşu parseli al, betonunu dök.",
    target: 1,
    progress: (state) => state.station.plots.ownedParcels.length - STARTING_PARCELS.length,
    rewardCash: 5000,
    rewardXp: 200,
    guide: 'guide_land'
  },
  build('ev_substation', 'Elektrik altyapısı kur', 'Trafo şebekeden enerji çeker; batarya ve şarj ona bağlanır.', 6000, 200),
  build('ev_storage', 'Enerji depolama kur', 'Şarj üniteleri ve güneş panelleri bu bataryadan çalışır.', 6000, 200),
  build('ev_charger_ac', 'AC şarj ünitesi kur', "Elektrikli araçlar da uğrar; kWh fiyatı Ofis'ten ayarlanır.", 5000, 200),
  {
    id: 'solar',
    title: 'Sundurmaya güneş paneli tak',
    detail: 'Gündüz panelden bataryaya bedava elektrik akar.',
    target: 1,
    level: GAME_CONFIG.ev.solar.unlockLevel,
    progress: (state) => Object.values(state.pumps).filter((p) => p.hasSolarCanopy).length,
    rewardCash: 8000,
    rewardXp: 250,
    guide: 'guide_solar'
  },
  {
    id: 'manager',
    title: 'İstasyon müdürü işe al',
    detail: 'Müdür istasyonu senin yerine yönetir.',
    target: 1,
    level: GAME_CONFIG.employees.manager.minLevel,
    progress: (state) => (state.station.managerId ? 1 : 0),
    rewardCash: 20000,
    rewardXp: 0,
    guide: 'guide_manager'
  }
];

export interface ChainStatus {
  index: number;
  step: ChainStep;
  /** Progress so far, never past the target. */
  value: number;
  /** The game has not opened this yet: the step waits on a level. */
  locked: boolean;
  complete: boolean;
}

const isLocked = (state: GameState, step: ChainStep) =>
  step.level !== undefined && state.player.level < step.level;

const isDone = (state: GameState, step: ChainStep) =>
  !isLocked(state, step) && step.progress(state) >= step.target;

/** The step the chain is on, or null once every step has been claimed. */
export function chainStatus(state: GameState): ChainStatus | null {
  const index = state.missionChain?.step ?? 0;
  const step = MISSION_CHAIN[index];
  if (!step) return null;
  const locked = isLocked(state, step);
  const value = Math.max(0, Math.min(step.target, step.progress(state)));
  return { index, step, value, locked, complete: !locked && value >= step.target };
}

/**
 * Where a save from before the chain stands: past every step, in order, that
 * it has already done. Nothing is paid for them — the old tutorial paid its
 * own rewards.
 */
export function chainCatchUp(state: GameState): number {
  let index = 0;
  while (index < MISSION_CHAIN.length && isDone(state, MISSION_CHAIN[index])) index++;
  return index;
}

/** The total XP a level asks for. */
export function levelXp(level: number): number {
  return GAME_CONFIG.levels.find((l) => l.level === level)?.requiredTotalXp ?? 0;
}

/** "Seviye 2'ye", "Seviye 6'ya": the suffix follows how the number is said. */
export const LEVEL_DATIVE: Record<number, string> = {
  1: "'e", 2: "'ye", 3: "'e", 4: "'e", 5: "'e", 6: "'ya", 7: "'ye", 8: "'e", 9: "'a", 10: "'a"
};

export interface ChainGoal {
  title: string;
  detail: string;
  value: number;
  target: number;
  guide: string;
}

/** What the card shows: the step itself or, while the game still locks it, the level that opens it. */
export function chainGoal(state: GameState, status: ChainStatus): ChainGoal {
  const { step } = status;
  if (status.locked && step.level !== undefined) {
    const target = levelXp(step.level);
    return {
      title: `Seviye ${step.level}${LEVEL_DATIVE[step.level] ?? ''} ulaş`,
      detail: `Sıradaki görev o seviyede açılır: ${step.title}.`,
      value: Math.min(state.player.xp, target),
      target,
      guide: 'guide_level'
    };
  }
  return { title: step.title, detail: step.detail, value: status.value, target: step.target, guide: step.guide };
}
