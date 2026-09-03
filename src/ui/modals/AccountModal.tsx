import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  X,
  UserRound,
  LogOut,
  Mail,
  KeyRound,
  Pencil,
  Check,
  CloudOff
} from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

/**
 * Hesabım: oyuncunun profili — kim olduğu, istasyonunun adı ve ömürlük
 * istatistikleri. Giriş yoksa aynı pencere giriş ekranıdır: Google, e-posta
 * ya da misafir. Firebase anahtarları verilmemişse giriş kibarca kapalıdır ve
 * oyun yerel kayıtla oynanmaya devam eder — pencere bunu açıkça söyler.
 *
 * İstasyon adı burada da değiştirilir; tabelalar station.name'i reaktif
 * okuduğundan değişiklik sahaya anında yansır.
 */
const PROVIDER_LABEL = { google: 'Google', email: 'E-posta', guest: 'Misafir' } as const;

const Row: React.FC<{ label: string; value: React.ReactNode; accent?: string }> = ({
  label,
  value,
  accent
}) => (
  <div className="flex justify-between items-center py-2.5 border-b border-slate-800 last:border-0">
    <span className="text-xs font-bold text-slate-300">{label}</span>
    <span className={`text-xs font-extrabold font-mono ${accent ?? 'text-white'}`}>{value}</span>
  </div>
);

