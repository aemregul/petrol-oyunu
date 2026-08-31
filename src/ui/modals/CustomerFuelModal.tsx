import React, { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { FuelType } from '../../domain/types/gameState';
import { X, Sparkles } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

const PRESETS = [250, 400, 600, 800, 1000, 1250, 1600, 2000];

const FUEL_ORDER: FuelType[] = ['gasoline', 'diesel', 'lpg'];

/** The nozzle buttons wear their fuel's colour, muted until picked. */
const FUEL_TONES: Record<FuelType, { on: string; off: string }> = {
  gasoline: {
    on: 'bg-emerald-500 text-white ring-2 ring-emerald-300 shadow-lg shadow-emerald-500/30',
    off: 'bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60 border border-emerald-700/50'
  },
  diesel: {
    on: 'bg-orange-500 text-white ring-2 ring-orange-300 shadow-lg shadow-orange-500/30',
    off: 'bg-orange-900/50 text-orange-300 hover:bg-orange-800/60 border border-orange-700/50'
  },
  lpg: {
    on: 'bg-blue-500 text-white ring-2 ring-blue-300 shadow-lg shadow-blue-500/30',
    off: 'bg-blue-900/50 text-blue-300 hover:bg-blue-800/60 border border-blue-700/50'
  }
};

const FUEL_CHIP: Record<FuelType, string> = {
  gasoline: 'bg-emerald-500',
  diesel: 'bg-orange-500',
  lpg: 'bg-blue-500'
};

/** A licence plate the car can wear, derived from its id so it never changes. */
function plateFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 999983;
  const city = (h % 80) + 1;
  const letters =
    String.fromCharCode(65 + (h % 23)) + String.fromCharCode(65 + (Math.floor(h / 23) % 23));
  const num = 100 + (h % 900);
  return `${String(city).padStart(2, '0')} ${letters} ${num}`;
}

/**
 * The fuelling window: pick the customer's nozzle, give an amount or FULLE,
 * watch the meter run, hand over. The nozzle has to match what they asked
 * for — a station that pours petrol into a diesel engine does not get paid.
 */
