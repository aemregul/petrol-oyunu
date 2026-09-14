import React from 'react';
import { Stamp, X } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { GUEST_DAY_LIMIT } from '../../services/guestLicence';

const lira = (n: number) => `₺${Math.round(n).toLocaleString('tr-TR')}`;

/**
 * The end of a guest's temporary licence (Emre, 2026-09-14). Shown when a
 * guest closes the fifth day: the station is not lost, it is waiting for an
 * account. Signing in happens at the welcome gate, which only opens with
 * nobody signed in, so the button leaves the guest session to get there; the
 * save stays in this browser and goes to the account on sign-in.
 */
export const GuestLimitModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const leaveGuestForSignIn = useGameStore((s) => s.leaveGuestForSignIn);
  const accountBusy = useGameStore((s) => s.accountBusy);

  const { station, player, dayState } = gameState;

  return (
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]">
        <div className="k-head k-head-yel shrink-0">
          <div className="flex items-center gap-2">
            <Stamp className="w-5 h-5" />
            <span className="font-display text-lg tracking-wide">Geçici Ruhsatın Doldu</span>
          </div>
          <button
            onClick={() => setActiveModal('DAY_REPORT')}
            className="game-btn bg-card text-ink w-8 h-8 rounded-md flex items-center justify-center shrink-0"
            aria-label="Kapat"
            title="Rapora dön"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3 overflow-y-auto">
          <p className="text-[14px] font-semibold text-ink leading-relaxed">
            Misafir olarak {GUEST_DAY_LIMIT} gün işlettin. <b>{station.name}</b> kapanmadı: kaydolduğunda ya da hesabınla
            girdiğinde istasyonun, kasan ve yapıların olduğu gibi hesabına taşınır, kaldığın sabahtan devam edersin.
          </p>

          <div className="bg-board border-2 border-ink rounded-md px-4 py-1">
            <div className="k-row">
              <span>Oyun günü</span>
              <span>{dayState.currentDay}</span>
            </div>
            <div className="k-row">
              <span>Kasa</span>
              <span>{lira(player.cash)}</span>
            </div>
            <div className="k-row">
              <span>Seviye</span>
              <span>{player.level}</span>
            </div>
            <div className="k-row">
              <span>İtibar</span>
              <span>★ {player.reputation.toFixed(2)}</span>
            </div>
          </div>

          <p className="text-[12px] font-semibold text-mute leading-snug">
            Kayıt ekranına geçmek için misafir oturumun kapanır; bu cihazdaki kaydın silinmez. Hesapla girdiğinde
            ilerlemen buluta da kaydedilir, başka cihazdan da devam edebilirsin.
          </p>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setActiveModal('DAY_REPORT')}
              className="game-btn bg-card hover:bg-board text-ink px-4 py-2.5 font-display text-sm tracking-wide"
            >
              Sonra
            </button>
            <button
              onClick={() => void leaveGuestForSignIn()}
              disabled={accountBusy}
              className="game-btn flex-1 bg-kgrn hover:bg-kgrn-dark text-white px-4 py-2.5 font-display text-[15px] tracking-wide"
            >
              Kaydol / Giriş Yap
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
