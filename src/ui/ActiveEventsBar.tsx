import React from 'react';
import { useGameStore } from '../store/gameStore';
import { GAME_CONFIG } from '../config/gameConfig';
import { ActiveGameEvent } from '../domain/types/gameState';
import { FUEL_DEAL_DISCOUNT, eventEffectSummary } from '../domain/services/simulationEngine';
import { TONE_GLASS, TONE_TEXT, TONE_DOT, type Tone } from './gameStyle';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Car,
  PartyPopper,
  Construction,
  Users,
  Droplets,
  Wrench,
  ZapOff,
  ClipboardCheck,
  Crown,
  Truck,
  Star,
  Sparkles,
  ShieldAlert
} from 'lucide-react';

const EVENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Car,
  PartyPopper,
  Construction,
  Users,
  Droplets,
  Wrench,
  ZapOff,
  ClipboardCheck,
  Crown,
  Truck,
  Star
};

const CATEGORY_TONES: Record<ActiveGameEvent['category'], Tone> = {
  ECONOMY: 'blue',
  TRAFFIC: 'violet',
  INCIDENT: 'red',
  OPPORTUNITY: 'green'
};

/**
 * One line per thing affecting the station: an icon, a short name, the time
 * it has left, and a thin bar draining underneath. No explanation here — that
 * arrives as a long-lived toast in the opposite corner the moment the event
 * starts, and lives on in the bell. The cards used to carry a sentence each
 * and ate a third of a laptop screen (Emre, 2026-09-06).
 */
const EventChip: React.FC<{
  title: string;
  timeLabel: string;
  ratio: number;
  tone: Tone;
  icon: React.ElementType;
  breathe?: boolean;
  hint?: string;
}> = ({ title, timeLabel, ratio, tone, icon: Icon, breathe, hint }) => (
  <div className={breathe ? 'animate-breathe' : undefined} title={hint}>
    <div className={`game-glass px-3 py-2 w-60 flex flex-col gap-1.5 ${TONE_GLASS[tone]}`}>
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 shrink-0 ${TONE_TEXT[tone]}`} />
        <span className={`game-title text-[12px] flex-1 leading-tight truncate ${TONE_TEXT[tone]}`}>
          {title}
        </span>
        <span className={`text-[12px] font-display shrink-0 tabular-nums ${TONE_TEXT[tone]}`}>
          {timeLabel}
        </span>
      </div>
      <div className="h-1.5 rounded-sm bg-board border border-ink/40 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${TONE_DOT[tone]}`}
          style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
        />
      </div>
    </div>
  </div>
);

/**
 * How long an event has left, on the player's own clock. Events are timed in
 * game hours, but a game hour is ten real seconds: "6 sa 11 dk" was a minute
 * of real waiting dressed up as an afternoon (Emre, 2026-09-07). Minutes and
 * seconds of wall-clock time, like the other cards in this corner.
 */
export function eventTimeLabel(remainingHours: number): string {
  const seconds = Math.max(0, Math.ceil(remainingHours * GAME_CONFIG.economy.realSecondsPerGameHour));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes} dk ${rest} s` : `${minutes} dk`;
}

/**
 * Whether the tank is low enough to nag about — and nobody has done anything
 * about it yet. The card asks for an order; once one is on its way the ask
 * is met, the tanker widget shows it coming, and a red card still shouting
 * "order!" is a card the player learns to ignore (Emre, 2026-09-07).
 */
export function stockWarningDue(
  tank: { stock: number; capacity: number; fuelType: string },
  orders: Array<{ fuelType: string }>
): boolean {
  if (tank.stock > tank.capacity * 0.15) return false;
  return !orders.some((o) => o.fuelType === tank.fuelType);
}

/** Shows what is currently affecting the station and how long it has left. */
export const ActiveEventsBar: React.FC = () => {
  const activeEvents = useGameStore((s) => s.gameState.activeEvents);
  const rushLeft = useGameStore((s) => s.gameState.dayState.rushSecondsLeft ?? 0);
  const dealLeft = useGameStore((s) => s.gameState.dayState.fuelDealSecondsLeft ?? 0);
  const gasoline = useGameStore((s) => s.gameState.tanks.gasoline);
  const fuelOrders = useGameStore((s) => s.gameState.fuelOrders);
  const setActiveModal = useGameStore((s) => s.setActiveModal);

  // Kritik stok uyarısı eskiden ekranın ortasında bir bant olarak beliriyordu
  // ve sahneyi kapatıyordu (Emre, 2026-09-05). Artık diğer olay kartlarının
  // arasında yaşar: aynı köşe, aynı görsel dil — ama tıklanınca doğrudan
  // sipariş ekranını açar. Sipariş verildiyse susar.
  const gasolineCritical = stockWarningDue(gasoline, fuelOrders);

  if (activeEvents.length === 0 && rushLeft <= 0 && dealLeft <= 0 && !gasolineCritical) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5 items-end pointer-events-auto">
      {gasolineCritical && (
        <button
          onClick={() => setActiveModal('FUEL_ORDER')}
          className="animate-breathe text-left"
          title="Depo %15'in altında — sipariş vermek için tıklayın"
        >
          <div className={`game-glass px-3 py-2 w-60 flex items-center gap-2 ${TONE_GLASS.red}`}>
            <ShieldAlert className={`w-4 h-4 shrink-0 ${TONE_TEXT.red}`} />
            <span className={`game-title text-[12px] flex-1 leading-tight truncate ${TONE_TEXT.red}`}>
              Kritik Stok: Benzin
            </span>
            <span className={`text-[11px] font-extrabold shrink-0 ${TONE_TEXT.red}`}>Sipariş ›</span>
          </div>
        </button>
      )}
      {dealLeft > 0 && (
        <EventChip
          title={`Yakıtta İndirim %${Math.round(FUEL_DEAL_DISCOUNT * 100)}`}
          hint="Tedarikçi alış fiyatını indirdi; satış fiyatınız değişmez — depoları şimdi doldurun."
          timeLabel={`${Math.ceil(dealLeft)} s`}
          ratio={dealLeft / 60}
          tone="green"
          icon={TrendingDown}
          breathe
        />
      )}
      {rushLeft > 0 && (
        <EventChip
          title="Müşteri Yoğunluğu"
          hint="Yola araç yığıldı; çok daha fazla sürücü uğruyor."
          timeLabel={`${Math.ceil(rushLeft)} s`}
          ratio={rushLeft / 60}
          tone="blue"
          icon={Car}
          breathe
        />
      )}
      {activeEvents.map((event) => {
        return (
          <EventChip
            key={event.id}
            title={event.name}
            hint={`${eventEffectSummary(event.effects)} — ${event.description}`}
            timeLabel={eventTimeLabel(event.remainingHours)}
            ratio={event.totalHours > 0 ? event.remainingHours / event.totalHours : 0}
            tone={CATEGORY_TONES[event.category]}
            icon={EVENT_ICONS[event.icon] || Sparkles}
          />
        );
      })}
    </div>
  );
};
