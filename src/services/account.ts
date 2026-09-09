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
  signInWithRedirect,
  getRedirectResult,
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

/**
 * The Firebase app, if the keys are there — for the parts of the game that
 * talk to Firebase without needing a signed-in user (the feedback box, for
 * one). Null when the game runs without a backend.
 */
export function firebaseAppIfReady(): FirebaseApp | null {
  if (!accountBackendReady()) return null;
  app ??= initializeApp({
    apiKey: config.apiKey!,
    authDomain: config.authDomain!,
    projectId: config.projectId!,
    appId: config.appId!
  });
  return app;
}

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

/**
 * Popup first, redirect when the browser swallows the popup (Emre,
 * 2026-09-09: "Google ile devam et'e basınca hiçbir şey açılmıyor" — a
 * popup blocker, and the error toast was hidden under the welcome gate).
 * Pure so the fallback rule can be pinned without Firebase.
 */
export async function popupThenRedirect(
  popup: () => Promise<unknown>,
  redirect: () => Promise<unknown>
): Promise<void> {
  try {
    await popup();
  } catch (error) {
    if (authErrorCode(error) !== 'auth/popup-blocked') throw error;
    await redirect();
  }
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  await popupThenRedirect(
    () => signInWithPopup(auth(), provider),
    () => signInWithRedirect(auth(), provider)
  );
}

/**
 * After a redirect sign-in the page comes back with the result in the URL;
 * this reads it. Success arrives through watchAccount anyway — what this
 * adds is the failure, which would otherwise be silent.
 */
export async function finishRedirectSignIn(): Promise<void> {
  if (!accountBackendReady()) return;
  await getRedirectResult(auth());
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
export function authErrorCode(error: unknown): string {
  return (error as { code?: string })?.code ?? '';
}

export function describeAuthError(error: unknown): string {
  const code = authErrorCode(error);
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
    case 'auth/cancelled-popup-request':
      return 'Zaten açık bir giriş penceresi var; önce onu tamamlayın.';
    case 'auth/popup-blocked':
      return 'Tarayıcı giriş penceresini engelledi. Adres çubuğundaki uyarıdan izin verip tekrar deneyin ya da e-posta ile girin.';
    case 'auth/unauthorized-domain':
      return 'Bu adres Firebase\'de yetkili değil: Console > Authentication > Settings > Authorized domains listesine ekleyin.';
    case 'auth/operation-not-allowed':
      return 'Bu giriş yöntemi Firebase\'de kapalı: Authentication > Sign-in method bölümünden açın.';
    case 'auth/operation-not-supported-in-this-environment':
      return 'Bu tarayıcı girişi desteklemiyor (uygulama içi tarayıcı olabilir). Bağlantıyı Chrome ya da Safari\'de açın.';
    case 'auth/too-many-requests':
      return 'Çok fazla deneme yapıldı; biraz bekleyip tekrar deneyin.';
    case 'auth/network-request-failed':
      return 'Ağ hatası — bağlantınızı kontrol edin.';
    default:
      return `Giriş başarısız oldu${code ? ` (${code})` : ''}. Lütfen tekrar deneyin.`;
  }
}
