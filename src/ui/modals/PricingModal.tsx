import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { FuelType } from '../../domain/types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
import { calculatePriceAttractiveness } from '../../domain/formulas/economy';
import { X, Tag, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

export const PricingModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const setFuelPrice = useGameStore((s) => s.setFuelPrice);

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  const handleApplyPreset = (fuelType: FuelType, preset: 'CHEAP' | 'BALANCED' | 'HIGH_MARGIN') => {
    const pricing = gameState.pricing[fuelType];
    if (!pricing) return;

    let targetPrice = pricing.regionalAverage;
    if (preset === 'CHEAP') targetPrice = pricing.regionalAverage * 0.95;
    else if (preset === 'HIGH_MARGIN') targetPrice = pricing.regionalAverage * 1.06;

    setFuelPrice(fuelType, targetPrice, preset);
  };

  const adjustPrice = (fuelType: FuelType, delta: number) => {
    const pricing = gameState.pricing[fuelType];
    if (!pricing) return;
    const newPrice = Math.max(10, pricing.playerPrice + delta);
    setFuelPrice(fuelType, newPrice, 'CUSTOM');
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-b from-slate-800 to-slate-800/60 px-6 py-4 border-b-2 border-slate-700 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge !rounded-2xl w-10 h-10 !bg-purple-500/20 border border-purple-500/30 text-purple-400 flex items-center justify-center">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">Piyasa & Satış</div>
              <div className="text-base font-extrabold text-white">Akaryakıt Fiyatlandırma Yönetimi</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn w-8 h-8 rounded-xl bg-slate-700 border-2 border-slate-600 hover:bg-slate-600 text-slate-200 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Pricing Cards */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[75vh]">
          {(['gasoline', 'diesel', 'lpg'] as FuelType[]).map((fType) => {
            const conf = GAME_CONFIG.fuels[fType];
            const pricing = gameState.pricing[fType];
            const tank = gameState.tanks[fType];
            const isUnlocked = tank && tank.capacity > 0;

            const margin = pricing.playerPrice - pricing.todayWholesaleCost;
            const attr = calculatePriceAttractiveness(pricing.playerPrice, pricing.regionalAverage);
            const isLoss = pricing.playerPrice < pricing.todayWholesaleCost;

            return (
              <div
                key={fType}
                className={`bg-slate-950/60 border rounded-2xl p-4 flex flex-col gap-3 transition-all ${
                  !isUnlocked
                    ? 'border-slate-800 opacity-50'
                    : isLoss
                    ? 'border-red-500/50 bg-red-950/10'
                    : 'border-slate-800 hover:border-purple-500/40'
                }`}
              >
                <div className="flex justify-between items-center border-b border-slate-800/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: conf.color }} />
                    <span className="font-extrabold text-sm text-white">{conf.name}</span>
                  </div>
                  <div className="text-xs font-mono text-slate-400">
                    Bölgesel Ortalama: <span className="text-white font-bold">{pricing.regionalAverage.toFixed(2)} TL</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {/* Wholesale Cost */}
                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 text-center">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Alış Maliyeti</div>
                    <div className="text-sm font-black font-mono text-amber-400 mt-0.5">
                      ₺{pricing.todayWholesaleCost.toFixed(2)}
                    </div>
                  </div>

                  {/* Player Price & Steppers */}
                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 flex flex-col items-center justify-between">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Satış Fiyatınız</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <button
                        onClick={() => adjustPrice(fType, -0.10)}
                        disabled={!isUnlocked}
                        className="w-6 h-6 rounded-lg game-btn bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
                      >
                        -
                      </button>
                      <span className="text-sm font-black font-mono text-emerald-400">
                        ₺{pricing.playerPrice.toFixed(2)}
                      </span>
                      <button
                        onClick={() => adjustPrice(fType, 0.10)}
                        disabled={!isUnlocked}
                        className="w-6 h-6 rounded-lg game-btn bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Profit Margin */}
                  <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800 text-center">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Litre Başı Marj</div>
                    <div
                      className={`text-sm font-black font-mono mt-0.5 ${
                        margin > 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {margin > 0 ? `+₺${margin.toFixed(2)}` : `₺${margin.toFixed(2)}`}
                    </div>
                  </div>
                </div>

                {/* Preset Strategy Buttons */}
                {isUnlocked && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
                      {attr.trafficModifierPercent >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                      )}
                      <span>
                        Talep: {attr.trafficModifierPercent > 0 ? `+${attr.trafficModifierPercent}%` : `${attr.trafficModifierPercent}%`}
                      </span>
                    </div>

                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleApplyPreset(fType, 'CHEAP')}
                        className="px-2.5 py-1 rounded-lg game-btn bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-sky-400"
                      >
                        Ucuz
                      </button>
                      <button
                        onClick={() => handleApplyPreset(fType, 'BALANCED')}
                        className="px-2.5 py-1 rounded-lg game-btn bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-emerald-400"
                      >
                        Dengeli
                      </button>
                      <button
                        onClick={() => handleApplyPreset(fType, 'HIGH_MARGIN')}
                        className="px-2.5 py-1 rounded-lg game-btn bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-purple-400"
                      >
                        Yüksek Marj
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
