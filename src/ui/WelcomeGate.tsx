import React, { useState } from 'react';
import { Fuel, Mail, KeyRound, Stamp } from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { WelcomeScene } from '../rendering/WelcomeScene';

/**
 * Karşılama kapısı: gece, oyunun kendi 3B istasyonunun önünde duran bir
 * İSTASYON İŞLETME RUHSATI. Kimlik seçmek ruhsatını alıp vardiyaya
 * başlamaktır — misafir geçici ruhsatla üç saniyede pompadadır.
 *
 * Arka planı elle çizmeyi iki kez denedim; ikisi de tuttu tutmadı (Emre,
 * 2026-09-03: "çok karmaşık, çok özensiz" ve "Paint ile çizilmiş gibi").
 * Dersi: bu oyunun zaten bir görsel dili var — istasyonu ÇİZMEK yerine
 * oyunun kendi modellerini oynat. Sahne artık WelcomeScene'de, gerçek
 * PumpMesh/BuildingMesh/VehicleMesh ile. Buraya elle çizim geri gelmesin.
 *
 * Kapı kapatılamaz: kimlik seçilmeden oyuna dokunulmaz — profil ekranında
 * bu yüzden giriş düğmesi yoktur, orada yalnız profil ve çıkış yaşar.
 *
 * İki durumda hiç görünmez: Firebase anahtarları verilmemişse (oyun yerel
 * kayıtla, girişsiz çalışır) ve Firebase daha "kim var kim yok" dememişken
 * (yoksa oturumlu oyuncuya da bir an giriş ekranı parlardı).
 */

/** Google'ın dört renkli "G" işareti — resmî oturum açma düğmesi görünümü. */
const GoogleMark: React.FC = () => (
  <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48" aria-hidden>
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

/** Belgenin bölücüsü düz çizgi değil, sarı kesikli şerit çizgisidir. */
const LANE_DASH = 'repeating-linear-gradient(90deg, #c9a227 0 12px, transparent 12px 24px)';

const LaneDivider: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex items-center gap-3">
    <div className="h-[3px] flex-1 rounded-full opacity-80" style={{ backgroundImage: LANE_DASH }} />
    {label && (
      <span className="text-[10px] font-extrabold text-stone-500 uppercase tracking-[0.18em] shrink-0">
        {label}
      </span>
    )}
    <div className="h-[3px] flex-1 rounded-full opacity-80" style={{ backgroundImage: LANE_DASH }} />
  </div>
);

/**
 * Kapı açık mı? App bunu, kapı açıkken oyun sahnesini boşuna çizmemek için
 * de sorar — iki WebGL bağlamı aynı anda çalışmasın.
 */
export function gateIsOpen(state: {
  accountReady: boolean;
  accountResolved: boolean;
  account: unknown | null;
}): boolean {
  return state.accountReady && state.accountResolved && !state.account;
}

/** Kâğıt üstündeki alan: belge doldurur gibi. */
const FIELD =
  'w-full flex items-center gap-2.5 rounded-lg border-2 border-stone-300 bg-white px-3 py-2.5 focus-within:border-sky-500 transition-colors';
const INPUT =
  'flex-1 min-w-0 bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400';

