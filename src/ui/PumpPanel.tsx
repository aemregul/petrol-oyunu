import React from 'react';
import { useGameStore } from '../store/gameStore';
import { GAME_CONFIG, upgradePathFor } from '../config/gameConfig';
import { calculateRepairCost } from '../domain/formulas/economy';
import { Fuel, X, Wrench, Umbrella } from 'lucide-react';
import { sounds } from '../audio/soundEffects';

const STATE_LABELS: Record<string, { text: string; className: string }> = {
  IDLE: { text: 'Boşta', className: 'text-emerald-400' },
  RESERVED: { text: 'Müşteri geliyor', className: 'text-sky-400' },
  FUELING: { text: 'Çalışıyor', className: 'text-emerald-400' },
  BROKEN: { text: 'ARIZALI', className: 'text-red-400' },
  MAINTENANCE: { text: 'Bakımda', className: 'text-amber-400' }
};

export const PumpPanel: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const selectedPumpId = useGameStore((s) => s.selectedPumpId);
  const activeModal = useGameStore((s) => s.activeModal);
  const buildMode = useGameStore((s) => s.buildMode);
  const selectPump = useGameStore((s) => s.selectPump);
  const upgradePump = useGameStore((s) => s.upgradePump);
  const repairPump = useGameStore((s) => s.repairPump);
  const rotatePump = useGameStore((s) => s.rotatePump);
  const relocateStructure = useGameStore((s) => s.relocateStructure);
  const hirePumpAttendant = useGameStore((s) => s.hirePumpAttendant);
  const fireAttendant = useGameStore((s) => s.fireAttendant);
  const addPumpFuel = useGameStore((s) => s.addPumpFuel);
  const fitCanopy = useGameStore((s) => s.fitCanopy);
  const removeCanopy = useGameStore((s) => s.removeCanopy);

  const pump = selectedPumpId ? gameState.pumps[selectedPumpId] : null;
  if (!pump || activeModal !== 'NONE' || buildMode.active) return null;

  const pumpNo = pump.id.replace(/\D+/g, '') || '1';
  const stateInfo = STATE_LABELS[pump.state] ?? { text: pump.state, className: 'text-slate-300' };

  // Check if an attendant is assigned to this specific pump
  const attendant = Object.values(gameState.employees).find(
    (e) => e.assignedPumpId === pump.id && e.role === 'PUMP_ATTENDANT'
  );

  const attendantConfig = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];
  const upgrade = GAME_CONFIG.buildingUpgrades[upgradePathFor('pump_standard')]?.[pump.level + 1];
  const repairCost =
    pump.health < 100
      ? calculateRepairCost(GAME_CONFIG.buildings.pump_standard.price, pump.health)
      : null;

  const canAffordHire = gameState.player.cash >= attendantConfig.hireCost;

  const handleClose = () => {
    sounds.playClick();
    selectPump(null);
  };

  const handleHireOrFire = () => {
    sounds.playClick();
    if (attendant) {
      fireAttendant(attendant.id);
    } else {
      hirePumpAttendant(pump.id);
    }
  };

  const handleUpgrade = () => {
    sounds.playClick();
    upgradePump(pump.id);
  };

  const handleRelocate = () => {
    sounds.playClick();
    relocateStructure(pump.id);
    selectPump(null);
  };

  const handleRotate = () => {
    sounds.playClick();
    rotatePump(pump.id);
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-40 flex items-center justify-center sm:justify-start sm:p-6 sm:left-4">
      <div className="w-[340px] pointer-events-auto select-none rounded-[2rem] overflow-hidden bg-[#161419] border border-white/10 shadow-2xl animate-fade-in flex flex-col">
        {/* Header Red Banner */}
        <div className="bg-[#d93f3f] px-5 py-3.5 flex items-center justify-between text-white shadow-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
              <Fuel className="w-4 h-4 text-white" />
            </div>
            <span className="font-extrabold text-base tracking-tight">Pompa #{pumpNo}</span>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-xl bg-black/20 hover:bg-black/40 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 flex flex-col gap-4 text-xs">
          {/* Subtitle description */}
          <p className="text-slate-300 text-[11px] leading-relaxed font-medium">
            Benzin ve dizel dolumu. Müşterinin istediği yakıtı ve tutarı sen girersin — yanlış tabanca cezalıdır.
          </p>

          {/* Stats Rows */}
          <div className="flex flex-col divide-y divide-white/5 text-xs">
            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">Durum</span>
              <span className={`font-extrabold ${stateInfo.className}`}>{stateInfo.text}</span>
            </div>

            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">Dolum hızı</span>
              <span className="font-extrabold text-white font-mono">{pump.flowRateLps.toFixed(1)} L/sn</span>
            </div>

            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">Pompacı</span>
              <span className={`font-extrabold uppercase ${attendant ? 'text-emerald-400' : 'text-slate-500'}`}>
                {attendant ? 'ÇALIŞIYOR (gelir senin)' : 'YOK'}
              </span>
            </div>

            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">Yovmiye</span>
              <span className={`font-extrabold font-mono ${attendant ? 'text-rose-300' : 'text-slate-500'}`}>
                ₺{attendant ? attendant.wage : attendantConfig.dailyWage}/gün
              </span>
            </div>

            {/* Fuel Prices */}
            {pump.supportedFuels.map((f) => {
              const conf = GAME_CONFIG.fuels[f];
              const price = gameState.pricing[f]?.playerPrice ?? 0;
              return (
                <div key={f} className="flex justify-between items-center py-1.5">
                  <span className="text-slate-300 font-semibold">{conf?.shortName ?? f}</span>
                  <span className="font-extrabold text-white font-mono">₺{price.toFixed(0)}/L</span>
                </div>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2.5 pt-1">
            {/* Repair button if damaged */}
            {repairCost !== null && (
              <button
                onClick={() => repairPump(pump.id)}
                className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-2xl font-extrabold text-xs transition-all shadow-md flex items-center justify-center gap-1.5"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Onar — ₺{repairCost.toLocaleString('tr-TR')}</span>
              </button>
            )}

            {/* Pompacı Button (İşten çıkar or İşe Al) */}
            {attendant ? (
              <button
                onClick={handleHireOrFire}
                className="w-full py-3.5 bg-[#d83f3f] hover:bg-[#c63232] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all shadow-lg"
              >
                Pompacıyı İşten çıkar
              </button>
            ) : (
              <button
                onClick={handleHireOrFire}
                disabled={!canAffordHire}
                className={`w-full py-3.5 rounded-2xl font-extrabold text-sm transition-all shadow-lg active:scale-98 ${
                  canAffordHire
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                    : 'bg-slate-800 text-slate-500 border border-white/5 cursor-not-allowed'
                }`}
              >
                Pompacı Al — ₺{attendantConfig.hireCost.toLocaleString('tr-TR')}
              </button>
            )}

            {/* Upgrade Pump Button */}
            {upgrade ? (
              <button
                onClick={handleUpgrade}
                className="w-full py-3.5 bg-[#27a85a] hover:bg-[#20924d] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all shadow-lg shadow-emerald-950/40"
              >
                Pompa #{pump.level + 1} — ₺{upgrade.cost.toLocaleString('tr-TR')}
              </button>
            ) : (
              <div className="w-full py-2.5 rounded-2xl bg-slate-800/60 border border-white/5 text-slate-500 text-center font-bold text-xs">
                Maksimum Seviye (S{pump.level})
              </div>
            )}

            {/* Taşı (Relocate) Button */}
            <button
              onClick={handleRelocate}
              className="w-full py-3.5 bg-[#252227] hover:bg-[#322d35] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all border border-white/5 shadow-md"
            >
              Taşı
            </button>

            {/* Döndür (Rotate) Button */}
            <button
              onClick={handleRotate}
              className="w-full py-3.5 bg-[#252227] hover:bg-[#322d35] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all border border-white/5 shadow-md"
            >
              Döndür
            </button>

            {/* Extra modules (if not installed yet) */}
            {!pump.supportedFuels.includes('diesel') && (
              <button
                onClick={() => addPumpFuel(pump.id, 'diesel')}
                className="w-full py-2.5 rounded-xl bg-orange-950/60 border border-orange-500/40 text-orange-300 font-bold text-xs hover:bg-orange-900/60 transition-all"
              >
                + Dizel Tabancası — ₺{GAME_CONFIG.pumpFuelModules.diesel.cost.toLocaleString('tr-TR')}
              </button>
            )}
            {!pump.supportedFuels.includes('lpg') && (
              <button
                onClick={() => addPumpFuel(pump.id, 'lpg')}
                className="w-full py-2.5 rounded-xl bg-blue-950/60 border border-blue-500/40 text-blue-300 font-bold text-xs hover:bg-blue-900/60 transition-all"
              >
                + LPG Tabancası — ₺{GAME_CONFIG.pumpFuelModules.lpg.cost.toLocaleString('tr-TR')}
              </button>
            )}

            {/* Canopy Toggle */}
            {pump.hasCanopy ? (
              <button
                onClick={() => removeCanopy(pump.id)}
                className="w-full py-2 rounded-xl text-slate-400 hover:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1 transition-all"
              >
                <Umbrella className="w-3.5 h-3.5" />
                <span>Sundurmayı Sök</span>
              </button>
            ) : (
              <button
                onClick={() => fitCanopy(pump.id)}
                className="w-full py-2 rounded-xl text-slate-400 hover:text-sky-300 text-xs font-semibold flex items-center justify-center gap-1 transition-all"
              >
                <Umbrella className="w-3.5 h-3.5" />
                <span>+ Sundurma Ekle</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
