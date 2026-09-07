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
  <div className="k-row last:border-0">
    <span>{label}</span>
    <span className={accent}>{value}</span>
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
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="k-head k-head-blu shrink-0">
          <div className="font-display text-xl tracking-wide">Hesabım</div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto flex-1">
          {/* Profil kartı — istasyon adı markadır, kalemle burada değişir. */}
          <div className="bg-board border-2 border-ink rounded-md p-4 flex items-center gap-4">
            <div className="game-icon-badge w-14 h-14 bg-paper text-kblu">
              <UserRound className="w-7 h-7" />
            </div>
            <div className="min-w-0">
              {editingName === null ? (
                <div className="flex items-center gap-2">
                  <div className="font-display text-xl text-ink uppercase tracking-wide truncate">{station.name}</div>
                  <button
                    onClick={() => setEditingName(station.name)}
                    title="İstasyon adını değiştir — tabelalar da güncellenir"
                    className="text-mute hover:text-kblu transition-colors shrink-0"
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
                    className="bg-paper border-2 border-ink rounded-md px-2 py-1 text-base font-extrabold text-ink w-44 outline-none focus:border-kblu"
                  />
                  <button
                    onClick={commitName}
                    className="game-btn w-7 h-7 rounded-md bg-kgrn hover:bg-kgrn-dark text-white flex items-center justify-center"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="text-xs text-mute truncate">
                {account
                  ? (account.email ?? `${account.name} · ${PROVIDER_LABEL[account.provider]}`)
                  : 'Giriş yapılmadı — yerel kayıt'}
              </div>
            </div>
          </div>

          {/* İstatistikler */}
          <div>
            <div className="k-label mb-1">İstatistikler</div>
            <div className="bg-board border-2 border-ink rounded-md px-4 py-1">
              <Row label="Oyun günü" value={dayState.currentDay} />
              <Row label="İtibar" value={`${player.reputation.toFixed(1)} / 5`} />
              <Row label="Toplam müşteri" value={stats.totalCustomersServed.toLocaleString('tr-TR')} accent="!text-kgrn" />
              <Row label="Kaçan müşteri" value={stats.totalCustomersLost.toLocaleString('tr-TR')} />
              <Row
                label="Toplam ciro"
                value={`₺${Math.round(stats.totalRevenue).toLocaleString('tr-TR')}`}
                accent="!text-kgrn"
              />
              <Row label="Seviye" value={`${player.level} · ${player.xp.toLocaleString('tr-TR')} XP`} />
              <Row label="Günlük görev" value={`${dailyDone}/${dailyTotal || 3}`} />
            </div>
          </div>

          {/* Hesap */}
          <div>
            <div className="k-label mb-1">Hesap</div>

            {!accountReady && (
              <div className="bg-board border-2 border-ink rounded-md p-4 flex items-start gap-3">
                <CloudOff className="w-4 h-4 text-mute mt-0.5 shrink-0" />
                <p className="text-xs text-ink leading-relaxed">
                  Çevrimiçi hesap henüz yapılandırılmadı; oyun <b className="text-ink font-black">yerel kayıtla</b> oynanıyor.
                  Google/e-posta girişi için <code className="text-kblu">.env</code> dosyasına Firebase anahtarları
                  eklenmeli (<code className="text-kblu">.env.example</code>'a bakın).
                </p>
              </div>
            )}

            {accountReady && account && (
              <div className="flex flex-col gap-2">
                <div className="bg-board border-2 border-ink rounded-md px-4 py-1">
                  <Row
                    label="Giriş yöntemi"
                    value={
                      <span className="bg-card border border-ink text-ink rounded-sm text-[11px] font-black px-2">
                        {PROVIDER_LABEL[account.provider]}
                      </span>
                    }
                  />
                  {account.email && <Row label="E-posta" value={account.email} />}
                </div>
                <button
                  onClick={signOutAccount}
                  className="game-btn px-4 py-3 font-display text-base tracking-wide bg-kred hover:bg-kred-dark text-white flex items-center justify-center gap-2"
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