export const WelcomeGate: React.FC = () => {
  const account = useGameStore((s) => s.account);
  const accountReady = useGameStore((s) => s.accountReady);
  const accountResolved = useGameStore((s) => s.accountResolved);
  const accountBusy = useGameStore((s) => s.accountBusy);
  const signInGoogle = useGameStore((s) => s.signInGoogle);
  const signInEmail = useGameStore((s) => s.signInEmail);
  const signInGuest = useGameStore((s) => s.signInGuest);
  const sendPasswordReset = useGameStore((s) => s.sendPasswordReset);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Kayıt ayrı bir görünümdür: "Kayıt Ol" aynı iki alanla körlemesine hesap
  // açmaya çalışmaz, şifre tekrarı isteyen kendi ekranına geçer.
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  if (!gateIsOpen({ accountReady, accountResolved, account })) return null;

  const submitRegister = () => {
    if (!email.trim()) return setFormError('E-posta adresinizi yazın.');
    if (password.length < 6) return setFormError('Şifre en az 6 karakter olmalı.');
    if (password !== passwordAgain) return setFormError('Şifreler birbirini tutmuyor.');
    setFormError(null);
    void signInEmail(email, password, true);
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden select-none">
      <style>{`
        @keyframes gate-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
      `}</style>

      {/* ---------- Sahne: oyunun kendi 3B istasyonu, gece ---------- */}
      <WelcomeScene />

      {/* Belgenin okunurluğu için sahneyi hafifçe karart ve gözü merkeze
          topla — sahne dekordur, okunacak yüzey belgedir. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(120% 95% at 50% 45%, rgba(4,7,15,0.10) 34%, rgba(4,7,15,0.58) 100%)' }}
        aria-hidden
      />

      {/* ---------- Marka + belge: tek kolon, üst üste binme yok ---------- */}
      {/* Belge dar ekranda ortada, geniş ekranda sağda durur: ortada dururken
          istasyonun tam da görülmesi gereken yerini örtüyordu (Emre,
          2026-09-03: "hiçbir şey belli olmuyor"). */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-4 lg:items-end lg:pr-[7%]">
        <div className="flex flex-col items-center gap-1 text-center">
          <div
            className="flex items-center gap-2.5"
            style={{ filter: 'drop-shadow(0 2px 10px rgba(2,6,14,0.95))' }}
          >
            <Fuel className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl sm:text-3xl font-black tracking-[0.12em] text-white">PROJECT HIGHWAY</h1>
          </div>
          <p
            className="text-[13px] font-bold text-sky-300"
            style={{ filter: 'drop-shadow(0 2px 8px rgba(2,6,14,0.95))' }}
          >
            Bir pompayla başlar her imparatorluk.
          </p>
        </div>

        {/* İşletme ruhsatı */}
        <div
          className="w-full max-w-sm max-h-[74vh] overflow-y-auto rounded-2xl border border-stone-400/50 bg-[#f6f0e2] text-stone-800 shadow-[0_28px_70px_rgba(0,0,0,0.55)]"
          style={{ animation: 'gate-in 320ms ease-out' }}
        >
          <div className="relative m-3 rounded-xl border-2 border-dashed border-stone-400/60 p-5">
            {/* Belge başlığı: ortalı mühür, ad ve belge numarası */}
            <div className="flex flex-col items-center gap-1 px-6 text-center">
              <Stamp className="h-5 w-5 text-red-700/80" />
              <div className="text-[13px] font-black uppercase leading-tight tracking-[0.12em] text-stone-900">
                İstasyon İşletme Ruhsatı
              </div>
              <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-stone-500">
                Karayolu İdaresi · Belge No. PH-2026
              </div>
            </div>

            {/* Köşe mührü: belgenin üstüne eğik basılmış */}
            <div
              className="pointer-events-none absolute right-1 top-1 flex h-14 w-14 -rotate-12 items-center justify-center rounded-full border-[3px] border-red-700/25 text-red-700/35"
              aria-hidden
            >
              <div className="text-center leading-tight">
                <div className="text-[9px] font-black tracking-[0.2em]">AÇIK</div>
                <div className="text-[8px] font-extrabold">7 / 24</div>
              </div>
            </div>

            <div className="mt-4">
              {mode === 'login' ? (
                <div className="flex flex-col gap-4">
                  {/* Misafir: geçici ruhsat */}
                  <div className="flex flex-col gap-1.5">
                    <button
                      disabled={accountBusy}
                      onClick={signInGuest}
                      className="game-btn rounded-xl border-2 border-emerald-700 bg-emerald-600 px-4 py-3.5 text-sm font-extrabold text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Geçici Ruhsat Al — Misafir Oyna
                    </button>
                    <p className="text-center text-[11px] font-semibold text-stone-500">
                      Kayıt yok, evrak yok — üç saniyede vardiyadasın.
                    </p>
                  </div>

                  <LaneDivider label="ruhsat sahibi girişi" />

                  {/* E-posta girişi */}
                  <div className="flex flex-col gap-2">
                    <label className={FIELD}>
                      <Mail className="h-4 w-4 shrink-0 text-stone-400" />
                      <input
                        type="email"
                        autoComplete="email"
                        placeholder="e-posta"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={INPUT}
                      />
                    </label>
                    <label className={FIELD}>
                      <KeyRound className="h-4 w-4 shrink-0 text-stone-400" />
                      <input
                        type="password"
                        autoComplete="current-password"
                        placeholder="şifre"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void signInEmail(email, password, false);
                        }}
                        className={INPUT}
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        disabled={accountBusy}
                        onClick={() => void signInEmail(email, password, false)}
                        className="game-btn rounded-lg border-2 border-sky-700 bg-sky-600 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-sky-500 disabled:opacity-50"
                      >
                        Giriş Yap
                      </button>
                      <button
                        disabled={accountBusy}
                        onClick={() => {
                          setFormError(null);
                          setPasswordAgain('');
                          setMode('register');
                        }}
                        className="game-btn rounded-lg border-2 border-stone-400 bg-stone-200 px-4 py-2.5 text-sm font-extrabold text-stone-700 hover:bg-stone-300 disabled:opacity-50"
                      >
                        Kayıt Ol
                      </button>
                    </div>
                  </div>

                  <LaneDivider />

                  <button
                    disabled={accountBusy}
                    onClick={signInGoogle}
                    className="game-btn flex items-center justify-center gap-3 rounded-xl border-2 border-stone-300 bg-white px-4 py-3 text-sm font-extrabold text-stone-800 hover:bg-stone-50 disabled:opacity-50"
                  >
                    <GoogleMark />
                    <span>Google ile devam et</span>
                  </button>

                  <button
                    onClick={() => {
                      if (email.trim()) void sendPasswordReset(email.trim());
                    }}
                    title="Şifre sıfırlama bağlantısı için önce e-posta alanını doldurun"
                    className="text-[11px] text-stone-500 underline underline-offset-2 transition-colors hover:text-stone-700"
                  >
                    Şifremi unuttum
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2" style={{ animation: 'gate-in 260ms ease-out' }}>
                  <div className="text-sm font-black uppercase tracking-wide text-stone-900">
                    Yeni Ruhsat Başvurusu
                  </div>
                  <label className={FIELD}>
                    <Mail className="h-4 w-4 shrink-0 text-stone-400" />
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="e-posta"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={INPUT}
                    />
                  </label>
                  <label className={FIELD}>
                    <KeyRound className="h-4 w-4 shrink-0 text-stone-400" />
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder="şifre (en az 6 karakter)"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={INPUT}
                    />
                  </label>
                  <label className={FIELD}>
                    <KeyRound className="h-4 w-4 shrink-0 text-stone-400" />
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder="şifre (tekrar)"
                      value={passwordAgain}
                      onChange={(e) => setPasswordAgain(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRegister();
                      }}
                      className={INPUT}
                    />
                  </label>

                  {formError && <p className="text-[11px] font-bold text-red-700">{formError}</p>}

                  <button
                    disabled={accountBusy}
                    onClick={submitRegister}
                    className="game-btn mt-1 rounded-xl border-2 border-emerald-700 bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Ruhsatı Onayla — Kayıt Ol
                  </button>

                  <button
                    onClick={() => {
                      setFormError(null);
                      setMode('login');
                    }}
                    className="text-[11px] text-stone-500 underline underline-offset-2 transition-colors hover:text-stone-700"
                  >
                    Zaten ruhsatım var — giriş yap
                  </button>
                </div>
              )}
            </div>

            <p className="mt-4 border-t border-stone-300 pt-3 text-center text-[10px] leading-relaxed text-stone-500">
              Ruhsat alarak ilerlemenin bu tarayıcıda ve hesabında saklanmasını kabul etmiş olursun.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
