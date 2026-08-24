import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { X, Landmark, CreditCard, ShieldCheck, AlertCircle, CheckCircle } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

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
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700/80 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">Finans & Bankacılık</div>
              <div className="text-base font-extrabold text-white">Banka Kredileri & Borç Yönetimi</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Active Loans Section */}
        <div className="p-6 flex flex-col gap-5 overflow-y-auto flex-1">
          {activeLoans.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="text-xs font-bold text-slate-400 uppercase">Aktif Krediler ({activeLoans.length}/2)</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeLoans.map((loan) => (
                  <div
                    key={loan.id}
                    className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-extrabold text-sm text-white">{loan.name}</span>
                      <span className="text-xs font-mono font-bold text-amber-400">
                        ₺{loan.dailyPayment.toLocaleString('tr-TR')} / gün
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${Math.max(0, (1 - loan.remaining / loan.totalDue) * 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] font-mono text-slate-400">
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
            <div className="text-xs font-bold text-slate-400 uppercase">Kredi Paketleri</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {GAME_CONFIG.loans.map((loan) => {
                const isLevelOk = gameState.player.level >= loan.minLevel;
                const isRepOk = gameState.player.reputation >= loan.minReputation;
                const isEligible = isLevelOk && isRepOk && activeLoans.length < 2;
                const isAlreadyActive = activeLoans.some((l) => l.productId === loan.id);

                return (
                  <div
                    key={loan.id}
                    className={`bg-slate-950/60 border rounded-2xl p-4 flex flex-col justify-between gap-3 ${
                      !isEligible ? 'border-slate-800 opacity-60' : 'border-slate-700/80 hover:border-emerald-500/50'
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-extrabold text-sm text-white">{loan.name}</span>
                        <span className="text-sm font-black font-mono text-emerald-400">
                          ₺{loan.principal.toLocaleString('tr-TR')}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 mb-2">
                        <div>Vade: {loan.termDays} Gün</div>
                        <div>Maliyet: %{Math.round(loan.totalCostRatio * 100)}</div>
                        <div className="col-span-2">Günlük Taksit: ₺{loan.dailyPayment.toLocaleString('tr-TR')}</div>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Şartlar: Seviye {loan.minLevel} • {loan.minReputation} İtibar
                      </div>
                    </div>

                    <button
                      onClick={() => takeLoan(loan.id)}
                      disabled={!isEligible || isAlreadyActive}
                      className={`w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                        !isEligible || isAlreadyActive
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
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
