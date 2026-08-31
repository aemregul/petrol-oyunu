import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import type { GameNotification } from '../domain/types/gameState';
import { styleFor } from './notificationStyle';
import { TONE_GLASS, TONE_TEXT, PILL_BODY } from './gameStyle';

/**
 * How many notifications sit in the corner at once. Two, not three: a pill
 * grows to fit its whole message, and three full messages reach up into the
 * camera widget and the clean-station button.
 */
const MAX_VISIBLE = 2;
/** How long a toast stays at full strength before it starts leaving. */
const TOAST_MS = 3000;
/**
 * How long the leaving takes. Must match the `toast-out` animation duration in
 * tailwind.config.js — together with TOAST_MS this is the ~4s a notification
 * is readable for.
 */
const EXIT_MS = 900;

type LiveToast = { notif: GameNotification; leaving: boolean };

/**
 * The quiet corner opposite the tanker ledger. Toasts come and go on their own
 * — there is nothing to close, and nothing waits on the player noticing it.
 * Anything that scrolled past is still in the bell (NotificationsModal); this
 * is only the glance.
 */
export const NotificationToast: React.FC = () => {
  const notifications = useGameStore((s) => s.gameState.notifications);
  const [live, setLive] = useState<LiveToast[]>([]);

  /** id → the count last put on screen, so a re-fired notification re-shows. */
  const shown = useRef<Map<string, number> | null>(null);
  const timers = useRef(new Map<string, number>());

  /** Starts (or restarts) one toast's exit clock. */
  const scheduleExit = useRef((id: string, delay: number) => {
    const pending = timers.current.get(id);
    if (pending !== undefined) window.clearTimeout(pending);

    timers.current.set(
      id,
      window.setTimeout(() => {
        setLive((current) =>
          current.map((t) => (t.notif.id === id ? { ...t, leaving: true } : t))
        );
        timers.current.set(
          id,
          window.setTimeout(() => {
            setLive((current) => current.filter((t) => t.notif.id !== id));
            timers.current.delete(id);
          }, EXIT_MS)
        );
      }, delay)
    );
  }).current;

  // Nothing may outlive the component: a timer firing after unmount would set
  // state on a corpse.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      pending.clear();
    };
  }, []);

  useEffect(() => {
    const before = shown.current;
    shown.current = new Map(notifications.map((n) => [n.id, n.count]));

    // The log a save restores is history, not news — it must never toast.
    if (before === null) return;

    // Either brand new, or the same notification fired again and its counter
    // moved; both deserve the corner.
    const fresh = notifications.filter((n) => {
      const seenCount = before.get(n.id);
      return seenCount === undefined || seenCount < n.count;
    });
    if (fresh.length === 0) return;

    setLive((current) => {
      const carried = current.filter((t) => !fresh.some((n) => n.id === t.notif.id));
      const arriving = [...fresh]
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((notif) => ({ notif, leaving: false }));
      return [...arriving, ...carried];
    });
    for (const n of fresh) scheduleExit(n.id, TOAST_MS);
  }, [notifications, scheduleExit]);

  // A burst can put more on screen than the corner has room for. The oldest
  // gives way at once rather than waiting out its own clock.
  useEffect(() => {
    const standing = live.filter((t) => !t.leaving);
    if (standing.length <= MAX_VISIBLE) return;
    for (const t of standing.slice(MAX_VISIBLE)) scheduleExit(t.notif.id, 0);
  }, [live, scheduleExit]);

  if (live.length === 0) return null;

  return (
    // Column-reverse keeps the newest nearest the corner; `live` is newest
    // first, so the one on its way out drifts off the top of the stack.
    <div className="fixed bottom-16 left-4 z-40 flex flex-col-reverse gap-2 items-start pointer-events-none select-none">
      {live.map(({ notif, leaving }) => {
        const style = styleFor(notif.type);
        return (
          // Two elements, because one can only run one animation: the outer
          // carries the arrival and departure, the inner does the breathing.
          <div
            // Keying on the count too remounts a re-fired toast, so its arrival
            // animation replays and the bumped "×N" catches the eye.
            key={`${notif.id}:${notif.count}`}
            className={leaving ? 'animate-toast-out' : 'animate-toast-in'}
          >
            <div
              // One flowing line rather than a headline over a paragraph, and
              // only as wide as it needs: a short notice makes a short pill.
              // Nothing is clipped — it wraps when the sentence is long, since
              // a warning the player can only half-read is no warning at all.
              className={`max-w-[21rem] w-fit px-3 py-1.5 font-sans game-glass ${
                TONE_GLASS[style.tone]
              } ${leaving ? '' : 'animate-breathe'}`}
            >
              <p className="text-[12px] leading-snug break-words">
                <span className={`font-extrabold ${TONE_TEXT[style.tone]}`}>{notif.title}</span>
                <span className={PILL_BODY}> — {notif.message}</span>
                {notif.count > 1 && (
                  <span className={`ml-1 font-extrabold tabular-nums ${TONE_TEXT[style.tone]}`}>
                    ×{notif.count}
                  </span>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