export const AccountModal: React.FC = () => {
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const account = useGameStore((s) => s.account);
  const accountReady = useGameStore((s) => s.accountReady);
  const accountBusy = useGameStore((s) => s.accountBusy);
  const signInGoogle = useGameStore((s) => s.signInGoogle);
  const signInEmail = useGameStore((s) => s.signInEmail);
  const signInGuest = useGameStore((s) => s.signInGuest);
  const signOutAccount = useGameStore((s) => s.signOutAccount);
  const renameStation = useGameStore((s) => s.renameStation);
  const gameState = useGameStore((s) => s.gameState);

  const { player, station, dayState, missions } = gameState;
  const stats = player.statistics;
  const daily = missions.filter((m) => m.type === 'DAILY_MAIN' || m.type === 'DAILY_NORMAL');
  const dailyDone = daily.filter((m) => m.completed).length;
  const dailyTotal = daily.length;

  const [emailForm, setEmailForm] = useState<{ email: string; password: string; register: boolean } | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  const commitName = () => {
    if (editingName !== null && renameStation(editingName)) setEditingName(null);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-gradient-to-b from-slate-800 to-slate-800/60 px-6 py-4 border-b-2 border-slate-700 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-5 rounded-full bg-red-500" />
            <div className="text-base font-extrabold text-white">Hesabım</div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn w-8 h-8 rounded-xl bg-slate-700 border-2 border-slate-600 hover:bg-slate-600 text-slate-200 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto flex-1">
          {/* Profil kartı — istasyon adı markadır, kalemle burada değişir. */}
          <div className="bg-slate-950/60 border-2 border-slate-700 rounded-2xl p-4 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-red-500/15 border-2 border-red-500/40 text-red-400 flex items-center justify-center shrink-0">
              <UserRound className="w-7 h-7" />
            </div>
            <div className="min-w-0">
              {editingName === null ? (
                <div className="flex items-center gap-2">
                  <div className="text-lg font-black text-white uppercase truncate">{station.name}</div>
                  <button
                    onClick={() => setEditingName(station.name)}
                    title="İstasyon adını değiştir — tabelalar da güncellenir"
                    className="text-slate-400 hover:text-sky-400 transition-colors shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={editingName}
                    maxLength={24}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitName();
                      if (e.key === 'Escape') setEditingName(null);
                    }}
                    className="bg-slate-950/80 border border-sky-500/50 rounded-lg px-2 py-1 text-base font-extrabold text-white w-44 outline-none focus:border-sky-400"
                  />
                  <button
                    onClick={commitName}
                    className="game-btn w-7 h-7 rounded-lg bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 flex items-center justify-center"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="text-xs text-slate-400 truncate">
                {account
                  ? (account.email ?? `${account.name} · ${PROVIDER_LABEL[account.provider]}`)
                  : 'Giriş yapılmadı — yerel kayıt'}
              </div>
            </div>
          </div>

          {/* İstatistikler */}
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">İstatistikler</div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl px-4 py-1">
              <Row label="Oyun günü" value={dayState.currentDay} />
              <Row label="İtibar" value={`${player.reputation.toFixed(1)} / 5`} />
              <Row label="Toplam müşteri" value={stats.totalCustomersServed.toLocaleString('tr-TR')} accent="text-emerald-400" />
              <Row label="Kaçan müşteri" value={stats.totalCustomersLost.toLocaleString('tr-TR')} />
              <Row
                label="Toplam ciro"
                value={`₺${Math.round(stats.totalRevenue).toLocaleString('tr-TR')}`}
                accent="text-emerald-400"
              />
              <Row label="Seviye" value={`${player.level} · ${player.xp.toLocaleString('tr-TR')} XP`} />
              <Row label="Günlük görev" value={`${dailyDone}/${dailyTotal || 3}`} />
            </div>
          </div>

          {/* Hesap */}
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">Hesap</div>

            {!accountReady && (
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex items-start gap-3">
                <CloudOff className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-400 leading-relaxed">
                  Çevrimiçi hesap henüz yapılandırılmadı; oyun <b className="text-slate-300">yerel kayıtla</b> oynanıyor.
                  Google/e-posta girişi için <code className="text-sky-400">.env</code> dosyasına Firebase anahtarları
                  eklenmeli (<code className="text-sky-400">.env.example</code>'a bakın).
                </p>
              </div>
            )}

            {accountReady && !account && (
              <div className="flex flex-col gap-2">
                <button
                  disabled={accountBusy}
                  onClick={signInGoogle}
                  className="game-btn rounded-xl px-4 py-2.5 text-xs font-extrabold bg-white text-slate-900 border-2 border-slate-300 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span className="font-black text-sm">G</span>
                  <span>Google ile Giriş Yap</span>
                </button>

                {emailForm === null ? (
                  <button
                    disabled={accountBusy}
                    onClick={() => setEmailForm({ email: '', password: '', register: false })}
                    className="game-btn rounded-xl px-4 py-2.5 text-xs font-extrabold bg-slate-800 border-2 border-slate-600 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Mail className="w-4 h-4" />
                    <span>E-posta ile Devam Et</span>
                  </button>
                ) : (
                  <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2">
                      <Mail className="w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="email"
                        placeholder="E-posta"
                        value={emailForm.email}
                        onChange={(e) => setEmailForm({ ...emailForm, email: e.target.value })}
                        className="bg-transparent outline-none text-xs text-white flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2">
                      <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="password"
                        placeholder="Şifre"
                        value={emailForm.password}
                        onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })}
                        className="bg-transparent outline-none text-xs text-white flex-1"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={accountBusy}
                        onClick={async () => {
                          if (await signInEmail(emailForm.email, emailForm.password, emailForm.register)) {
                            setEmailForm(null);
                          }
                        }}
                        className="game-btn flex-1 rounded-xl px-3 py-2 text-xs font-extrabold bg-sky-600/30 border-2 border-sky-500/40 text-sky-300 disabled:opacity-50"
                      >
                        {emailForm.register ? 'Hesap Aç' : 'Giriş Yap'}
                      </button>
                      <button
                        onClick={() => setEmailForm({ ...emailForm, register: !emailForm.register })}
                        className="text-[11px] text-slate-400 hover:text-slate-200 px-2"
                      >
                        {emailForm.register ? 'Zaten hesabım var' : 'Yeni hesap aç'}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  disabled={accountBusy}
                  onClick={signInGuest}
                  className="rounded-xl px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
                >
                  Misafir olarak devam et
                </button>
              </div>
            )}

            {accountReady && account && (
              <div className="flex flex-col gap-2">
                <div className="bg-slate-950/60 border border-slate-800 rounded-2xl px-4 py-1">
                  <Row label="Giriş yöntemi" value={PROVIDER_LABEL[account.provider]} />
                  {account.email && <Row label="E-posta" value={account.email} />}
                </div>
                <button
                  onClick={signOutAccount}
                  className="game-btn rounded-xl px-4 py-3 text-sm font-extrabold bg-red-600/80 hover:bg-red-600 border-2 border-red-500 text-white flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Çıkış Yap</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
