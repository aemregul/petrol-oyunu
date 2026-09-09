/**
 * The feedback box (Emre, 2026-09-09): what a player writes in "Sorun /
 * Öneri Bildir" and where it goes.
 *
 * Three roads, tried in order, all decided by what is in .env so the code
 * never carries an address:
 *   1. Web3Forms — a free form relay that e-mails the owner's inbox; one
 *      access key in VITE_WEB3FORMS_KEY and every note lands as mail.
 *   2. Firestore — if only the Firebase keys are set, the note is written to
 *      the `feedback` collection and read in the console.
 *   3. mailto / clipboard — with neither, VITE_FEEDBACK_MAILTO opens the
 *      player's own mail app; without even that the note is copied so the
 *      player can send it however they like.
 *
 * The note travels with a little context — day, level, cash, version,
 * browser — because "arabalar sıkışıyor" without a day number is a riddle.
 */

import { GameState } from '../domain/types/gameState';
import { AccountProfile, firebaseAppIfReady } from './account';

export type FeedbackKind = 'bug' | 'idea' | 'other';
export type FeedbackChannel = 'web3forms' | 'firestore' | 'mailto' | 'clipboard';

export interface FeedbackNote {
  kind: FeedbackKind;
  text: string;
  context: {
    day: number;
    level: number;
    cash: number;
    reputation: number;
    version: string;
    saveId: string;
    userAgent: string;
    screen: string;
    account: string;
  };
}

export const FEEDBACK_MIN_CHARS = 10;
export const FEEDBACK_MAX_CHARS = 2000;

const KIND_LABEL: Record<FeedbackKind, string> = { bug: 'Hata', idea: 'Öneri', other: 'Diğer' };

const env = import.meta.env as Record<string, string | undefined>;

/** Which road a note will take, from what is configured. Pure, for the tests. */
export function pickChannel(keys: {
  web3forms?: string;
  firebase: boolean;
  mailto?: string;
}): FeedbackChannel {
  if (keys.web3forms && keys.web3forms.trim().length > 0) return 'web3forms';
  if (keys.firebase) return 'firestore';
  if (keys.mailto && keys.mailto.trim().length > 0) return 'mailto';
  return 'clipboard';
}

export function feedbackChannel(): FeedbackChannel {
  return pickChannel({
    web3forms: env.VITE_WEB3FORMS_KEY,
    firebase: firebaseAppIfReady() !== null,
    mailto: env.VITE_FEEDBACK_MAILTO
  });
}

/** Trims and bounds the text, and refuses what is too short to mean anything. */
export function validFeedbackText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < FEEDBACK_MIN_CHARS) return null;
  return trimmed.slice(0, FEEDBACK_MAX_CHARS);
}

export function buildFeedbackNote(
  kind: FeedbackKind,
  text: string,
  state: GameState,
  account: AccountProfile | null,
  version: string
): FeedbackNote {
  return {
    kind,
    text,
    context: {
      day: state.dayState.currentDay,
      level: state.player.level,
      cash: Math.round(state.player.cash),
      reputation: Number(state.player.reputation.toFixed(2)),
      version,
      saveId: state.saveId,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      screen: typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : '',
      account: account ? `${account.name} (${account.provider}${account.email ? `, ${account.email}` : ''})` : 'giriş yok'
    }
  };
}

/** The note as one block of text, for mail and the clipboard. */
export function formatFeedbackNote(note: FeedbackNote): string {
  const c = note.context;
  return [
    `[${KIND_LABEL[note.kind]}] ${note.text}`,
    '',
    `Gün ${c.day} · Seviye ${c.level} · Kasa ₺${c.cash.toLocaleString('tr-TR')} · İtibar ${c.reputation}`,
    `Sürüm ${c.version} · Kayıt ${c.saveId} · ${c.account}`,
    `${c.screen} · ${c.userAgent}`
  ].join('\n');
}

async function sendViaWeb3Forms(note: FeedbackNote, key: string): Promise<void> {
  const res = await fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      access_key: key,
      subject: `[Petrol Oyunu] ${KIND_LABEL[note.kind]} — gün ${note.context.day}, seviye ${note.context.level}`,
      from_name: note.context.account,
      message: formatFeedbackNote(note),
      ...note.context
    })
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
  if (!res.ok || body.success === false) throw new Error(body.message || `Gönderim başarısız (${res.status})`);
}

async function sendViaFirestore(note: FeedbackNote): Promise<void> {
  const app = firebaseAppIfReady();
  if (!app) throw new Error('Firebase yapılandırması yok.');
  const { getFirestore, collection, addDoc, serverTimestamp } = await import('firebase/firestore');
  await addDoc(collection(getFirestore(app), 'feedback'), { ...note, createdAt: serverTimestamp() });
}

function mailtoUrl(to: string, note: FeedbackNote): string {
  const subject = `[Petrol Oyunu] ${KIND_LABEL[note.kind]} — gün ${note.context.day}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formatFeedbackNote(note))}`;
}

/**
 * Sends the note down whichever road is open. Resolves with the road taken;
 * the caller words the thank-you accordingly (a clipboard copy is not a
 * delivery). Throws when the road was there and failed.
 */
export async function sendFeedback(note: FeedbackNote): Promise<FeedbackChannel> {
  const channel = feedbackChannel();
  if (channel === 'web3forms') {
    await sendViaWeb3Forms(note, env.VITE_WEB3FORMS_KEY!);
  } else if (channel === 'firestore') {
    await sendViaFirestore(note);
  } else if (channel === 'mailto') {
    window.open(mailtoUrl(env.VITE_FEEDBACK_MAILTO!, note), '_self');
  } else {
    await navigator.clipboard.writeText(formatFeedbackNote(note));
  }
  return channel;
}
