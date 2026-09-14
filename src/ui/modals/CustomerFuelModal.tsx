import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { FuelType } from '../../domain/types/gameState';
import { X, Sparkles, Minus, Plus, Wrench } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import {
  REQUEST_LIRA_STEP,
  MISFUEL_REPAIR_FEE,
  MISFUEL_REPAIR_SECONDS
} from '../../domain/services/simulationEngine';

const PRESETS = [250, 400, 600, 800, 1000, 1250, 1600, 2000];

/**
 * The −/+ buttons and the arrow keys move the sum by the step drivers ask in,
 * so a preset plus a few taps reaches any request without a keyboard.
 */
const AMOUNT_STEP = REQUEST_LIRA_STEP;

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

/**
 * The fuelling window: pick the customer's nozzle, enter the sum they named
 * and BAŞLAT, or FULLE if they asked for a full tank. Starting latches the
 * nozzle and closes the window; the simulation keeps pouring while the player
 * is elsewhere, and this window can be reopened to watch or hand over.
 *
 * Every nozzle can be picked, and reading which one the driver wants is the
 * player's job (Emre, 2026-09-14): the wrong one breaks the car down at the
 * pump, and the window then offers the repair. The box opens empty: reading
 * the driver's sum and entering it is the player's job too (Emre, 2026-09-12).
 * Pour short and the driver pays for what went in; pour over and they pay only
 * what they asked. Either way they leave unhappy. FULLE is only live for a
 * driver who asked for it.
 */
