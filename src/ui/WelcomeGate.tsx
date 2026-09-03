import React, { useState } from 'react';
import { Fuel, Mail, KeyRound, Stamp } from 'lucide-react';
import { useGameStore } from '../store/gameStore';

/**
 * Karşılama kapısı: gece otoyolu fonunda bir İSTASYON İŞLETME RUHSATI.
 *
 * Kimlik seçmek, ruhsatını alıp vardiyaya başlamaktır — misafir geçici
 * ruhsatla üç saniyede pompadadır, hesabı olan ruhsatını e-posta ya da
 * Google ile yeniler. Rakip beneloil'in düz kırmızı kartından uzak durmak
 * tasarım hedefi; ama asıl kural AZLIK: krem belge tek kahraman, sahne
 * onu çevreleyen üç öğeden fazlası değil (yol + trafik + istasyon).
 *
 * Bir kez fazlasını denedim ve kalabalık oldu (Emre, 2026-09-03: "çok
 * karmaşık, çok özensiz"). Buraya yeni bir öğe eklemek isteyen önce
 * birini çıkarsın.
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

/** Yandan görünen araç: gövde, kabin, tekerlek, far ve stop lambası. */
const Car: React.FC<{ color: string; glass?: string }> = ({ color, glass = '#12233d' }) => (
  <svg viewBox="0 0 148 48" className="w-full h-auto" aria-hidden>
    {/* Far huzmesi */}
    <ellipse cx="146" cy="31" rx="30" ry="6" fill="#ffe9b0" opacity="0.22" />
    {/* Gövde */}
    <path d="M10 33 L12 22 H34 L46 11 H88 L104 22 H126 L130 33 Z" fill={color} />
    <rect x="10" y="30" width="120" height="7" rx="3.5" fill={color} />
    {/* Cam */}
    <path d="M48 14 H68 V22 H41 Z" fill={glass} />
    <path d="M72 14 H85 L96 22 H72 Z" fill={glass} />
    {/* Gövde altı gölge çizgisi */}
    <rect x="12" y="34" width="116" height="2.5" rx="1.25" fill="#000" opacity="0.22" />
    {/* Lambalar */}
    <rect x="124" y="24" width="6" height="4" rx="2" fill="#fff3cf" />
    <rect x="10" y="24" width="5" height="4" rx="2" fill="#f0685a" />
    {/* Tekerlekler */}
    {[38, 102].map((cx) => (
      <g key={cx}>
        <circle cx={cx} cy={37} r="8.5" fill="#0f1520" />
        <circle cx={cx} cy={37} r="3.4" fill="#5b6675" />
      </g>
    ))}
  </svg>
);

/**
 * Yol kenarındaki istasyon: kanopi altında pompadan yakıt alan bir araç ve
 * yanında oyunun fiyat totemi. Belgeye rakip olmasın diye küçük, solda ve
 * yalnız geniş ekranda.
 */
