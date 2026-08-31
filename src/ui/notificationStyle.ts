import React from 'react';
import { ShieldAlert, AlertTriangle, Info, Award } from 'lucide-react';
import type { GameNotification } from '../domain/types/gameState';

export type NotificationStyle = {
  /** Toast pill background and border. */
  pill: string;
  /** The dot standing in for the icon in the log. */
  dot: string;
  icon: React.ElementType;
  /** Icon and title colour — the type is read from this before the words are. */
  tint: string;
  /** Body colour, tinted to match the pill so the two lines read as one block. */
  body: string;
};

export const NOTIFICATION_STYLES: Record<GameNotification['type'], NotificationStyle> = {
  CRITICAL: {
    pill: 'bg-red-950/90 border-red-500/50 shadow-red-950/40',
    dot: 'bg-red-500',
    icon: ShieldAlert,
    tint: 'text-red-300',
    body: 'text-red-100/75'
  },
  WARNING: {
    pill: 'bg-amber-950/90 border-amber-500/50 shadow-amber-950/40',
    dot: 'bg-amber-500',
    icon: AlertTriangle,
    tint: 'text-amber-300',
    body: 'text-amber-100/75'
  },
  REWARD: {
    pill: 'bg-emerald-950/90 border-emerald-500/50 shadow-emerald-950/40',
    dot: 'bg-emerald-500',
    icon: Award,
    tint: 'text-emerald-300',
    body: 'text-emerald-100/75'
  },
  INFO: {
    pill: 'bg-slate-900/90 border-slate-600/60 shadow-slate-950/40',
    dot: 'bg-sky-500',
    icon: Info,
    tint: 'text-sky-300',
    body: 'text-slate-300'
  }
};

export const styleFor = (type: GameNotification['type']): NotificationStyle =>
  NOTIFICATION_STYLES[type] ?? NOTIFICATION_STYLES.INFO;

/**
 * How long ago something happened, in the terms a player thinks in. The log
 * survives a save, so it has to reach back to days as well as seconds.
 */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return 'az önce';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} dk önce`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;

  return `${Math.round(hours / 24)} gün önce`;
}
