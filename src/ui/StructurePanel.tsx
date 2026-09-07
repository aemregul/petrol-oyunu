import React from 'react';
import * as Icons from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { GAME_CONFIG, upgradePathFor } from '../config/gameConfig';
import { isFacility } from '../domain/services/facilities';
import { sounds } from '../audio/soundEffects';

/**
 * Structures that open something else on click rather than a card of their
 * own: the office and the price board are doors into the office, the pylon
 * is inert.
 */
const NO_CARD = ['office', 'price_sign', 'pylon_sign'];

/**
 * The card for every structure that has no card of its own: what it is,
 * what it costs to keep, what it is worth, and the levers on it. Replaces
 * the strip that used to hang under a clicked building (Emre, 2026-09-07),
 * in the same shape as the pump and facility cards.
 */
export const StructurePanel: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const selectedBuildingId = useGameStore((s) => s.selectedBuildingId);
  const activeModal = useGameStore((s) => s.activeModal);
  const buildMode = useGameStore((s) => s.buildMode);
  const selectBuilding = useGameStore((s) => s.selectBuilding);
  const upgradeBuilding = useGameStore((s) => s.upgradeBuilding);
  const relocateStructure = useGameStore((s) => s.relocateStructure);
  const rotateBuilding = useGameStore((s) => s.rotateBuilding);
  const sellStructure = useGameStore((s) => s.sellStructure);
  const structureValue = useGameStore((s) => s.structureValue);

  const building = selectedBuildingId ? gameState.buildings[selectedBuildingId] : null;
  if (!building || activeModal !== 'NONE' || buildMode.active) return null;
  if (isFacility(building.type) || NO_CARD.includes(building.type)) return null;

  const catalog = GAME_CONFIG.buildings[building.type];
  if (!catalog) return null;

  const IconComponent =
    (catalog.icon && (Icons as unknown as Record<string, React.ElementType>)[catalog.icon]) ||
    Icons.Building2;
  const upgrade = GAME_CONFIG.buildingUpgrades[upgradePathFor(building.type)]?.[building.level + 1];
  const canAffordUpgrade = !!upgrade && gameState.player.cash >= upgrade.cost;
  const fixed = !!catalog.fixed;
  const square = catalog.size[0] === catalog.size[1];
  const value = structureValue(building.id);

  const handleClose = () => {
    sounds.playClick();
    selectBuilding(null);
  };

  const dark =
    'w-full py-3.5 bg-[#252227] hover:bg-[#322d35] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all border border-white/5 shadow-md';

  return (
    <div className="fixed inset-0 pointer-events-none z-40 flex items-center justify-center p-4">
      <div className="w-[340px] max-h-[88vh] overflow-y-auto pointer-events-auto select-none rounded-[2rem] bg-[#161419] border border-white/10 shadow-2xl animate-fade-in flex flex-col">
        <div className="bg-[#2f5fa8] px-5 py-3.5 flex items-center justify-between text-white shadow-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
              <IconComponent className="w-4 h-4 text-white" />
            </div>
            <span className="font-extrabold text-base tracking-tight">
              {catalog.name}
              {upgrade || building.level > 1 ? ` Sv.${building.level}` : ''}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-xl bg-black/20 hover:bg-black/40 text-white flex items-center justify-center transition-colors"
            aria-label="Kapat"
          >
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 text-xs">
          <p className="text-slate-300 text-[11px] leading-relaxed font-medium">{catalog.description}</p>

          <div className="flex flex-col divide-y divide-white/5 text-xs">
            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">Günlük bakım</span>
              <span className="font-extrabold font-mono text-rose-300">
                ₺{catalog.dailyUpkeep.toLocaleString('tr-TR')}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">Durum</span>
              <span className={`font-extrabold font-mono ${building.health >= 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
                %{Math.round(building.health)}
              </span>
            </div>
            {!fixed && (
              <div className="flex justify-between items-center py-1.5">
                <span className="text-slate-400 font-semibold">Satış değeri</span>
                <span className="font-extrabold font-mono text-white">₺{value.toLocaleString('tr-TR')}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5 pt-1">
            {upgrade ? (
              <button
                onClick={() => upgradeBuilding(building.id)}
                title={upgrade.effectsDescription}
                className={`w-full py-3.5 rounded-2xl font-extrabold text-sm transition-all shadow-lg active:scale-98 ${
                  canAffordUpgrade
                    ? 'bg-[#27a85a] hover:bg-[#20924d] text-white shadow-emerald-950/40'
                    : 'bg-emerald-950/60 text-emerald-200/60 border border-emerald-500/20'
                }`}
              >
                Sv.{building.level + 1} Yükselt — ₺{upgrade.cost.toLocaleString('tr-TR')}
              </button>
            ) : (
              GAME_CONFIG.buildingUpgrades[upgradePathFor(building.type)] && (
                <div className="w-full py-2.5 rounded-2xl bg-slate-800/60 border border-white/5 text-slate-500 text-center font-bold text-xs">
                  Maksimum Seviye (Sv.{building.level})
                </div>
              )
            )}

            {!fixed && (
              <button
                onClick={() => {
                  sounds.playClick();
                  relocateStructure(building.id);
                }}
                className={dark}
              >
                Taşı
              </button>
            )}

            {!fixed && !square && (
              <button onClick={() => rotateBuilding(building.id)} className={dark}>
                Döndür
              </button>
            )}

            {!fixed && (
              <button
                onClick={() => sellStructure(building.id)}
                className="w-full py-3.5 bg-[#d83f3f] hover:bg-[#c63232] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all shadow-lg"
              >
                Yık — +₺{value.toLocaleString('tr-TR')}
              </button>
            )}

            {fixed && (
              <div className="w-full py-2.5 rounded-2xl bg-slate-800/60 border border-white/5 text-slate-500 text-center font-bold text-xs">
                İstasyonun sabit donanımı — taşınmaz, satılmaz
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
