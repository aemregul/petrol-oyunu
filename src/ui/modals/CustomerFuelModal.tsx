import React, { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { X, Fuel, Zap, CheckCircle2, AlertTriangle } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

export const CustomerFuelModal: React.FC = () => {
  const selectedVehicleId = useGameStore((s) => s.selectedVehicleId);
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const startVehicleFueling = useGameStore((s) => s.startVehicleFueling);
  const dispenseFuelStep = useGameStore((s) => s.dispenseFuelStep);
  const completeVehicleFueling = useGameStore((s) => s.completeVehicleFueling);

  const vehicle = selectedVehicleId ? gameState.vehicles[selectedVehicleId] : null;
  const pricing = vehicle ? gameState.pricing[vehicle.fuelType] : null;
  const tank = vehicle ? gameState.tanks[vehicle.fuelType] : null;

  const [isHolding, setIsHolding] = useState(false);
  const holdIntervalRef = useRef<any>(null);

  useEffect(() => {
    if (isHolding && vehicle && vehicle.state === 'FUELING' && !vehicle.request.isFinished) {
      holdIntervalRef.current = setInterval(() => {
        const finished = dispenseFuelStep(vehicle.id, 0.05);
        if (finished) {
          setIsHolding(false);
          clearInterval(holdIntervalRef.current);
        }
      }, 50);
    } else {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    }

    return () => {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    };
  }, [isHolding, vehicle?.state, vehicle?.request.isFinished, vehicle?.id]);

  if (!vehicle || !pricing || !tank) return null;

  const isFueling = vehicle.state === 'FUELING';
  const isFinished = vehicle.request.isFinished || vehicle.state === 'PAYMENT';
  const dispensedLiters = vehicle.request.dispensedLiters || 0;
  const targetLiters = vehicle.request.calculatedLiters || vehicle.request.targetValue || 30;
  const unitPrice = pricing.playerPrice;
  const currentTotalCost = dispensedLiters * unitPrice;
  const fillProgressPercent = Math.min(100, Math.max(0, (dispensedLiters / targetLiters) * 100));

  const handleSelectQuickAmount = (mode: 'LITERS' | 'MONEY' | 'FULL', val: number) => {
    sounds.playClick();
    startVehicleFueling(vehicle.id, mode, val);
  };

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  const handleComplete = () => {
    completeVehicleFueling(vehicle.id);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-100 flex flex-col">
        {/* Modal Header */}
        <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700/80 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <Fuel className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">Manuel Akaryakıt Dolumu</div>
              <div className="text-base font-extrabold text-white">
                {vehicle.archetype.toUpperCase()} • {vehicle.fuelType.toUpperCase()}
              </div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 flex flex-col gap-5">
          {/* Customer Request & Tank Stock Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3.5">
              <div className="text-[11px] font-bold text-slate-400 uppercase">Müşteri Talebi</div>
              <div className="text-xl font-extrabold text-sky-400 font-mono mt-0.5">
                {vehicle.request.targetValue} {vehicle.request.mode === 'MONEY' ? 'TL' : 'Litre'}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Litre Fiyatı: {unitPrice.toFixed(2)} TL</div>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3.5">
              <div className="text-[11px] font-bold text-slate-400 uppercase">Tank Mevcut Stoku</div>
              <div className="text-xl font-extrabold text-emerald-400 font-mono mt-0.5">
                {tank.stock.toFixed(0)} <span className="text-xs text-slate-400">/ {tank.capacity} L</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Rezerve: {tank.reservedStock.toFixed(0)} L</div>
            </div>
          </div>

          {/* Quick Selection Buttons (If not yet fueling) */}
          {!isFueling && !isFinished && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">Dolum Seçeneği</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleSelectQuickAmount('MONEY', 250)}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-2.5 rounded-xl text-xs transition-all"
                >
                  250 TL
                </button>
                <button
                  onClick={() => handleSelectQuickAmount('MONEY', 500)}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-2.5 rounded-xl text-xs transition-all"
                >
                  500 TL
                </button>
                <button
                  onClick={() => handleSelectQuickAmount('MONEY', 1000)}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-2.5 rounded-xl text-xs transition-all"
                >
                  1.000 TL
                </button>
                <button
                  onClick={() => handleSelectQuickAmount('LITERS', 20)}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-2.5 rounded-xl text-xs transition-all"
                >
                  20 Litre
                </button>
                <button
                  onClick={() => handleSelectQuickAmount('LITERS', 40)}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-2.5 rounded-xl text-xs transition-all"
                >
                  40 Litre
                </button>
                <button
                  onClick={() => handleSelectQuickAmount('FULL', 60)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold py-2.5 rounded-xl text-xs shadow-lg transition-all"
                >
                  FULLE (Tam Depo)
                </button>
              </div>
            </div>
          )}

          {/* Interactive Fuel Pump Gauge & Meter */}
          {(isFueling || isFinished) && (
            <div className="bg-slate-950/80 border-2 border-slate-800 rounded-3xl p-5 flex flex-col items-center gap-4">
              {/* Digital Meter Displays */}
              <div className="flex justify-between w-full border-b border-slate-800 pb-3 font-mono">
                <div className="text-center">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Verilen Yakıt</div>
                  <div className="text-3xl font-black text-emerald-400">
                    {dispensedLiters.toFixed(2)} <span className="text-sm text-slate-400">L</span>
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Tutar</div>
                  <div className="text-3xl font-black text-sky-400">
                    ₺{currentTotalCost.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Progress Bar Gauge */}
              <div className="w-full">
                <div className="flex justify-between text-xs font-bold text-slate-400 mb-1 font-mono">
                  <span>Dolum İlerlemesi</span>
                  <span>%{fillProgressPercent.toFixed(0)}</span>
                </div>
                <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                  <div
                    className={`h-full transition-all duration-100 ${
                      isFinished ? 'bg-emerald-400' : 'bg-gradient-to-r from-sky-500 to-emerald-500'
                    }`}
                    style={{ width: `${fillProgressPercent}%` }}
                  />
                </div>
              </div>

              {/* Hold-to-Fuel Button */}
              {!isFinished ? (
                <button
                  onMouseDown={() => setIsHolding(true)}
                  onMouseUp={() => setIsHolding(false)}
                  onMouseLeave={() => setIsHolding(false)}
                  onTouchStart={() => setIsHolding(true)}
                  onTouchEnd={() => setIsHolding(false)}
                  className={`w-full py-5 rounded-2xl font-black text-base uppercase tracking-wider transition-all shadow-2xl flex items-center justify-center gap-2 ${
                    isHolding
                      ? 'bg-emerald-500 text-slate-950 scale-95 shadow-emerald-500/50'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                  }`}
                >
                  <Zap className={`w-5 h-5 ${isHolding ? 'animate-spin' : ''}`} />
                  <span>{isHolding ? 'YAKIT AKIYOR...' : 'DOLUM İÇİN BASILI TUT'}</span>
                </button>
              ) : (
                <button
                  onClick={handleComplete}
                  className="w-full py-4 rounded-2xl font-black text-base uppercase tracking-wider bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-2xl shadow-emerald-500/40 flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
                >
                  <CheckCircle2 className="w-5 h-5 text-slate-950" />
                  <span>Ödemeyi Al & Gönder (₺{currentTotalCost.toFixed(2)})</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
