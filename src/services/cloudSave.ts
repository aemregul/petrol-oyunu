/**
 * The cloud copy of the save (Emre, 2026-09-09: "başka PC'den girse aynı
 * hesaba kayıpsız girebilsin mi?"). Until now the answer was no: the save
 * lived in this browser's localStorage and the account only knew a name.
 *
 * One Firestore document per signed-in player, `saves/{uid}`, holding the
 * save as a JSON string plus the few fields worth reading without parsing.
 * A string rather than a nested object because Firestore refuses arrays in
 * arrays and the save has plenty; and because a save is a dozen kilobytes,
 * nowhere near the document limit.
 *
 * Guests stay local: an anonymous account is a different account on every
 * device, so there is nothing to follow them with.
 */

import { GameState } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import { AccountProfile, firebaseAppIfReady } from './account';

export interface CloudSaveMeta {
  updatedAt: number;
  day: number;
  level: number;
  saveId: string;
}

export const CLOUD_SAVE_COLLECTION = 'saves';

export function cloudSaveAvailable(): boolean {
  return firebaseAppIfReady() !== null;
}

/** An account whose save is worth carrying: signed in, and not a guest. */
export function followsAccount(account: AccountProfile | null): account is AccountProfile {
  return !!account && account.provider !== 'guest';
}

/** The traffic on the road is not worth keeping; everything else is. */
export function stripForCloud(state: GameState): GameState {
  return { ...state, vehicles: {} };
}

/**
 * A save nobody has played yet: day one, nothing sold, nothing built, the
 * starting cash untouched. Such a save must never overwrite a real one —
 * it is what a fresh browser starts with the moment before it signs in.
 */
export function isFreshSave(state: GameState): boolean {
  return (
    state.dayState.currentDay === 1 &&
    state.player.statistics.daysCompleted === 0 &&
    state.player.statistics.totalCustomersServed === 0 &&
    state.player.cash === GAME_CONFIG.economy.initialCash &&
    Object.keys(state.employees).length === 0 &&
    state.fuelOrders.length === 0
  );
}

/**
 * Which copy to keep. A local save that belongs to somebody else — the last
 * player on a shared machine — is never this account's: the cloud copy
 * comes down, or a fresh game starts. Otherwise: no cloud copy, the local
 * one goes up; a local copy nobody has played, the cloud one comes down;
 * two played copies, the one saved later, since both were the same hands.
 */
export function reconcile(local: GameState, cloud: CloudSaveMeta | null, uid: string): 'push' | 'pull' | 'fresh' {
  const foreign = !!local.ownerUid && local.ownerUid !== uid;
  if (foreign) return cloud ? 'pull' : 'fresh';
  if (!cloud) return 'push';
  if (isFreshSave(local)) return 'pull';
  return cloud.updatedAt > local.updatedAt ? 'pull' : 'push';
}

/**
 * Firestore waits patiently for a database that does not exist yet, which
 * on a project where nobody has pressed "Create database" means for ever.
 * A bounded wait turns that into an error the settings card can show.
 */
export const CLOUD_TIMEOUT_MS = 10_000;

export function withTimeout<T>(work: Promise<T>, label: string, ms = CLOUD_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`${label} ${ms / 1000} saniyede yanıt vermedi. Firebase'de Firestore açık mı?`)),
      ms
    );
    work.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); }
    );
  });
}

export async function fetchCloudSave(uid: string): Promise<{ raw: unknown; meta: CloudSaveMeta } | null> {
  const app = firebaseAppIfReady();
  if (!app) return null;
  const { getFirestore, doc, getDoc } = await import('firebase/firestore');
  const snap = await withTimeout(getDoc(doc(getFirestore(app), CLOUD_SAVE_COLLECTION, uid)), 'Bulut kaydı okuma');
  if (!snap.exists()) return null;
  const data = snap.data() as { json?: string; updatedAt?: number; day?: number; level?: number; saveId?: string };
  if (typeof data.json !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data.json);
  } catch {
    return null;
  }
  return {
    raw,
    meta: {
      updatedAt: data.updatedAt ?? 0,
      day: data.day ?? 1,
      level: data.level ?? 1,
      saveId: data.saveId ?? ''
    }
  };
}

export async function pushCloudSave(uid: string, state: GameState): Promise<void> {
  const app = firebaseAppIfReady();
  if (!app) throw new Error('Firebase yapılandırması yok.');
  const { getFirestore, doc, setDoc } = await import('firebase/firestore');
  const slim = stripForCloud({ ...state, ownerUid: uid });
  await withTimeout(
    setDoc(doc(getFirestore(app), CLOUD_SAVE_COLLECTION, uid), {
      json: JSON.stringify(slim),
      updatedAt: state.updatedAt,
      day: state.dayState.currentDay,
      level: state.player.level,
      saveId: state.saveId,
      stationName: state.station.name,
      version: state.schemaVersion
    }),
    'Bulut kaydı yazma'
  );
}
