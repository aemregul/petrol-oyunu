import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { FuelType } from '../../domain/types/gameState';
import { X, Sparkles } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

const PRESETS = [250, 400, 600, 800, 1000, 1250, 1600, 2000];

const FUEL_ORDER: FuelType[] = ['gasoline', 'diesel', 'lpg'];

/** The nozzle buttons wear their fuel's colour, cardboard until picked. */
const FUEL_TONES: Record<FuelType, { on: string; off: string }> = {
  gasoline: {
    on: 'k-tab bg-kgrn text-white',
    off: 'k-tab hover:bg-board'
  },
  diesel: {
    on: 'k-tab bg-kyel-dark text-white',
    off: 'k-tab hover:bg-board'
  },
  lpg: {
    on: 'k-tab bg-kblu text-white',
    off: 'k-tab hover:bg-board'
  }
};

const FUEL_CHIP: Record<FuelType, string> = {
  gasoline: 'bg-kgrn text-white',
  diesel: 'bg-kyel-dark text-white',
  lpg: 'bg-kblu text-white'
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

/** The sum the driver named, ready to sit in the amount box; empty for FULL. */
function requestedText(vehicle: { request: { mode: string; targetValue: number } } | null): string {
  return vehicle && vehicle.request.mode === 'MONEY' ? String(vehicle.request.targetValue) : '';
}

/**
 * The fuelling window: pick the customer's nozzle, then BAŞLAT for the sum
 * they named or FULLE if they asked for a full tank. Starting latches the
 * nozzle and closes the window; the simulation keeps pouring while the player
 * is elsewhere, and this window can be reopened to watch or hand over.
 * The nozzle has to match what they asked for — a station that
 * pours petrol into a diesel engine does not get paid. The driver's sum is
 * already in the box when the window opens; FULLE is only live for a driver
 * who actually asked for it.
 */
export const CustomerFuelModal: React.FC = () => {
  const selectedVehicleId = useGameStore((s) => s.selectedVehicleId);
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const startVehicleFueling = useGameStore((s) => s.startVehicleFueling);
  const completeVehicleFueling = useGameStore((s) => s.completeVehicleFueling);
  const cleanVehicleWindows = useGameStore((s) => s.cleanVehicleWindows);
  const dismissCustomer = useGameStore((s) => s.dismissCustomer);

  const vehicle = selectedVehicleId ? gameState.vehicles[selectedVehicleId] : null;

  const [chosenFuel, setChosenFuel] = useState<FuelType | null>(null);
  const [amountText, setAmountText] = useState(() => requestedText(vehicle));

  // A different car at the window means a different request in the box.
  useEffect(() => {
    setAmountText(requestedText(vehicle));
    setChosenFuel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]);

  const isFueling = vehicle?.state === 'FUELING';
  const isFinished = !!vehicle && (vehicle.request.isFinished || vehicle.state === 'PAYMENT');

  if (!vehicle) return null;

  const pricing = gameState.pricing[vehicle.fuelType];
  const unitPrice = pricing.playerPrice;
  const wantsFull = vehicle.request.mode === 'FULL';
  const demandLiters = vehicle.request.calculatedLiters || vehicle.request.targetValue || 30;
  // Whole lira, always: the sum the driver named, or a full tank's worth.
  const requestPrice = wantsFull ? Math.round(demandLiters * unitPrice) : vehicle.request.targetValue;
  const dispensed = vehicle.request.dispensedLiters || 0;
  const runningTotal = dispensed * unitPrice;
  const conf = GAME_CONFIG.customerTypes[vehicle.archetype];
  const fuelConf = GAME_CONFIG.fuels[vehicle.fuelType];

  const pump = vehicle.targetPumpId ? gameState.pumps[vehicle.targetPumpId] : null;
  const nozzles = pump?.supportedFuels ?? FUEL_ORDER;
  const rightFuelChosen = chosenFuel === vehicle.fuelType;
  const amount = parseInt(amountText, 10);
  const canStart = rightFuelChosen && amount > 0;
  const canFill = rightFuelChosen && wantsFull;

  const start = (mode: 'MONEY' | 'FULL', value: number) => {
    if (!rightFuelChosen) return;
    sounds.playClick();
    startVehicleFueling(vehicle.id, mode, value);
  };

  const hint = !chosenFuel
    ? wantsFull
      ? 'Tabanca seç, sonra FULLE'
      : 'Tabanca seç, sonra BAŞLAT'
    : !rightFuelChosen
      ? `Müşteri ${fuelConf.shortName} istiyor — doğru tabancayı seç`
      : isFueling
        ? 'Yakıt akıyor...'
        : isFinished
          ? 'Dolum tamam — teslim et'
          : wantsFull
            ? 'Müşteri depo istiyor — FULLE'
            : `Müşteri ₺${requestPrice.toLocaleString('tr-TR')} istiyor — BAŞLAT`;

  return (
    <div className="fixed inset-0 flex items-center justify-center md:justify-start p-4 md:pl-20 z-50 animate-fade-in select-none pointer-events-none">
      <div className="pointer-events-auto game-surface w-full max-w-sm flex flex-col overflow-hidden">
        {/* Header: who is at the pump */}
        <div className="k-head k-head-red">
          <div className="flex items-center gap-2 min-w-0">
            <span className="bg-paper border-2 border-ink text-ink text-[11px] font-black font-mono px-2 py-0.5 rounded-md tracking-wider">
              {plateFor(vehicle.id)}
            </span>
            <span className="font-display text-xl tracking-wide truncate">{conf?.name ?? vehicle.archetype}</span>
          </div>
          <button
            onClick={() => {
              sounds.playClick();
              setActiveModal('NONE');
            }}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* The request */}
        <div className="px-5 pt-4">
          <div className="k-label">Müşteri İsteği</div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`${FUEL_CHIP[vehicle.fuelType]} border-2 border-ink text-[11px] font-black px-2.5 py-1 rounded-md`}
            >
              {fuelConf.shortName}
            </span>
            {wantsFull ? (
              <>
                <span className="font-display text-xl text-ink tracking-wide">FULL DEPO</span>
                <span className="text-xs text-mute font-mono">{Math.round(demandLiters)} L</span>
              </>
            ) : (
              <span className="font-display text-xl text-ink tabular-nums">
                ₺{requestPrice.toLocaleString('tr-TR')}
              </span>
            )}
          </div>
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
                  className={`py-2.5 px-2 text-center ${
                    !fitted
                      ? 'k-tab bg-board text-mute opacity-60 cursor-not-allowed'
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
              {/* Presets put a sum in the box; BAŞLAT is what opens the tap. */}
              <div className="grid grid-cols-4 gap-1.5">
                {PRESETS.map((v) => (
                  <button
                    key={v}
                    disabled={!rightFuelChosen}
                    onClick={() => {
                      sounds.playClick();
                      setAmountText(String(v));
                    }}
                    className={`game-btn py-2 font-display text-[13px] tabular-nums ${
                      !rightFuelChosen
                        ? 'bg-board text-mute'
                        : amount === v
                          ? 'bg-kyel text-ink'
                          : 'bg-card hover:bg-board text-ink'
                    }`}
                  >
                    ₺{v.toLocaleString('tr-TR')}
                  </button>
                ))}
              </div>

              {/* The sum + start / full */}
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min={10}
                  step={1}
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="₺ tutar gir"
                  className="flex-1 min-w-0 bg-board border-2 border-ink rounded-md px-3 py-2.5 text-sm font-mono font-bold text-ink placeholder:text-mute focus:outline-none focus:bg-paper"
                />
                <button
                  disabled={!canStart}
                  onClick={() => start('MONEY', amount)}
                  className={`game-btn px-4 font-display text-sm tracking-wide ${
                    canStart ? 'bg-kgrn hover:bg-kgrn-dark text-white' : 'bg-board text-mute'
                  }`}
                >
                  BAŞLAT
                </button>
                <button
                  disabled={!canFill}
                  title={wantsFull ? undefined : 'Bu müşteri depo istemiyor'}
                  onClick={() => start('FULL', demandLiters)}
                  className={`game-btn px-4 font-display text-sm tracking-wide ${
                    canFill ? 'bg-kred hover:bg-kred-dark text-white' : 'bg-board text-mute'
                  }`}
                >
                  FULLE
                </button>
              </div>
            </>
          )}

          {/* The meter */}
          <div className="bg-board border-2 border-ink rounded-md px-4 py-3 grid grid-cols-2 divide-x-2 divide-ink">
            <div className="pr-3">
              <div className="k-label">Litre</div>
              <div className={`text-3xl font-display tabular-nums leading-tight ${isFueling ? 'text-kgrn' : 'text-ink'}`}>
                {dispensed.toFixed(1)}
              </div>
            </div>
            <div className="pl-4 text-right">
              <div className="k-label">Tutar ₺</div>
              <div className={`text-3xl font-display tabular-nums leading-tight ${isFueling ? 'text-kgrn' : 'text-ink'}`}>
                {Math.round(runningTotal).toLocaleString('tr-TR')}
              </div>
            </div>
          </div>

          <div className="text-center text-[11px] text-mute font-bold">{hint}</div>

          {/* Squeegee */}
          <button
            disabled={!!vehicle.windowsCleaned}
            onClick={() => cleanVehicleWindows(vehicle.id)}
            className={`w-full py-2.5 rounded-md font-display text-sm tracking-wide flex items-center justify-center gap-1.5 ${
              vehicle.windowsCleaned
                ? 'bg-board border-2 border-ink text-kgrn cursor-default'
                : 'game-btn bg-kblu hover:bg-kblu-dark text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{vehicle.windowsCleaned ? 'Camlar Temiz ✓' : 'Camları Temizle'}</span>
          </button>

          {/* Hand over / send off */}
          {isFinished ? (
            <button
              onClick={() => completeVehicleFueling(vehicle.id)}
              className="w-full py-3.5 font-display text-base uppercase tracking-wide game-btn bg-kgrn hover:bg-kgrn-dark text-white"
            >
              Teslim Et — ₺{Math.round(runningTotal).toLocaleString('tr-TR')}
            </button>
          ) : (
            <button
              onClick={() => dismissCustomer(vehicle.id)}
              className="w-full py-2.5 font-display text-sm tracking-wide game-btn bg-card hover:bg-board text-ink"
            >
              Müşteriyi Gönder
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
