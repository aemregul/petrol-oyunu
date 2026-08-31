import React from 'react';
import { ShieldAlert, AlertTriangle, Info, Award } from 'lucide-react';
import type { GameNotification } from '../domain/types/gameState';
import type { Tone } from './gameStyle';

export type NotificationStyle = {
  /** Which of the game palette's tones this type shouts in. */
  tone: Tone;
  /** The dot standing in for the icon in the log. */
  dot: string;
  icon: React.ElementType;
  /** Title colour in the log, where the row sits on the dark modal instead. */
  tint: string;
};

export const NOTIFICATION_STYLES: Record<GameNotification['type'], NotificationStyle> = {
  CRITICAL: { tone: 'red', dot: 'bg-red-500', icon: ShieldAlert, tint: 'text-red-300' },
  WARNING: { tone: 'amber', dot: 'bg-amber-500', icon: AlertTriangle, tint: 'text-amber-300' },
  REWARD: { tone: 'green', dot: 'bg-emerald-500', icon: Award, tint: 'text-emerald-300' },
  INFO: { tone: 'blue', dot: 'bg-sky-500', icon: Info, tint: 'text-sky-300' }
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
