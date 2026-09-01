import { TONE_BUTTON } from './gameStyle';
import React from 'react';
import { useGameStore } from '../store/gameStore';
import { GAME_CONFIG, upgradePathFor } from '../config/gameConfig';
import { calculateRepairCost } from '../domain/formulas/economy';
import { Fuel, X, Trash2, Umbrella } from 'lucide-react';

const FUEL_TEXT: Record<string, string> = {
  gasoline: 'text-emerald-400',
  diesel: 'text-orange-400',
  lpg: 'text-blue-400'
};

const STATE_LABELS: Record<string, { text: string; className: string }> = {
  IDLE: { text: 'Boşta', className: 'text-emerald-400' },
  RESERVED: { text: 'Müşteri geliyor', className: 'text-sky-400' },
  FUELING: { text: 'Çalışıyor', className: 'text-emerald-400' },
  BROKEN: { text: 'ARIZALI', className: 'text-red-400' },
  MAINTENANCE: { text: 'Bakımda', className: 'text-amber-400' }
};

/**
 * The card that opens on a pump with no customer at it: what the pump is,
 * how it is doing, and everything money can do to it — repair, the speed
 * ladder, and the per-fuel nozzle modules. Fuels are bought here pump by
 * pump; the level ladder only ever buys speed.
 */
