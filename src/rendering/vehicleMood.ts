import { BuildingEntity, DepartureReason, VehicleEntity, VehicleState } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';

/**
 * What a car says over its roof (live testers, 2026-09-13): what the driver
 * came for, how their patience is holding up, and — on the way out — why they
 * went. Emoji rather than sentences, so one glance across a busy forecourt
 * reads a dozen cars; the guide carries the key.
 *
 * No React here, so the rules can be tested on their own. Every emoji below is
 * old enough for the Windows 10 emoji font to draw.
 */

export interface MoodGlyph {
  emoji: string;
  label: string;
}

export const DEPARTURE_GLYPHS: Record<DepartureReason, MoodGlyph & { hint: string }> = {
  SERVED_TIP: { emoji: '💰', label: 'Bahşiş bıraktı', hint: 'Hizmetten çok memnun kaldı, üstüne bahşiş bıraktı.' },
  SERVED_GREAT: { emoji: '😍', label: 'Çok memnun', hint: 'Hızlı ve doğru servis aldı; hizmet puanı 85 ve üstü.' },
  SERVED_OK: { emoji: '🙂', label: 'Memnun', hint: 'Servisini aldı ama biraz bekledi ya da tutar tam tutmadı.' },
  SERVED_POOR: { emoji: '😒', label: 'Memnun değil', hint: "Çok bekledi ya da istediğini tam alamadı; hizmet puanı 60'ın altında." },
  VISITED: { emoji: '😊', label: 'İşini gördü', hint: 'Tesise uğradı, işini görüp ayrıldı.' },
  PATIENCE: { emoji: '😡', label: 'Sabrı tükendi', hint: 'Kuyrukta ya da pompada çok bekledi. Pompacı al ya da pompa ekle.' },
  NO_FUEL: { emoji: '⛽🚫', label: 'Yakıt yok', hint: "Tankta istediği yakıt kalmadı. Tedarik'ten tanker çağır." },
  PUMP_BROKEN: { emoji: '🔧', label: 'Pompa arızalı', hint: 'Çalışan pompa yoktu. Bakım masasından onar.' },
  NO_POWER: { emoji: '🔌🚫', label: 'Elektrik yok', hint: 'Şarj ünitelerini besleyen batarya boştu.' },
  NO_SERVICE: { emoji: '🚫', label: 'Hizmet yok', hint: 'Geldiği pompa, şarj ünitesi ya da tesis kaldırıldı, ya da o an kimseyi almıyordu.' },
  NO_ROOM: { emoji: '🚧', label: 'Manevra yok', hint: 'Pompaya ya da kuyruğa güvenli bir yol bulamadı. Geçişlerin çevresinde yer bırak.' },
  FULL: { emoji: '😤', label: 'İstasyon dolu', hint: 'Pompalar ve kuyruk doluydu, girmeden yoluna devam etti. Yeni pompanın zamanı gelmiş olabilir.' },
  CLOSED: { emoji: '🔒', label: 'Kapalı', hint: 'İstasyon kapalıydı.' },
  NO_PARKING: { emoji: '🅿️🚫', label: 'Park yeri yok', hint: 'Tesis için geldi ama boş park yeri bulamadı. Otopark kur.' },
  SENT_AWAY: { emoji: '👋', label: 'Gönderildi', hint: 'Müşteriyi sen gönderdin.' }
};

/** How much patience is left, most first. The last one catches everything below. */
export const PATIENCE_GLYPHS: ReadonlyArray<MoodGlyph & { above: number; hint: string }> = [
  { above: 0.6, emoji: '🙂', label: 'Sakin', hint: "Sabrının %60'ından fazlası duruyor." },
  { above: 0.35, emoji: '😐', label: 'Sabırsızlanıyor', hint: '%35 ile %60 arası kaldı.' },
  { above: 0.15, emoji: '😠', label: 'Sinirli', hint: '%15 ile %35 arası kaldı.' },
  { above: 0, emoji: '😡', label: 'Gitmek üzere', hint: "%15'ten azı kaldı; birazdan gider." }
];

/** The buildings a driver walks into, by catalogue type. */
export const FACILITY_GLYPHS: Record<string, MoodGlyph> = {
  toilet: { emoji: '🚻', label: 'WC' },
  mini_market: { emoji: '🛒', label: 'Market' },
  cafe: { emoji: '☕', label: 'Kahve' },
  restaurant: { emoji: '🍽️', label: 'Yemek' },
  hotel: { emoji: '🏨', label: 'Otel' },
  rest_complex: { emoji: '🏪', label: 'Tesis' }
};

export const CHARGE_GLYPH: MoodGlyph = { emoji: '⚡', label: 'Şarj' };

/** Here for a building that has not been picked yet, or one the table does not know. */
const ANY_FACILITY: MoodGlyph = { emoji: '🛍️', label: 'Tesis' };

export function patienceGlyph(vehicle: VehicleEntity): MoodGlyph {
  const share = vehicle.maxPatience > 0 ? vehicle.patience / vehicle.maxPatience : 1;
  return PATIENCE_GLYPHS.find((g) => share > g.above) ?? PATIENCE_GLYPHS[PATIENCE_GLYPHS.length - 1];
}

/**
 * What the driver is here for. A building they are headed to or standing in
 * says it best — that includes a fuel customer who walked over after paying.
 */
export function intentGlyph(
  vehicle: VehicleEntity,
  buildings: Record<string, BuildingEntity>
): MoodGlyph {
  const visit = vehicle.visitBuildingId ? buildings[vehicle.visitBuildingId] : null;
  if (visit) return FACILITY_GLYPHS[visit.type] ?? ANY_FACILITY;
  if (vehicle.facilityIntent) return ANY_FACILITY;
  if (GAME_CONFIG.customerTypes[vehicle.archetype]?.requiresCharger) return CHARGE_GLYPH;
  return { emoji: '⛽', label: GAME_CONFIG.fuels[vehicle.fuelType]?.shortName ?? 'Yakıt' };
}

export type VehicleMood =
  | { kind: 'WAITING'; intent: MoodGlyph; patience: MoodGlyph }
  | { kind: 'AWAY'; intent: MoodGlyph }
  | { kind: 'LEAVING'; glyph: MoodGlyph };

/** From joining the queue to settling up: the stretch a driver can lose patience over. */
const WAITING_STATES = new Set<VehicleState>([
  'QUEUE',
  'PUMP_RESERVED',
  'AT_PUMP',
  'REQUEST',
  'FUELING',
  'PAYMENT'
]);

/** Off to a building, or inside one. Nothing is running down. */
const AWAY_STATES = new Set<VehicleState>(['TO_PARK', 'VISITING', 'OPTIONAL_SHOP']);

export function vehicleMood(
  vehicle: VehicleEntity,
  buildings: Record<string, BuildingEntity>
): VehicleMood | null {
  // A driver who was turned away on the road is PASSING too. Through traffic
  // never had a reason to stop, carries none, and shows nothing.
  if (vehicle.state === 'EXIT' || vehicle.state === 'PASSING') {
    const glyph = vehicle.departureReason ? DEPARTURE_GLYPHS[vehicle.departureReason] : undefined;
    return glyph ? { kind: 'LEAVING', glyph } : null;
  }
  if (WAITING_STATES.has(vehicle.state)) {
    return { kind: 'WAITING', intent: intentGlyph(vehicle, buildings), patience: patienceGlyph(vehicle) };
  }
  if (AWAY_STATES.has(vehicle.state)) {
    return { kind: 'AWAY', intent: intentGlyph(vehicle, buildings) };
  }
  return null;
}
