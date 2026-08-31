import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import type { GameNotification } from '../domain/types/gameState';
import { ShieldAlert, AlertTriangle, Info, Award, X } from 'lucide-react';

/** How many notifications sit in the corner at once. */
const MAX_VISIBLE = 3;
/** Must match the `fade-out` animation duration in tailwind.config.js. */
const EXIT_MS = 600;

const STYLES: Record<GameNotification['type'], { pill: string; icon: React.ElementType; tint: string }> = {
  CRITICAL: { pill: 'bg-red-950/85 border-red-500/60', icon: ShieldAlert, tint: 'text-red-300' },
  WARNING: { pill: 'bg-amber-950/85 border-amber-500/60', icon: AlertTriangle, tint: 'text-amber-300' },
  REWARD: { pill: 'bg-emerald-950/85 border-emerald-500/60', icon: Award, tint: 'text-emerald-300' },
  INFO: { pill: 'bg-slate-900/85 border-slate-700/70', icon: Info, tint: 'text-sky-300' }
};

/**
 * The quiet corner opposite the tanker ledger. Only the newest few are on
 * screen; when a fourth arrives the oldest is kept mounted for one animation
 * so it drifts out instead of blinking away.
 */
export const NotificationToast: React.FC = () => {
  const notifications = useGameStore((s) => s.gameState.notifications);
  const dismissNotification = useGameStore((s) => s.dismissNotification);

  const visible = notifications.slice(0, MAX_VISIBLE);
  const [exiting, setExiting] = useState<GameNotification[]>([]);
  const prevVisible = useRef<GameNotification[]>([]);

  useEffect(() => {
    const previous = prevVisible.current;
    prevVisible.current = visible;

    const stillShown = new Set(visible.map((n) => n.id));
    const evicted = previous.filter((n) => !stillShown.has(n.id));
    if (evicted.length === 0) return;

    setExiting((current) => [...current, ...evicted]);
    const goneIds = new Set(evicted.map((n) => n.id));
    const timer = window.setTimeout(
      () => setExiting((current) => current.filter((n) => !goneIds.has(n.id))),
      EXIT_MS
    );
    return () => window.clearTimeout(timer);
    // `visible` is derived from `notifications`; recomputing it per render is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications]);

  if (visible.length === 0 && exiting.length === 0) return null;

  const row = (notif: GameNotification, leaving: boolean) => {
    const style = STYLES[notif.type] ?? STYLES.INFO;
    const Icon = style.icon;
    return (
      <div
        key={notif.id}
        className={`w-64 border backdrop-blur-sm rounded-xl px-2.5 py-1.5 shadow-lg grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[11px] font-mono ${style.pill} ${
          leaving ? 'animate-fade-out' : 'animate-fade-in pointer-events-auto'
        }`}
      >
        <Icon className={`w-3.5 h-3.5 ${style.tint}`} />
        <div className="min-w-0">
          <div className="font-bold text-white truncate">{notif.title}</div>
          <div className="text-slate-400 truncate">{notif.message}</div>
        </div>
        <button
          onClick={() => dismissNotification(notif.id)}
          className="text-slate-500 hover:text-white"
          aria-label="Kapat"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  };

  return (
    // Column-reverse keeps the newest nearest the corner; the evicted one is
    // last in the DOM, so it fades out at the top of the stack.
    <div className="fixed bottom-16 left-4 z-40 flex flex-col-reverse gap-1.5 items-start pointer-events-none select-none">
      {visible.map((notif) => row(notif, false))}
      {exiting.map((notif) => row(notif, true))}
    </div>
  );
};
