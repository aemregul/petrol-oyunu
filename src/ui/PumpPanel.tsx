import React from 'react';
import { useGameStore } from '../store/gameStore';
import { GAME_CONFIG, upgradePathFor } from '../config/gameConfig';
import { calculateRepairCost } from '../domain/formulas/economy';
import { Fuel, X, Wrench, Umbrella, Sun } from 'lucide-react';
import { solarPrice, solarPeakKwhPerHour } from '../domain/services/energy';
import { sounds } from '../audio/soundEffects';

const STATE_LABELS: Record<string, { text: string; className: string }> = {
  IDLE: { text: 'Boşta', className: 'text-kgrn' },
  RESERVED: { text: 'Müşteri geliyor', className: 'text-kblu' },
  FUELING: { text: 'Çalışıyor', className: 'text-kgrn' },
  VEHICLE_ARRIVING: { text: 'Müşteri geliyor', className: 'text-kblu' },
  REQUEST_READY: { text: 'Müşteri bekliyor', className: 'text-kyel-dark' },
  // Held after the sale too: the driver may have walked off to the shop and
  // left the car standing in the bay.
  PAYMENT: { text: 'Dolu', className: 'text-kyel-dark' },
  BROKEN: { text: 'ARIZALI', className: 'text-kred' },
  MAINTENANCE: { text: 'Bakımda', className: 'text-kyel-dark' }
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
  const fitSolarCanopy = useGameStore((s) => s.fitSolarCanopy);
  const removeSolarCanopy = useGameStore((s) => s.removeSolarCanopy);

  const pump = selectedPumpId ? gameState.pumps[selectedPumpId] : null;
  if (!pump || activeModal !== 'NONE' || buildMode.active) return null;

  const pumpNo = pump.id.replace(/\D+/g, '') || '1';
  const stateInfo = STATE_LABELS[pump.state] ?? { text: pump.state, className: 'text-ink' };

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
    <div className="fixed inset-0 pointer-events-none z-40 flex items-center justify-center p-4">
      <div className="w-[340px] max-h-[88vh] overflow-y-auto pointer-events-auto select-none game-surface animate-fade-in flex flex-col">
        {/* Header Red Banner */}
        <div className="k-head k-head-red">
          <div className="flex items-center gap-2.5">
            <div className="game-icon-badge w-8 h-8">
              <Fuel className="w-4 h-4" />
            </div>
            <span>Pompa #{pumpNo}</span>
          </div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-8 h-8 rounded-md flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 flex flex-col gap-4 text-xs">
          {/* Subtitle description */}
          <p className="text-ink/80 text-[12px] leading-relaxed font-semibold">
            Benzin ve dizel dolumu. Müşterinin istediği yakıtı ve tutarı sen girersin — yanlış tabanca cezalıdır.
          </p>

          {/* Stats Rows */}
          <div className="flex flex-col text-xs">
            <div className="k-row">
              <span>Durum</span>
              <span className={stateInfo.className}>{stateInfo.text}</span>
            </div>

            <div className="k-row">
              <span>Dolum hızı</span>
              <span>{pump.flowRateLps.toFixed(1)} L/sn</span>
            </div>

            <div className="k-row">
              <span>Pompacı</span>
              <span className={`uppercase ${attendant ? 'text-kgrn' : 'text-mute'}`}>
                {attendant ? 'ÇALIŞIYOR (gelir senin)' : 'YOK'}
              </span>
            </div>

            <div className="k-row">
              <span>Yovmiye</span>
              <span className={attendant ? 'text-kred' : 'text-mute'}>
                ₺{attendant ? attendant.wage : attendantConfig.dailyWage}/gün
              </span>
            </div>

            {/* Fuel Prices */}
            {pump.supportedFuels.map((f) => {
              const conf = GAME_CONFIG.fuels[f];
              const price = gameState.pricing[f]?.playerPrice ?? 0;
              return (
                <div key={f} className="k-row">
                  <span>{conf?.shortName ?? f}</span>
                  <span>₺{price.toFixed(0)}/L</span>
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
                className="w-full py-3 game-btn bg-kyel hover:bg-kyel-dark text-ink font-display tracking-wide text-sm flex items-center justify-center gap-1.5"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Onar — ₺{repairCost.toLocaleString('tr-TR')}</span>
              </button>
            )}

            {/* Pompacı Button (İşten çıkar or İşe Al) */}
            {attendant ? (
              <button
                onClick={handleHireOrFire}
                className="w-full py-3.5 game-btn bg-kred hover:bg-kred-dark text-white font-display tracking-wide text-sm"
              >
                Pompacıyı İşten çıkar
              </button>
            ) : (
              <button
                onClick={handleHireOrFire}
                disabled={!canAffordHire}
                className="w-full py-3.5 game-btn bg-kgrn hover:bg-kgrn-dark text-white font-display tracking-wide text-sm"
              >
                Pompacı Al — ₺{attendantConfig.hireCost.toLocaleString('tr-TR')}
              </button>
            )}

            {/* Upgrade Pump Button */}
            {upgrade ? (
              <button
                onClick={handleUpgrade}
                className="w-full py-3.5 game-btn bg-kgrn hover:bg-kgrn-dark text-white font-display tracking-wide text-sm"
              >
                Pompa #{pump.level + 1} — ₺{upgrade.cost.toLocaleString('tr-TR')}
              </button>
            ) : (
              <div className="w-full py-2.5 rounded-md bg-board border-2 border-dashed border-mute text-mute text-center font-extrabold text-xs">
                Maksimum Seviye (S{pump.level})
              </div>
            )}

            {/* Taşı (Relocate) Button */}
            <button
              onClick={handleRelocate}
              className="w-full py-3.5 game-btn bg-card hover:bg-board text-ink font-display tracking-wide text-sm"
            >
              Taşı
            </button>

            {/* Döndür (Rotate) Button */}
            <button
              onClick={handleRotate}
              className="w-full py-3.5 game-btn bg-card hover:bg-board text-ink font-display tracking-wide text-sm"
            >
              Döndür
            </button>

            {/* Extra modules (if not installed yet) */}
            {!pump.supportedFuels.includes('diesel') && (
              <button
                onClick={() => addPumpFuel(pump.id, 'diesel')}
                className="w-full py-2.5 game-btn bg-kyel hover:bg-kyel-dark text-ink font-display tracking-wide text-sm"
              >
                + Dizel Tabancası — ₺{GAME_CONFIG.pumpFuelModules.diesel.cost.toLocaleString('tr-TR')}
              </button>
            )}
            {!pump.supportedFuels.includes('lpg') && (
              <button
                onClick={() => addPumpFuel(pump.id, 'lpg')}
                className="w-full py-2.5 game-btn bg-kblu hover:bg-kblu-dark text-white font-display tracking-wide text-sm"
              >
                + LPG Tabancası — ₺{GAME_CONFIG.pumpFuelModules.lpg.cost.toLocaleString('tr-TR')}
              </button>
            )}

            {/* Panels on the roof: the sun into the block's bank. */}
            {pump.hasCanopy && !pump.hasSolarCanopy && (
              <button
                onClick={() => fitSolarCanopy(pump.id)}
                className="w-full py-2.5 game-btn bg-kyel hover:bg-kyel-dark text-ink font-display tracking-wide text-sm flex items-center justify-center gap-1.5"
              >
                <Sun className="w-3.5 h-3.5" />
                <span>
                  Güneşli Sundurma — ₺{solarPrice(GAME_CONFIG.buildings.canopy.size).toLocaleString('tr-TR')}
                </span>
              </button>
            )}
            {pump.hasCanopy && pump.hasSolarCanopy && (
              <>
                <div className="w-full py-2 rounded-md bg-board border-2 border-ink text-ink text-[11px] font-extrabold flex items-center justify-center gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-kyel-dark" />
                  <span>Güneşli sundurma · öğlen {solarPeakKwhPerHour(GAME_CONFIG.buildings.canopy.size)} kWh/sa</span>
                </div>
                {/* The panels come off on their own; the roof stays. */}
                <button
                  onClick={() => removeSolarCanopy(pump.id)}
                  className="w-full py-2 text-mute hover:text-ink text-xs font-extrabold flex items-center justify-center gap-1 transition-colors"
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span>Panelleri Sök</span>
                </button>
              </>
            )}

            {/* Canopy Toggle */}
            {pump.hasCanopy ? (
              <button
                onClick={() => removeCanopy(pump.id)}
                className="w-full py-2 text-mute hover:text-ink text-xs font-extrabold flex items-center justify-center gap-1 transition-colors"
              >
                <Umbrella className="w-3.5 h-3.5" />
                <span>Sundurmayı Sök{pump.hasSolarCanopy ? ' (panellerle birlikte)' : ''}</span>
              </button>
            ) : (
              <button
                onClick={() => fitCanopy(pump.id)}
                className="w-full py-2 text-mute hover:text-ink text-xs font-extrabold flex items-center justify-center gap-1 transition-colors"
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
