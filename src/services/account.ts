/**
 * Hesap katmanı: Google, e-posta ve misafir girişi — Firebase Auth üstünde.
 *
 * Oyunun kendisi hesapsız da çalışır ve çalışmaya devam etmelidir: Firebase
 * yapılandırması (.env içindeki VITE_FIREBASE_* anahtarları) yoksa buradaki
 * her şey kibarca "kapalı" der, oyun bugünkü gibi yerel kayıtla oynanır.
 * Anahtarlar eklendiği an giriş ekranı kendiliğinden canlanır — kod
 * değişikliği gerekmez.
 *
 * Bulut kayıt bilinçli olarak burada DEĞİL: kayıt dosyası ~1 MB'ın üstünde
 * ve Firestore'un belge sınırına sığmıyor; senkron, sıkıştırma/bölme
 * tasarımıyla ayrı bir iş ([[beneloil-gap-backlog]]).
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type Auth,
  type User
} from 'firebase/auth';

export type AccountProvider = 'google' | 'email' | 'guest';

export interface AccountProfile {
  uid: string;
  /** Görünen ad; misafirde ve adsız e-postada istasyon sahibine yakışır bir varsayılan. */
  name: string;
  email: string | null;
  provider: AccountProvider;
}

const env = import.meta.env as Record<string, string | undefined>;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID
};

/**
 * Giriş sistemi ancak DÖRT anahtar da verilmişse vardır — yarımı, hiç
 * verilmemişi gibi kapalıdır. Saf hali test edilebilsin diye ayrık.
 */
export function backendReadyFrom(keys: {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
}): boolean {
  return Boolean(keys.apiKey && keys.authDomain && keys.projectId && keys.appId);
}

export function accountBackendReady(): boolean {
  return backendReadyFrom(config);
}

let app: FirebaseApp | null = null;

function auth(): Auth {
  if (!accountBackendReady()) {
    throw new Error('Firebase yapılandırması eksik: .env dosyasına VITE_FIREBASE_* anahtarlarını ekleyin.');
  }
  app ??= initializeApp({
    apiKey: config.apiKey!,
    authDomain: config.authDomain!,
    projectId: config.projectId!,
    appId: config.appId!
  });
  return getAuth(app);
}

/**
 * Firebase kullanıcısını oyunun profiline çevirir. Saf bir eşleme: sağlayıcı
 * öncelik sırası Google > e-posta > misafir, ad ise bulunabilen ilk dürüst ad.
 */
export function profileFrom(user: {
  uid: string;
  isAnonymous: boolean;
  displayName: string | null;
  email: string | null;
  providerData: Array<{ providerId: string }>;
}): AccountProfile {
  const provider: AccountProvider = user.isAnonymous
    ? 'guest'
    : user.providerData.some((p) => p.providerId === 'google.com')
      ? 'google'
      : 'email';

  const name =
    user.displayName?.trim() ||
    user.email?.split('@')[0] ||
    (provider === 'guest' ? 'Misafir İşletmeci' : 'İşletmeci');

  return { uid: user.uid, name, email: user.email, provider };
}

/** Oturum değişimlerini dinler; aboneliği geri verir. */
export function watchAccount(onChange: (profile: AccountProfile | null) => void): () => void {
  if (!accountBackendReady()) {
    onChange(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth(), (user: User | null) => {
    onChange(user ? profileFrom(user) : null);
  });
}

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(auth(), new GoogleAuthProvider());
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth(), email, password);
}

export async function registerWithEmail(email: string, password: string): Promise<void> {
  await createUserWithEmailAndPassword(auth(), email, password);
}

export async function signInAsGuest(): Promise<void> {
  await signInAnonymously(auth());
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth());
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth(), email);
}

/** Firebase'in İngilizce hata kodları oyuncuya Türkçe anlatılır. */
export function describeAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'E-posta adresi geçersiz görünüyor.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'E-posta ya da şifre hatalı.';
    case 'auth/email-already-in-use':
      return 'Bu e-posta ile zaten bir hesap var — giriş yapmayı deneyin.';
    case 'auth/weak-password':
      return 'Şifre en az 6 karakter olmalı.';
    case 'auth/popup-closed-by-user':
      return 'Giriş penceresi kapatıldı.';
    case 'auth/network-request-failed':
      return 'Ağ hatası — bağlantınızı kontrol edin.';
    default:
      return 'Giriş başarısız oldu. Lütfen tekrar deneyin.';
  }
}
