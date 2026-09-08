import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { X, Landmark, CreditCard, ShieldCheck, AlertCircle, CheckCircle } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

const CARD = 'bg-paper border-2 border-ink rounded-md p-4 shadow-k';

export const BankModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const takeLoan = useGameStore((s) => s.takeLoan);

  const activeLoans = gameState.loans.filter((l) => l.state === 'ACTIVE');

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  return (
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="k-head k-head-grn shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge w-9 h-9">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-black tracking-[0.12em] opacity-80 font-sans">Finans & Bankacılık</div>
              <div className="font-display text-xl tracking-wide leading-tight">Banka Kredileri & Borç Yönetimi</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Active Loans Section */}
        <div className="p-6 flex flex-col gap-5 overflow-y-auto flex-1">
          {activeLoans.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="k-label text-[11px] border-b-2 border-ink pb-1">Aktif Krediler ({activeLoans.length}/2)</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeLoans.map((loan) => (
                  <div
                    key={loan.id}
                    className={`${CARD} flex flex-col gap-2`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-display text-base text-ink tracking-wide">{loan.name}</span>
                      <span className="text-xs font-mono font-bold text-kyel-dark">
                        ₺{loan.dailyPayment.toLocaleString('tr-TR')} / gün
                      </span>
                    </div>
                    <div className="w-full k-bar">
                      <div
                        className="h-full bg-kgrn transition-all duration-300"
                        style={{ width: `${Math.max(0, (1 - loan.remaining / loan.totalDue) * 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] font-mono text-mute">
                      <span>Kalan Borç: ₺{loan.remaining.toLocaleString('tr-TR')}</span>
                      <span>Toplam: ₺{loan.totalDue.toLocaleString('tr-TR')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Available Loan Products */}
          <div className="flex flex-col gap-3">
            <div className="k-label text-[11px] border-b-2 border-ink pb-1">Kredi Paketleri</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {GAME_CONFIG.loans.map((loan) => {
                const isLevelOk = gameState.player.level >= loan.minLevel;
                const isRepOk = gameState.player.reputation >= loan.minReputation;
                const isEligible = isLevelOk && isRepOk && activeLoans.length < 2;
                const isAlreadyActive = activeLoans.some((l) => l.productId === loan.id);

                return (
                  <div
                    key={loan.id}
                    className={`${CARD} flex flex-col justify-between gap-3 ${
                      !isEligible ? 'opacity-60' : ''
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-display text-base text-ink tracking-wide">{loan.name}</span>
                        <span className="text-sm font-black font-mono text-kgrn">
                          ₺{loan.principal.toLocaleString('tr-TR')}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-ink bg-board p-2.5 rounded-md border-2 border-ink mb-2">
                        <div>Vade: {loan.termDays} Gün</div>
                        <div>Maliyet: %{Math.round(loan.totalCostRatio * 100)}</div>
                        <div className="col-span-2">Günlük Taksit: ₺{loan.dailyPayment.toLocaleString('tr-TR')}</div>
                      </div>
                      <div className="text-[10px] font-bold text-mute">
                        Şartlar: Seviye {loan.minLevel} • {loan.minReputation} İtibar
                      </div>
                    </div>

                    <button
                      onClick={() => takeLoan(loan.id)}
                      disabled={!isEligible || isAlreadyActive}
                      className={`game-btn w-full py-2.5 font-display text-sm tracking-wide flex items-center justify-center gap-1.5 ${
                        !isEligible || isAlreadyActive
                          ? 'bg-card text-mute'
                          : 'bg-kgrn hover:bg-kgrn-dark text-white'
                      }`}
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>{isAlreadyActive ? 'Zaten Aktif' : isEligible ? 'Krediyi Kullan' : 'Kilitli'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