export const CustomerFuelModal: React.FC = () => {
  const selectedVehicleId = useGameStore((s) => s.selectedVehicleId);
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const startVehicleFueling = useGameStore((s) => s.startVehicleFueling);
  const dispenseFuelStep = useGameStore((s) => s.dispenseFuelStep);
  const completeVehicleFueling = useGameStore((s) => s.completeVehicleFueling);
  const cleanVehicleWindows = useGameStore((s) => s.cleanVehicleWindows);
  const dismissCustomer = useGameStore((s) => s.dismissCustomer);

  const vehicle = selectedVehicleId ? gameState.vehicles[selectedVehicleId] : null;

  const [chosenFuel, setChosenFuel] = useState<FuelType | null>(null);
  const [amountText, setAmountText] = useState('');
  const runIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isFueling = vehicle?.state === 'FUELING';
  const isFinished = !!vehicle && (vehicle.request.isFinished || vehicle.state === 'PAYMENT');

  // Once the trigger is squeezed the meter runs by itself, the way a real
  // dispenser latches — the old hold-to-pour felt like arm day at the gym.
  useEffect(() => {
    if (isFueling && vehicle && !vehicle.request.isFinished) {
      runIntervalRef.current = setInterval(() => {
        const finished = dispenseFuelStep(vehicle.id, 0.05);
        if (finished && runIntervalRef.current) clearInterval(runIntervalRef.current);
      }, 50);
    }
    return () => {
      if (runIntervalRef.current) clearInterval(runIntervalRef.current);
    };
  }, [isFueling, vehicle?.request.isFinished, vehicle?.id, dispenseFuelStep]);

  if (!vehicle) return null;

  const pricing = gameState.pricing[vehicle.fuelType];
  const unitPrice = pricing.playerPrice;
  const demandLiters = vehicle.request.calculatedLiters || vehicle.request.targetValue || 30;
  const requestPrice = Math.round(demandLiters * unitPrice);
  const dispensed = vehicle.request.dispensedLiters || 0;
  const runningTotal = dispensed * unitPrice;
  const conf = GAME_CONFIG.customerTypes[vehicle.archetype];
  const fuelConf = GAME_CONFIG.fuels[vehicle.fuelType];

  const pump = vehicle.targetPumpId ? gameState.pumps[vehicle.targetPumpId] : null;
  const nozzles = pump?.supportedFuels ?? FUEL_ORDER;
  const rightFuelChosen = chosenFuel === vehicle.fuelType;
  const amount = parseInt(amountText, 10);

  const start = (mode: 'MONEY' | 'FULL', value: number) => {
    if (!rightFuelChosen) return;
    sounds.playClick();
    startVehicleFueling(vehicle.id, mode, value);
  };

  const hint = !chosenFuel
    ? 'Tabanca seç; tutar gir ya da FULLE'
    : !rightFuelChosen
      ? `Müşteri ${fuelConf.shortName} istiyor — doğru tabancayı seç`
      : isFueling
        ? 'Yakıt akıyor...'
        : isFinished
          ? 'Dolum tamam — teslim et'
          : 'Tutar gir ya da bir tuşa bas';

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-sm shadow-2xl text-slate-100 flex flex-col overflow-hidden">
        {/* Header: who is at the pump */}
        <div className="px-5 pt-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-slate-950 border border-slate-700 text-white text-[11px] font-black font-mono px-2 py-0.5 rounded-md tracking-wider">
                {plateFor(vehicle.id)}
              </span>
              <span className="text-xs font-bold text-slate-400">{conf?.name ?? vehicle.archetype}</span>
            </div>
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-widest mt-2.5">
              Müşteri İsteği
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`${FUEL_CHIP[vehicle.fuelType]} text-white text-[11px] font-black px-2.5 py-1 rounded-lg`}
              >
                {fuelConf.shortName}
              </span>
              <span className="text-lg font-black text-white font-mono">
                ₺{requestPrice.toLocaleString('tr-TR')}
              </span>
              <span className="text-xs text-slate-400 font-mono">{demandLiters.toFixed(1)} L</span>
            </div>
          </div>
          <button
            onClick={() => {
              sounds.playClick();
              setActiveModal('NONE');
            }}
            className="w-7 h-7 rounded-lg game-btn bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 pt-4 flex flex-col gap-3">
          {/* Nozzles */}
          <div className="grid grid-cols-3 gap-2">
            {FUEL_ORDER.map((f) => {
              const fitted = nozzles.includes(f);
              const tone = FUEL_TONES[f];
              return (
                <button
                  key={f}
                  disabled={!fitted || isFueling || isFinished}
                  onClick={() => {
                    sounds.playClick();
                    setChosenFuel(f);
                  }}
                  className={`py-2.5 rounded-xl font-black text-xs transition-all ${
                    !fitted
                      ? 'bg-slate-800/60 text-slate-600 cursor-not-allowed'
                      : chosenFuel === f
                        ? tone.on
                        : tone.off
                  }`}
                >
                  {GAME_CONFIG.fuels[f].shortName}
                  {!fitted && <div className="text-[9px] font-bold">tabanca yok</div>}
                </button>
              );
            })}
          </div>

          {/* Amount presets */}
          {!isFueling && !isFinished && (
            <>
              <div className="grid grid-cols-4 gap-1.5">
                {PRESETS.map((v) => (
                  <button
                    key={v}
                    disabled={!rightFuelChosen}
                    onClick={() => start('MONEY', v)}
                    className={`py-2 rounded-lg font-bold text-[11px] font-mono transition-all ${
                      rightFuelChosen
                        ? 'bg-slate-950 hover:bg-slate-800 text-white border border-slate-700'
                        : 'bg-slate-950/50 text-slate-600 border border-slate-800 cursor-not-allowed'
                    }`}
                  >
                    ₺{v.toLocaleString('tr-TR')}
                  </button>
                ))}
              </div>

              {/* Custom amount + start / full */}
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min={10}
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  placeholder="₺ tutar gir"
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-mono font-bold text-white placeholder:text-slate-600 focus:outline-none focus:border-slate-500"
                />
                <button
                  disabled={!rightFuelChosen || !(amount > 0)}
                  onClick={() => start('MONEY', amount)}
                  className={`px-4 rounded-xl font-black text-xs transition-all ${
                    rightFuelChosen && amount > 0
                      ? 'game-btn bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 border-2 border-emerald-300/60 text-white shadow-lg'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  BAŞLAT
                </button>
                <button
                  disabled={!rightFuelChosen}
                  onClick={() => start('FULL', demandLiters)}
                  className={`px-4 rounded-xl font-black text-xs transition-all ${
                    rightFuelChosen
                      ? 'game-btn bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 border-2 border-red-300/60 text-white shadow-lg'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  FULLE
                </button>
              </div>
            </>
          )}

          {/* The meter */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 grid grid-cols-2 divide-x divide-slate-800">
            <div className="pr-3">
              <div className="text-[9px] uppercase font-black text-emerald-500/70 tracking-[0.2em]">
                Litre
              </div>
              <div className="text-3xl font-black font-mono text-emerald-400 leading-tight">
                {dispensed.toFixed(1)}
              </div>
            </div>
            <div className="pl-4 text-right">
              <div className="text-[9px] uppercase font-black text-amber-500/70 tracking-[0.2em]">
                Tutar ₺
              </div>
              <div className="text-3xl font-black font-mono text-amber-400 leading-tight">
                {Math.round(runningTotal).toLocaleString('tr-TR')}
              </div>
            </div>
          </div>

          <div className="text-center text-[11px] text-slate-500 font-bold">{hint}</div>

          {/* Squeegee */}
          <button
            disabled={!!vehicle.windowsCleaned}
            onClick={() => cleanVehicleWindows(vehicle.id)}
            className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
              vehicle.windowsCleaned
                ? 'bg-slate-800/60 text-emerald-400 cursor-default'
                : 'game-btn bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{vehicle.windowsCleaned ? 'Camlar Temiz ✓' : 'Camları Temizle'}</span>
          </button>

          {/* Hand over / send off */}
          {isFinished ? (
            <button
              onClick={() => completeVehicleFueling(vehicle.id)}
              className="w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-wider game-btn bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 border-2 border-red-300/60 text-white shadow-xl shadow-red-600/30 transition-all"
            >
              Teslim Et — ₺{Math.round(runningTotal).toLocaleString('tr-TR')}
            </button>
          ) : (
            <button
              onClick={() => dismissCustomer(vehicle.id)}
              className="w-full py-2.5 rounded-xl font-bold text-xs game-btn bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
            >
              Müşteriyi Gönder
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
