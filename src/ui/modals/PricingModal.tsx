import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { FuelType } from '../../domain/types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
import { calculatePriceAttractiveness } from '../../domain/formulas/economy';
import { X, Tag, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

const TILE = 'bg-board p-2.5 rounded-md border-2 border-ink';
const PRESET = 'px-2.5 py-1 game-btn text-[11px] font-display tracking-wide';

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
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="k-head k-head-yel shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge w-9 h-9">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-black tracking-[0.12em] opacity-80 font-sans">Piyasa & Satış</div>
              <div className="font-display text-xl tracking-wide leading-tight">Akaryakıt Fiyatlandırma Yönetimi</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
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
                className={`bg-paper border-2 rounded-md p-4 flex flex-col gap-3 shadow-k transition-all ${
                  !isUnlocked
                    ? 'border-ink opacity-50'
                    : isLoss
                    ? 'border-kred'
                    : 'border-ink'
                }`}
              >
                <div className="flex justify-between items-center border-b-2 border-dotted border-mute/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border border-ink" style={{ backgroundColor: conf.color }} />
                    <span className="font-display text-base text-ink tracking-wide">{conf.name}</span>
                  </div>
                  <div className="text-xs font-bold text-mute">
                    Bölgesel Ortalama: <span className="text-ink font-display tabular-nums">{pricing.regionalAverage.toFixed(2)} TL</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {/* Wholesale Cost */}
                  <div className={`${TILE} text-center`}>
                    <div className="k-label">Alış Maliyeti</div>
                    <div className="text-sm font-black font-mono text-kyel-dark mt-0.5">
                      ₺{pricing.todayWholesaleCost.toFixed(2)}
                    </div>
                  </div>

                  {/* Player Price & Steppers */}
                  <div className={`${TILE} flex flex-col items-center justify-between`}>
                    <div className="k-label">Satış Fiyatınız</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <button
                        onClick={() => adjustPrice(fType, -0.10)}
                        disabled={!isUnlocked}
                        className="w-6 h-6 game-btn bg-card hover:bg-board text-ink font-display text-xs"
                      >
                        -
                      </button>
                      <span className="text-sm font-black font-mono text-kgrn">
                        ₺{pricing.playerPrice.toFixed(2)}
                      </span>
                      <button
                        onClick={() => adjustPrice(fType, 0.10)}
                        disabled={!isUnlocked}
                        className="w-6 h-6 game-btn bg-card hover:bg-board text-ink font-display text-xs"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Profit Margin */}
                  <div className={`${TILE} text-center`}>
                    <div className="k-label">Litre Başı Marj</div>
                    <div
                      className={`text-sm font-black font-mono mt-0.5 ${
                        margin > 0 ? 'text-kgrn' : 'text-kred'
                      }`}
                    >
                      {margin > 0 ? `+₺${margin.toFixed(2)}` : `₺${margin.toFixed(2)}`}
                    </div>
                  </div>
                </div>

                {/* Preset Strategy Buttons */}
                {isUnlocked && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-mute">
                      {attr.trafficModifierPercent >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5 text-kgrn" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 text-kred" />
                      )}
                      <span>
                        Talep: {attr.trafficModifierPercent > 0 ? `+${attr.trafficModifierPercent}%` : `${attr.trafficModifierPercent}%`}
                      </span>
                    </div>

                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleApplyPreset(fType, 'CHEAP')}
                        className={`${PRESET} bg-kblu hover:bg-kblu-dark text-white`}
                      >
                        Ucuz
                      </button>
                      <button
                        onClick={() => handleApplyPreset(fType, 'BALANCED')}
                        className={`${PRESET} bg-kgrn hover:bg-kgrn-dark text-white`}
                      >
                        Dengeli
                      </button>
                      <button
                        onClick={() => handleApplyPreset(fType, 'HIGH_MARGIN')}
                        className={`${PRESET} bg-kvio hover:bg-kvio-dark text-white`}
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
