import React from 'react';
import { useGameStore } from '../store/gameStore';
import { ActiveGameEvent } from '../domain/types/gameState';
import { FUEL_DEAL_DISCOUNT } from '../domain/services/simulationEngine';
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
  Sparkles
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

const CATEGORY_STYLES: Record<
  ActiveGameEvent['category'],
  { ring: string; text: string; bar: string }
> = {
  ECONOMY: { ring: 'border-sky-500/40 bg-sky-500/10', text: 'text-sky-300', bar: 'bg-sky-500' },
  TRAFFIC: {
    ring: 'border-indigo-500/40 bg-indigo-500/10',
    text: 'text-indigo-300',
    bar: 'bg-indigo-500'
  },
  INCIDENT: { ring: 'border-red-500/40 bg-red-500/10', text: 'text-red-300', bar: 'bg-red-500' },
  OPPORTUNITY: {
    ring: 'border-emerald-500/40 bg-emerald-500/10',
    text: 'text-emerald-300',
    bar: 'bg-emerald-500'
  }
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
  tone: 'sky' | 'emerald';
  icon: React.ElementType;
}> = ({ title, detail, secondsLeft, total, tone, icon: Icon }) => {
  const ring = tone === 'emerald' ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-sky-500/60 bg-sky-500/10';
  const text = tone === 'emerald' ? 'text-emerald-400' : 'text-sky-400';
  const bar = tone === 'emerald' ? 'bg-emerald-400' : 'bg-sky-400';

  return (
    <div className={`border backdrop-blur-md rounded-2xl px-3.5 py-2.5 shadow-xl w-64 flex flex-col gap-2 ${ring}`}>
      <div className="flex items-center gap-2.5">
        <Icon className={`w-4 h-4 shrink-0 ${text}`} />
        <span className="text-xs font-extrabold text-white flex-1 truncate">{title}</span>
        <span className={`text-[10px] font-mono font-bold shrink-0 ${text}`}>
          {Math.ceil(secondsLeft)} sn
        </span>
      </div>
      <p className="text-[10px] text-slate-300 leading-snug">{detail}</p>
      <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${bar}`}
          style={{ width: `${Math.max(0, Math.min(1, secondsLeft / total)) * 100}%` }}
        />
      </div>
    </div>
  );
};

export const ActiveEventsBar: React.FC = () => {
  const activeEvents = useGameStore((s) => s.gameState.activeEvents);
  const rushLeft = useGameStore((s) => s.gameState.dayState.rushSecondsLeft ?? 0);
  const dealLeft = useGameStore((s) => s.gameState.dayState.fuelDealSecondsLeft ?? 0);

  if (activeEvents.length === 0 && rushLeft <= 0 && dealLeft <= 0) return null;

  return (
    <div className="flex flex-col gap-2 pointer-events-auto">
      {dealLeft > 0 && (
        <LiveWindow
          title={`Toptan Yakıt İndirimi %${Math.round(FUEL_DEAL_DISCOUNT * 100)}`}
          detail="Tedarikçi alış fiyatını indirdi. Satış fiyatınız değişmez — depoları şimdi doldurun."
          secondsLeft={dealLeft}
          total={60}
          tone="emerald"
          icon={TrendingDown}
        />
      )}
      {rushLeft > 0 && (
        <LiveWindow
          title="Müşteri Yoğunluğu"
          detail="Yola araç yığıldı; çok daha fazla sürücü uğruyor."
          secondsLeft={rushLeft}
          total={60}
          tone="sky"
          icon={Car}
        />
      )}
      {activeEvents.map((event) => {
        const Icon = EVENT_ICONS[event.icon] || Sparkles;
        const style = CATEGORY_STYLES[event.category];
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
            className={`border backdrop-blur-md rounded-2xl px-3.5 py-2.5 shadow-xl w-64 flex flex-col gap-2 ${style.ring}`}
            title={event.description}
          >
            <div className="flex items-center gap-2.5">
              <Icon className={`w-4 h-4 shrink-0 ${style.text}`} />
              <span className="text-xs font-extrabold text-white flex-1 truncate">
                {event.name}
              </span>
              <span className={`text-[10px] font-mono font-bold shrink-0 ${style.text}`}>
                {timeLabel}
              </span>
            </div>

            <div className="w-full h-1 bg-slate-800/80 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${style.bar}`}
                style={{ width: `${remainingRatio * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