export const PumpPanel: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const selectedPumpId = useGameStore((s) => s.selectedPumpId);
  const activeModal = useGameStore((s) => s.activeModal);
  const buildMode = useGameStore((s) => s.buildMode);
  const selectPump = useGameStore((s) => s.selectPump);
  const upgradePump = useGameStore((s) => s.upgradePump);
  const repairPump = useGameStore((s) => s.repairPump);
  const addPumpFuel = useGameStore((s) => s.addPumpFuel);
  const sellStructure = useGameStore((s) => s.sellStructure);
  const structureValue = useGameStore((s) => s.structureValue);
  const fitCanopy = useGameStore((s) => s.fitCanopy);
  const removeCanopy = useGameStore((s) => s.removeCanopy);

  const pump = selectedPumpId ? gameState.pumps[selectedPumpId] : null;
  if (!pump || activeModal !== 'NONE' || buildMode.active) return null;

  const pumpNo = pump.id.replace(/\D+/g, '') || '1';
  const stateInfo = STATE_LABELS[pump.state] ?? { text: pump.state, className: 'text-slate-300' };
  const attendant = Object.values(gameState.employees).find((e) => e.assignedPumpId === pump.id);
  const upgrade = GAME_CONFIG.buildingUpgrades[upgradePathFor('pump_standard')]?.[pump.level + 1];
  const repairCost =
    pump.health < 100
      ? calculateRepairCost(GAME_CONFIG.buildings.pump_standard.price, pump.health)
      : null;

  // A roof for this island, bought and sold from the island it belongs to.
  const canopy = GAME_CONFIG.buildings.canopy;
  const canopyLocked = gameState.player.level < canopy.unlockLevel;

  const fuelNames = pump.supportedFuels
    .map((f) => GAME_CONFIG.fuels[f]?.shortName ?? f)
    .join(' ve ');

  const moduleRow = (fuel: 'diesel' | 'lpg') => {
    if (pump.supportedFuels.includes(fuel)) return null;
    const module = GAME_CONFIG.pumpFuelModules[fuel];
    const locked = gameState.player.level < module.minLevel;
    const conf = GAME_CONFIG.fuels[fuel];
    const tone = fuel === 'diesel' ? TONE_BUTTON.amber : TONE_BUTTON.blue;

    return (
      <button
        key={fuel}
        onClick={() => addPumpFuel(pump.id, fuel)}
        disabled={locked}
        className={`w-full py-2.5 rounded-xl font-extrabold text-xs transition-all ${
          locked
            ? 'bg-slate-800 border-2 border-slate-700 text-slate-500 cursor-not-allowed'
            : `game-btn ${tone}`
        }`}
      >
        {locked
          ? `${conf.shortName} Tabancası — Seviye ${module.minLevel}`
          : `+ ${conf.shortName} Tabancası — ₺${module.cost.toLocaleString('tr-TR')}`}
      </button>
    );
  };

  return (
    <div className="absolute left-4 top-20 w-80 pointer-events-auto animate-fade-in">
      <div className="game-surface !rounded-3xl overflow-hidden">
        {/* Header */}
        <div className="bg-red-950/70 border-b-2 border-red-500/30 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="game-icon-badge w-8 h-8 !bg-red-500/20 border-red-400/40">
              <Fuel className="w-4 h-4 text-white" />
            </div>
            <span className="game-title text-red-100 text-sm">Pompa #{pumpNo}</span>
          </div>
          <button
            onClick={() => selectPump(null)}
            className="w-7 h-7 rounded-lg bg-black/25 border border-white/25 hover:bg-black/40 text-white flex items-center justify-center transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 text-xs">
          <p className="text-slate-400 leading-relaxed">
            {fuelNames} dolumu. Müşterinin istediği yakıtı ve tutarı sen girersin.
          </p>

          {/* Info rows */}
          <div className="flex flex-col divide-y divide-slate-800 bg-slate-950/50 border border-slate-800 rounded-2xl px-3.5">
            <div className="flex justify-between py-2">
              <span className="text-slate-400 font-bold">Durum</span>
              <span className={`font-extrabold ${stateInfo.className}`}>{stateInfo.text}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-400 font-bold">Sağlık</span>
              <span
                className={`font-extrabold font-mono ${
                  pump.health > 60 ? 'text-white' : pump.health > 25 ? 'text-amber-400' : 'text-red-400'
                }`}
              >
                %{Math.round(pump.health)}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-400 font-bold">Dolum hızı</span>
              <span className="font-extrabold text-white font-mono">{pump.flowRateLps} L/sn</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-400 font-bold">Pompacı</span>
              <span className={`font-extrabold ${attendant ? 'text-emerald-400' : 'text-slate-500'}`}>
                {attendant ? attendant.name : '—'}
              </span>
            </div>
            {pump.supportedFuels.map((f) => (
              <div key={f} className="flex justify-between py-2">
                <span className={`font-bold ${FUEL_TEXT[f] ?? 'text-slate-400'}`}>
                  {GAME_CONFIG.fuels[f]?.shortName ?? f}
                </span>
                <span className="font-extrabold text-white font-mono">
                  ₺{gameState.pricing[f].playerPrice.toFixed(2)}/L
                </span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {repairCost !== null && (
              <button
                onClick={() => repairPump(pump.id)}
                className={`game-btn w-full py-2.5 rounded-xl font-extrabold text-xs ${TONE_BUTTON.red}`}
              >
                Onar — ₺{repairCost.toLocaleString('tr-TR')}
              </button>
            )}
            {upgrade && (
              <button
                onClick={() => upgradePump(pump.id)}
                title={upgrade.effectsDescription}
                className={`game-btn w-full py-2.5 rounded-xl font-extrabold text-xs ${TONE_BUTTON.green}`}
              >
                Pompa S{pump.level + 1} — ₺{upgrade.cost.toLocaleString('tr-TR')}
              </button>
            )}
            {moduleRow('diesel')}
            {moduleRow('lpg')}
            {pump.hasCanopy ? (
              <button
                onClick={() => removeCanopy(pump.id)}
                className={`game-btn w-full py-2.5 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 ${TONE_BUTTON.slate}`}
              >
                <Umbrella className="w-3.5 h-3.5" />
                <span>Sundurmayı Sök</span>
              </button>
            ) : (
              <button
                onClick={() => fitCanopy(pump.id)}
                disabled={canopyLocked}
                className={`w-full py-2.5 rounded-xl font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 ${
                  canopyLocked
                    ? 'bg-slate-800 border-2 border-slate-700 text-slate-500 cursor-not-allowed'
                    : `game-btn ${TONE_BUTTON.blue}`
                }`}
              >
                <Umbrella className="w-3.5 h-3.5" />
                <span>
                  {canopyLocked
                    ? `Sundurma — Seviye ${canopy.unlockLevel}`
                    : `+ Sundurma — ₺${canopy.price.toLocaleString('tr-TR')}`}
                </span>
              </button>
            )}
            <button
              onClick={() => sellStructure(pump.id)}
              className="game-btn w-full py-2.5 rounded-xl font-extrabold text-xs bg-slate-800 hover:bg-slate-700 text-amber-400 border-2 border-slate-700 flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Sat — ₺{structureValue(pump.id).toLocaleString('tr-TR')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
