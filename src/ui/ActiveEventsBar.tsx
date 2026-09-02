import React from 'react';
import { useGameStore } from '../store/gameStore';
import { ActiveGameEvent } from '../domain/types/gameState';
import { FUEL_DEAL_DISCOUNT } from '../domain/services/simulationEngine';
import { TONE_GLASS, TONE_TEXT, PILL_BODY, type Tone } from './gameStyle';
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

/** Shows what is currently affecting the station and how long it has left. */
/**
 * A window that runs on the player's clock rather than the forecourt's, with
 * the seconds ticking down. Both of these last a minute of real time and are
 * the two moments in a day worth dropping everything for, so they are shown
 * the same way and read as a countdown rather than a badge.
 */
const LiveWindow: React.FC<{
  title: string;
  detail: string;
  secondsLeft: number;
  total: number;
  tone: Tone;
  icon: React.ElementType;
}> = ({ title, detail, secondsLeft, total, tone, icon: Icon }) => (
  // These two last a minute and are worth dropping everything for, so unlike
  // the day-long events they breathe the whole time they are up.
  <div className="animate-breathe">
    <div className={`game-glass px-3 py-2.5 w-64 flex flex-col gap-2 ${TONE_GLASS[tone]}`}>
      <div className="flex items-center gap-2.5">
        <Icon className={`w-4 h-4 shrink-0 ${TONE_TEXT[tone]}`} />
        <span className={`game-title text-[12px] flex-1 leading-tight break-words ${TONE_TEXT[tone]}`}>
          {title}
        </span>
        <span className={`text-[11px] font-mono font-extrabold shrink-0 tabular-nums ${TONE_TEXT[tone]}`}>
          {Math.ceil(secondsLeft)} s
        </span>
      </div>
      <p className={`text-[11px] font-semibold leading-snug ${PILL_BODY}`}>{detail}</p>
      <div className="h-1.5 rounded-full bg-black/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-white/60"
          style={{ width: `${Math.max(0, Math.min(1, secondsLeft / total)) * 100}%` }}
        />
      </div>
    </div>
  </div>
);

export const ActiveEventsBar: React.FC = () => {
  const activeEvents = useGameStore((s) => s.gameState.activeEvents);
  const rushLeft = useGameStore((s) => s.gameState.dayState.rushSecondsLeft ?? 0);
  const dealLeft = useGameStore((s) => s.gameState.dayState.fuelDealSecondsLeft ?? 0);
  const gasoline = useGameStore((s) => s.gameState.tanks.gasoline);
  const setActiveModal = useGameStore((s) => s.setActiveModal);

  // Kritik stok uyarısı eskiden ekranın ortasında bir bant olarak beliriyordu
  // ve sahneyi kapatıyordu (Emre, 2026-09-05). Artık diğer olay kartlarının
  // arasında yaşar: aynı köşe, aynı görsel dil — ama tıklanınca doğrudan
  // sipariş ekranını açar.
  const gasolineCritical = gasoline.stock <= gasoline.capacity * 0.15;

  if (activeEvents.length === 0 && rushLeft <= 0 && dealLeft <= 0 && !gasolineCritical) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 pointer-events-auto">
      {gasolineCritical && (
        <button
          onClick={() => setActiveModal('FUEL_ORDER')}
          className="animate-breathe text-left"
        >
          <div className={`game-glass px-3 py-2.5 w-64 flex flex-col gap-1 ${TONE_GLASS.red}`}>
            <div className="flex items-center gap-2.5">
              <ShieldAlert className={`w-4 h-4 shrink-0 ${TONE_TEXT.red}`} />
              <span className={`game-title text-[12px] flex-1 leading-tight ${TONE_TEXT.red}`}>
                Kritik Stok: Benzin
              </span>
            </div>
            <p className={`text-[11px] font-semibold leading-snug ${PILL_BODY}`}>
              Depo %15'in altında — sipariş vermek için tıklayın.
            </p>
          </div>
        </button>
      )}
      {dealLeft > 0 && (
        <LiveWindow
          title={`Toptan Yakıt İndirimi %${Math.round(FUEL_DEAL_DISCOUNT * 100)}`}
          detail="Tedarikçi alış fiyatını indirdi. Satış fiyatınız değişmez — depoları şimdi doldurun."
          secondsLeft={dealLeft}
          total={60}
          tone="green"
          icon={TrendingDown}
        />
      )}
      {rushLeft > 0 && (
        <LiveWindow
          title="Müşteri Yoğunluğu"
          detail="Yola araç yığıldı; çok daha fazla sürücü uğruyor."
          secondsLeft={rushLeft}
          total={60}
          tone="blue"
          icon={Car}
        />
      )}
      {activeEvents.map((event) => {
        const Icon = EVENT_ICONS[event.icon] || Sparkles;
        const tone = CATEGORY_TONES[event.category];
        const remainingRatio =
          event.totalHours > 0 ? Math.max(0, event.remainingHours / event.totalHours) : 0;

        const minutesLeft = Math.max(0, Math.round(event.remainingHours * 60));
        const timeLabel =
          minutesLeft >= 60
            ? `${Math.floor(minutesLeft / 60)} sa ${minutesLeft % 60} dk`
            : `${minutesLeft} dk`;

        return (
          <div
            key={event.id}
            className={`game-glass px-3 py-2.5 w-64 flex flex-col gap-2 ${TONE_GLASS[tone]}`}
            title={event.description}
          >
            <div className="flex items-center gap-2.5">
              <Icon className={`w-4 h-4 shrink-0 ${TONE_TEXT[tone]}`} />
              <span className={`game-title text-[12px] flex-1 leading-tight break-words ${TONE_TEXT[tone]}`}>
                {event.name}
              </span>
              <span className={`text-[11px] font-mono font-extrabold shrink-0 tabular-nums ${TONE_TEXT[tone]}`}>
                {timeLabel}
              </span>
            </div>

            <div className="w-full h-1.5 bg-black/30 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-white/60 transition-all duration-500"
                style={{ width: `${remainingRatio * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