const RoadsideStation: React.FC = () => (
  <div className="relative w-[268px] h-[172px]" aria-hidden>
    {/* Fiyat totemi */}
    <div className="absolute left-0 bottom-0 w-[64px]">
      <div className="rounded-md overflow-hidden border border-slate-700 shadow-xl">
        <div className="bg-red-700 py-1 text-center text-[7px] font-black leading-tight text-white tracking-wider">
          PROJECT
          <br />
          HIGHWAY
        </div>
        {[
          { label: 'BNZ', value: '44.90', chip: 'bg-emerald-600' },
          { label: 'DZL', value: '43.50', chip: 'bg-orange-500' },
          { label: 'LPG', value: '24.90', chip: 'bg-sky-600' }
        ].map((row) => (
          <div key={row.label} className="flex items-center gap-1 bg-slate-950 px-1 py-[3px]">
            <span className={`${row.chip} rounded-sm px-1 text-[6px] font-black text-white`}>{row.label}</span>
            <span className="font-mono text-[9px] font-bold text-amber-100">{row.value}</span>
          </div>
        ))}
        <div
          className="bg-emerald-700 py-0.5 text-center text-[7px] font-black tracking-[0.3em] text-white"
          style={{ animation: 'gate-pulse 2.6s ease-in-out infinite' }}
        >
          AÇIK
        </div>
      </div>
      <div className="mx-auto w-2 h-8 bg-slate-700" />
    </div>

    {/* Kanopi: saçak + altına düşen ışık + iki direk */}
    <div className="absolute left-[84px] right-0 top-0">
      <div className="h-3 rounded-sm bg-slate-700 border-b-2 border-sky-500/80" />
      <div
        className="h-9"
        style={{
          background: 'linear-gradient(180deg, rgba(224,242,254,0.22), transparent)',
          animation: 'gate-flicker 8s linear infinite'
        }}
      />
      <div className="absolute top-3 left-3 w-1.5 h-[128px] bg-slate-700" />
      <div className="absolute top-3 right-5 w-1.5 h-[128px] bg-slate-700" />
    </div>

    {/* Pompa: gövde + yanan sayaç ekranı */}
    <div className="absolute left-[104px] bottom-[6px] w-8">
      <div className="rounded-t-md border border-red-950 bg-red-800 px-1.5 pt-1.5 pb-2 shadow-lg">
        <div
          className="flex h-3.5 items-center justify-center rounded-sm bg-emerald-300 font-mono text-[6px] font-black text-emerald-950"
          style={{ animation: 'gate-pulse 1.8s ease-in-out infinite' }}
        >
          22.4L
        </div>
        <div className="mt-1 h-1 rounded-sm bg-red-950/60" />
        <div className="mt-0.5 h-1 rounded-sm bg-red-950/60" />
      </div>
      <div className="mx-auto h-3 w-6 rounded-sm bg-slate-800" />
    </div>

    {/* Hortum: pompadan aracın deposuna, ucunda tabanca */}
    <svg className="absolute left-[126px] bottom-[26px] w-[74px] h-[52px]" viewBox="0 0 74 52" aria-hidden>
      <path d="M4 6 C 0 26, 20 40, 44 32" stroke="#1e293b" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <rect x="42" y="28" width="10" height="6" rx="2" fill="#0f172a" />
    </svg>

    {/* Damlayan yakıt */}
    {[0, 0.9].map((delay) => (
      <div
        key={delay}
        className="absolute left-[196px] bottom-[34px] h-1.5 w-[3px] rounded-full bg-amber-300"
        style={{ animation: `gate-drip 1.8s ease-in ${delay}s infinite` }}
      />
    ))}

    {/* Yakıt alan araç + litre rozeti */}
    <div className="absolute left-[150px] bottom-0 w-[112px]">
      <Car color="#3f7f9e" />
      <div
        className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-emerald-500/60 bg-slate-900/95 px-2 py-0.5 font-mono text-[9px] font-bold text-emerald-300"
        style={{ animation: 'gate-pulse 1.8s ease-in-out infinite' }}
      >
        22 L
      </div>
    </div>
  </div>
);

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

  if (!accountReady || !accountResolved || account) return null;

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
        @keyframes gate-right { from { transform: translateX(-20vw) } to { transform: translateX(120vw) } }
        @keyframes gate-left { from { transform: translateX(120vw) scaleX(-1) } to { transform: translateX(-20vw) scaleX(-1) } }
        @keyframes gate-pulse { 0%,100% { opacity: 0.6 } 50% { opacity: 1 } }
        @keyframes gate-flicker { 0%,93%,97%,100% { opacity: 0.9 } 95% { opacity: 0.5 } }
        @keyframes gate-drip { 0% { transform: translateY(0); opacity: 0 } 20% { opacity: 1 } 100% { transform: translateY(12px); opacity: 0 } }
        @keyframes gate-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        @media (prefers-reduced-motion: reduce) {
          .gate-scene * { animation: none !important }
        }
      `}</style>

      {/* ---------- Sahne: gece + yol + trafik + istasyon ---------- */}
      <div className="gate-scene absolute inset-0 pointer-events-none" aria-hidden>
        {/* Gökyüzü ve ufuktaki şehir ışığı */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#080d1c] via-[#101c39] to-[#182741]" />
        <div className="absolute inset-x-0 bottom-[24%] h-28 bg-gradient-to-t from-amber-200/10 to-transparent" />

        {/* Yol bandı */}
        <div className="absolute inset-x-0 bottom-0 h-[24%] bg-[#171b21]">
          <div className="absolute inset-x-0 top-2 h-[3px] bg-slate-200/35" />
          <div className="absolute inset-x-0 bottom-3 h-[3px] bg-slate-200/35" />
          <div
            className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 opacity-80"
            style={{
              backgroundImage: 'repeating-linear-gradient(90deg, #d8a91b 0 44px, transparent 44px 84px)'
            }}
          />

          {/* Sağa akan trafik */}
          {[
            { d: 11, delay: 0, color: '#d97a3c', w: 'w-32' },
            { d: 14, delay: 5.5, color: '#4a7fb8', w: 'w-28' },
            { d: 9.5, delay: 9, color: '#4f9d68', w: 'w-[136px]' }
          ].map((car, i) => (
            <div
              key={`r${i}`}
              className={`absolute bottom-[9%] ${car.w}`}
              style={{ animation: `gate-right ${car.d}s linear ${car.delay}s infinite` }}
            >
              <Car color={car.color} />
            </div>
          ))}

          {/* Sola akan trafik */}
          {[
            { d: 12.5, delay: 2.5, color: '#b0574a', w: 'w-28' },
            { d: 15, delay: 8, color: '#7a6bb0', w: 'w-24' }
          ].map((car, i) => (
            <div
              key={`l${i}`}
              className={`absolute top-[7%] ${car.w}`}
              style={{ animation: `gate-left ${car.d}s linear ${car.delay}s infinite` }}
            >
              <Car color={car.color} />
            </div>
          ))}
        </div>

        {/* İstasyon: yolun hemen üstünde, solda; belgeye asla değmez */}
        <div className="absolute bottom-[24%] left-[5%] hidden xl:block">
          <RoadsideStation />
        </div>
      </div>

      {/* ---------- Marka + belge: tek kolon, üst üste binme yok ---------- */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-4">
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="flex items-center gap-2.5">
            <Fuel className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl sm:text-3xl font-black tracking-[0.12em] text-white">PROJECT HIGHWAY</h1>
          </div>
          <p className="text-[13px] font-bold text-sky-300/90">Bir pompayla başlar her imparatorluk.</p>
        </div>

        {/* İşletme ruhsatı */}
        <div
          className="w-full max-w-sm max-h-[74vh] overflow-y-auto rounded-2xl border border-stone-400/50 bg-[#f6f0e2] text-stone-800 shadow-[0_28px_70px_rgba(0,0,0,0.55)]"
          style={{ animation: 'gate-in 320ms ease-out' }}
        >
          <div className="relative m-3 rounded-xl border-2 border-dashed border-stone-400/60 p-5">
            {/* Belge başlığı: ortalı mühür, ad ve belge numarası */}
            <div className="flex flex-col items-center gap-1 text-center">
              <Stamp className="h-5 w-5 text-red-700/80" />
              <div className="text-[15px] font-black uppercase tracking-[0.16em] text-stone-900">
                İstasyon İşletme Ruhsatı
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">
                Karayolu İdaresi · Belge No. PH-2026
              </div>
            </div>

            {/* Köşe mührü: belgenin üstüne eğik basılmış */}
            <div
              className="pointer-events-none absolute right-5 top-5 flex h-16 w-16 -rotate-12 items-center justify-center rounded-full border-[3px] border-red-700/30 text-red-700/40"
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
