import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { Award, ArrowRight, DollarSign, Fuel, ShoppingBag, Users, Wrench, Landmark } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

export const DayReportModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const startNextDay = useGameStore((s) => s.startNextDay);

  const { dayState, player } = gameState;
  const stats = dayState.todayStats;

  const totalCiro = stats.fuelRevenue + stats.marketRevenue;
  const cogs = stats.fuelCost + stats.marketCost;
  const brutKar = totalCiro - cogs;
  const operatingExpenses = stats.wages + stats.upkeep + stats.repairs;
  const financingExpenses = stats.loanPayments;
  const netKar = brutKar - operatingExpenses - financingExpenses;

  const handleNextDay = () => {
    startNextDay();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden text-slate-100 flex flex-col">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-sky-900 via-indigo-900 to-slate-900 px-6 py-5 border-b border-slate-700 text-center relative">
          <div className="text-xs uppercase font-extrabold text-sky-400 tracking-widest">
            GÜN {dayState.currentDay} TAMAMLANDI
          </div>
          <div className="text-2xl font-black text-white mt-1">Gün Sonu Faaliyet Raporu</div>
        </div>

        {/* Financial Breakdown Table */}
        <div className="p-6 flex flex-col gap-3 font-mono text-xs">
          {/* Ciro */}
          <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-emerald-400 font-bold">
            <span className="font-sans">Toplam Ciro (Akaryakıt + Market)</span>
            <span className="text-sm">+₺{totalCiro.toLocaleString('tr-TR')}</span>
          </div>

          {/* Satılan Mal Maliyeti */}
          <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-orange-400">
            <span className="font-sans">Satılan Mal Maliyeti (COGS)</span>
            <span>-₺{cogs.toLocaleString('tr-TR')}</span>
          </div>

          {/* Brüt Kâr */}
          <div className="flex justify-between items-center bg-slate-800/80 p-3 rounded-xl border border-slate-700 text-white font-bold">
            <span className="font-sans">Brüt Kâr</span>
            <span className="text-sm">₺{brutKar.toLocaleString('tr-TR')}</span>
          </div>

          {/* Faaliyet Giderleri */}
          <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-red-400">
            <span className="font-sans">Faaliyet Giderleri (Maaş, Bakım, Temizlik)</span>
            <span>-₺{operatingExpenses.toLocaleString('tr-TR')}</span>
          </div>

          {/* Finansman Giderleri */}
          {financingExpenses > 0 && (
            <div className="flex justify-between items-center bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-purple-400">
              <span className="font-sans">Finansman Giderleri (Banka Taksitleri)</span>
              <span>-₺{financingExpenses.toLocaleString('tr-TR')}</span>
            </div>
          )}

          {/* Net Kâr / Zarar Hero Box */}
          <div
            className={`flex justify-between items-center p-4 rounded-2xl border-2 font-black text-base mt-2 ${
              netKar >= 0
                ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400'
                : 'bg-red-950/40 border-red-500/50 text-red-400'
            }`}
          >
            <span className="font-sans uppercase tracking-wider">GÜNLÜK NET KÂR</span>
            <span className="text-xl">{netKar >= 0 ? `+₺${netKar.toLocaleString('tr-TR')}` : `₺${netKar.toLocaleString('tr-TR')}`}</span>
          </div>

          {/* Customer & Station Service Summary */}
          <div className="grid grid-cols-3 gap-2 mt-2 font-sans text-center text-[11px]">
            <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800">
              <div className="text-slate-400">Hizmet Alan</div>
              <div className="font-bold text-white font-mono mt-0.5">{stats.customersServed} Araç</div>
            </div>
            <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800">
              <div className="text-slate-400">Sabrı Tükenen</div>
              <div className="font-bold text-red-400 font-mono mt-0.5">{stats.customersLost} Araç</div>
            </div>
            <div
              className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800"
              title="Sıra dolu olduğu için hiç durmadan geçen sürücüler. İtibarınıza zarar vermez — daha fazla pompa gerektiğinin işaretidir."
            >
              <div className="text-slate-400">Yer Bulamayan</div>
              <div className="font-bold text-amber-400 font-mono mt-0.5">
                {stats.customersTurnedAway ?? 0} Araç
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2 font-sans text-center text-[11px]">
            <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800">
              <div className="text-slate-400">Bahşiş Geliri</div>
              <div className="font-bold text-amber-400 font-mono mt-0.5">₺{stats.tips}</div>
            </div>
            <div className="bg-slate-950/40 p-2.5 rounded-xl border border-slate-800">
              <div className="text-slate-400">Güncel İtibar</div>
              <div className="font-bold text-sky-400 font-mono mt-0.5">★ {player.reputation.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="p-6 bg-slate-950/60 border-t border-slate-800">
          <button
            onClick={handleNextDay}
            className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-wider bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-500 hover:from-sky-400 hover:to-emerald-400 text-slate-950 shadow-2xl shadow-sky-500/30 flex items-center justify-center gap-2 transition-all hover:scale-[1.01]"
          >
            <span>Yeni Güne Başla (Gün {dayState.currentDay + 1})</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
