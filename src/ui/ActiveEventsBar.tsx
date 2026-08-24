import React from 'react';
import { useGameStore } from '../store/gameStore';
import { ActiveGameEvent } from '../domain/types/gameState';
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
export const ActiveEventsBar: React.FC = () => {
  const activeEvents = useGameStore((s) => s.gameState.activeEvents);

  if (activeEvents.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 pointer-events-auto">
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