export const CustomerFuelModal: React.FC = () => {
  const selectedVehicleId = useGameStore((s) => s.selectedVehicleId);
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const startVehicleFueling = useGameStore((s) => s.startVehicleFueling);
  const completeVehicleFueling = useGameStore((s) => s.completeVehicleFueling);
  const repairBrokenVehicle = useGameStore((s) => s.repairBrokenVehicle);
  const cleanVehicleWindows = useGameStore((s) => s.cleanVehicleWindows);
  const dismissCustomer = useGameStore((s) => s.dismissCustomer);

  const vehicle = selectedVehicleId ? gameState.vehicles[selectedVehicleId] : null;

  const [chosenFuel, setChosenFuel] = useState<FuelType | null>(null);
  const [amountText, setAmountText] = useState('');

  // A different car at the window starts from an empty box again.
  useEffect(() => {
    setAmountText('');
    setChosenFuel(null);
  }, [vehicle?.id]);

  const isFueling = vehicle?.state === 'FUELING';
  const isFinished = !!vehicle && (vehicle.request.isFinished || vehicle.state === 'PAYMENT');
  const breakdown = vehicle?.state === 'BROKEN_DOWN' ? vehicle.breakdown : undefined;

  if (!vehicle) return null;

  const pricing = gameState.pricing[vehicle.fuelType];
  const unitPrice = pricing.playerPrice;
  // What the driver asked for at the window, kept apart from what is being
  // poured: once a pour starts, the request holds the player's own sum.
  const ask = vehicle.request.asked ?? {
    mode: vehicle.request.mode,
    targetValue: vehicle.request.targetValue,
    liters: vehicle.request.calculatedLiters
  };
  const wantsFull = ask.mode === 'FULL';
  const demandLiters = ask.liters || ask.targetValue || 30;
  // Whole lira, always: the sum the driver named, or a full tank's worth.
  const requestPrice = wantsFull ? Math.round(demandLiters * unitPrice) : ask.targetValue;
  const dispensed = vehicle.request.dispensedLiters || 0;
  const runningTotal = dispensed * unitPrice;
  const conf = GAME_CONFIG.customerTypes[vehicle.archetype];
  const fuelConf = GAME_CONFIG.fuels[vehicle.fuelType];

  const nozzleChosen = chosenFuel !== null;
  const amount = parseInt(amountText, 10);
  const canStart = nozzleChosen && amount > 0;
  const canFill = nozzleChosen && wantsFull;

  const start = (mode: 'MONEY' | 'FULL', value: number) => {
    if (!chosenFuel) return;
    sounds.playClick();
    startVehicleFueling(vehicle.id, mode, value, chosenFuel);
  };

  // Steps land on the grid: 1.827 goes up to 1.850 and down to 1.800.
  const nudge = (dir: 1 | -1) => {
    if (!nozzleChosen) return;
    const base = amount > 0 ? amount : 0;
    const next =
      dir > 0
        ? Math.floor(base / AMOUNT_STEP) * AMOUNT_STEP + AMOUNT_STEP
        : Math.ceil(base / AMOUNT_STEP) * AMOUNT_STEP - AMOUNT_STEP;
    sounds.playClick();
    setAmountText(next > 0 ? String(next) : '');
  };
  const canStepDown = nozzleChosen && amount > 0;

  const askedSum = `₺${requestPrice.toLocaleString('tr-TR')}`;
  // A sum typed off the ask is allowed — it costs — and the line says what it will cost.
  const typedOff = nozzleChosen && !isFueling && !isFinished && !wantsFull && amount > 0 && amount !== requestPrice;
  // The hint never names the right nozzle: the request above does.
  const hint = !chosenFuel
    ? wantsFull
      ? 'Tabanca seç, sonra FULLE'
      : 'Tabanca seç, tutarı yaz, sonra BAŞLAT'
    : isFueling
      ? 'Yakıt akıyor...'
      : isFinished
        ? 'Dolum tamam — teslim et'
        : wantsFull
          ? 'Müşteri depo istiyor — FULLE'
          : !(amount > 0)
            ? `Müşteri ${askedSum} istiyor — tutarı yaz, sonra BAŞLAT`
            : amount > requestPrice
              ? `Müşteri ${askedSum} istiyor — fazlasını ödemez, mutsuz ayrılır`
              : amount < requestPrice
                ? `Müşteri ${askedSum} istiyor — eksik kalırsa mutsuz ayrılır`
                : `Müşteri ${askedSum} istiyor — BAŞLAT`;

  const repairLeft = breakdown ? Math.max(0, Math.ceil(breakdown.repairSecondsLeft)) : 0;

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
        <div className="px-5 pt-4" data-tour="fuel-request">
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

        {breakdown ? (
          /* The wrong fuel went in: the car stands broken down in the bay. */
          <div className="p-5 pt-4 flex flex-col gap-3">
            <div className="bg-board border-2 border-kred rounded-md px-4 py-3 flex flex-col gap-1">
              <div className="font-display text-lg text-kred tracking-wide">💥 Motor Arızalandı</div>
              <p className="text-xs text-ink font-semibold leading-snug">
                {fuelConf.shortName} isteyen araca {GAME_CONFIG.fuels[breakdown.nozzle].shortName} koydun. Araç
                pompada kaldı; tamir bitene kadar pompa kilitli.
              </p>
            </div>

            {breakdown.repairPaid ? (
              <div className="bg-board border-2 border-ink rounded-md px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center justify-between font-display text-sm text-ink">
                  <span className="flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5" />
                    Tamirde
                  </span>
                  <span className="tabular-nums">{repairLeft} sn</span>
                </div>
                <div className="h-2 bg-paper border border-ink rounded-full overflow-hidden">
                  <div
                    className="h-full bg-kgrn transition-all duration-300"
                    style={{ width: `${(1 - repairLeft / MISFUEL_REPAIR_SECONDS) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                data-tour="fuel-repair"
                onClick={() => repairBrokenVehicle(vehicle.id)}
                className="w-full py-3.5 font-display text-base tracking-wide game-btn bg-kred hover:bg-kred-dark text-white flex items-center justify-center gap-2"
              >
                <Wrench className="w-4 h-4" />
                <span>Aracı Tamir Et — ₺{MISFUEL_REPAIR_FEE.toLocaleString('tr-TR')}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="p-5 pt-4 flex flex-col gap-3">
            {/* Nozzles: all of them, always. Which one is the player's call. */}
            <div className="grid grid-cols-3 gap-2">
              {FUEL_ORDER.map((f) => (
                <button
                  key={f}
                  data-tour={`fuel-nozzle-${f}`}
                  disabled={isFueling || isFinished}
                  onClick={() => {
                    sounds.playClick();
                    setChosenFuel(f);
                  }}
                  className={`py-2.5 px-2 text-center ${chosenFuel === f ? FUEL_TONES[f].on : FUEL_TONES[f].off}`}
                >
                  {GAME_CONFIG.fuels[f].shortName}
                </button>
              ))}
            </div>

            {/* Amount presets */}
            {!isFueling && !isFinished && (
              <div className="flex flex-col gap-3" data-tour="fuel-amount">
                {/* Presets put a sum in the box; BAŞLAT is what opens the tap. */}
                <div className="grid grid-cols-4 gap-1.5">
                  {PRESETS.map((v) => (
                    <button
                      key={v}
                      disabled={!nozzleChosen}
                      onClick={() => {
                        sounds.playClick();
                        setAmountText(String(v));
                      }}
                      className={`game-btn py-2 font-display text-[13px] tabular-nums ${
                        !nozzleChosen
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

                {/* The sum, stepped in ₺50 */}
                <div className="flex gap-1.5">
                  <button
                    aria-label={`${AMOUNT_STEP} ₺ azalt`}
                    disabled={!canStepDown}
                    onClick={() => nudge(-1)}
                    className={`game-btn px-3 font-display text-sm tabular-nums flex items-center gap-0.5 ${
                      canStepDown ? 'bg-card hover:bg-board text-ink' : 'bg-board text-mute'
                    }`}
                  >
                    <Minus className="w-3.5 h-3.5" />
                    {AMOUNT_STEP}
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={AMOUNT_STEP}
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                      e.preventDefault();
                      nudge(e.key === 'ArrowUp' ? 1 : -1);
                    }}
                    placeholder="₺ tutar gir"
                    className="flex-1 min-w-0 bg-board border-2 border-ink rounded-md px-3 py-2.5 text-center text-base font-mono font-bold text-ink placeholder:text-mute placeholder:text-sm focus:outline-none focus:bg-paper [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    aria-label={`${AMOUNT_STEP} ₺ artır`}
                    disabled={!nozzleChosen}
                    onClick={() => nudge(1)}
                    className={`game-btn px-3 font-display text-sm tabular-nums flex items-center gap-0.5 ${
                      nozzleChosen ? 'bg-card hover:bg-board text-ink' : 'bg-board text-mute'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {AMOUNT_STEP}
                  </button>
                </div>

                {/* Start / full */}
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    data-tour="fuel-start"
                    disabled={!canStart}
                    onClick={() => start('MONEY', amount)}
                    className={`game-btn py-2.5 font-display text-sm tracking-wide ${
                      canStart ? 'bg-kgrn hover:bg-kgrn-dark text-white' : 'bg-board text-mute'
                    }`}
                  >
                    BAŞLAT
                  </button>
                  <button
                    data-tour="fuel-full"
                    disabled={!canFill}
                    title={wantsFull ? undefined : 'Bu müşteri depo istemiyor'}
                    onClick={() => start('FULL', demandLiters)}
                    className={`game-btn py-2.5 font-display text-sm tracking-wide ${
                      canFill ? 'bg-kred hover:bg-kred-dark text-white' : 'bg-board text-mute'
                    }`}
                  >
                    FULLE
                  </button>
                </div>
              </div>
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

            <div className={`text-center text-[11px] font-bold ${typedOff ? 'text-kred' : 'text-mute'}`}>{hint}</div>

            {/* Squeegee */}
            <button
              data-tour="fuel-squeegee"
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
                data-tour="fuel-handover"
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
        )}
      </div>
    </div>
  );
};
