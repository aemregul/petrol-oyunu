import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { X, UserRound, LogOut, Pencil, Check, CloudOff } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

/**
 * Hesabım: yalnız profil — kim olduğun, istasyonun adı, ömürlük istatistikler
 * ve Çıkış Yap. Giriş düğmeleri BURADA DEĞİL: kimlik, oyun açılırken karşılama
 * kapısında (WelcomeGate) seçilir; çıkış yapınca kapı yeniden belirir
 * (Emre'nin istediği beneloil akışı, 2026-09-03).
 *
 * İstasyon adı burada değiştirilir; tabelalar station.name'i reaktif
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
  const signOutAccount = useGameStore((s) => s.signOutAccount);
  const renameStation = useGameStore((s) => s.renameStation);
  const gameState = useGameStore((s) => s.gameState);

  const { player, station, dayState, missions } = gameState;
  const stats = player.statistics;
  const daily = missions.filter((m) => m.type === 'DAILY_MAIN' || m.type === 'DAILY_NORMAL');
  const dailyDone = daily.filter((m) => m.completed).length;
  const dailyTotal = daily.length;

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
