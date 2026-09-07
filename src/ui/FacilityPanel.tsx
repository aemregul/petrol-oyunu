import React from 'react';
import { useGameStore } from '../store/gameStore';
import { GAME_CONFIG, upgradePathFor } from '../config/gameConfig';
import {
  facilityConfig,
  facilityTariff,
  nextTariffIndex,
  facilityMoralPoints,
  facilityRooms
} from '../domain/services/facilities';
import { Bath, ShoppingBag, Coffee, UtensilsCrossed, BedDouble, Building, X, Coins } from 'lucide-react';
import { sounds } from '../audio/soundEffects';

/** The face and colour each facility's card wears. */
const LOOK: Record<string, { icon: React.ElementType; banner: string; label: string }> = {
  toilet: { icon: Bath, banner: 'bg-[#d93f3f]', label: 'Tuvalet' },
  mini_market: { icon: ShoppingBag, banner: 'bg-[#d0021b]', label: 'Mini Market' },
  cafe: { icon: Coffee, banner: 'bg-[#0b6b45]', label: 'Kahveci' },
  restaurant: { icon: UtensilsCrossed, banner: 'bg-[#c2410c]', label: 'Restoran' },
  hotel: { icon: BedDouble, banner: 'bg-[#4f46e5]', label: 'Otel' },
  rest_complex: { icon: Building, banner: 'bg-[#0284c7]', label: 'Dinlenme Tesisi' }
};

/**
 * The card for a building people walk into: what it charges, what it took
 * today, what is waiting in the till — and the levers on it. Pumps have their
 * own card; the plain bar in the HUD serves everything else.
 */
export const FacilityPanel: React.FC = () => {
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
  const collectTill = useGameStore((s) => s.collectTill);
  const cycleFacilityTariff = useGameStore((s) => s.cycleFacilityTariff);

  const building = selectedBuildingId ? gameState.buildings[selectedBuildingId] : null;
  const conf = building ? facilityConfig(building.type) : null;
  if (!building || !conf || activeModal !== 'NONE' || buildMode.active) return null;

  const look = LOOK[building.type] ?? LOOK.rest_complex;
  const Icon = look.icon;
  const name = GAME_CONFIG.buildings[building.type]?.name ?? building.type;
  const upgrade = GAME_CONFIG.buildingUpgrades[upgradePathFor(building.type)]?.[building.level + 1];
  const till = Math.round(building.till ?? 0);
  const todayRevenue = Math.round(building.todayRevenue ?? 0);
  const todayVisits = building.todayVisits ?? 0;
  const moral = facilityMoralPoints(building);
  const tariff = facilityTariff(building);
  const nextIndex = nextTariffIndex(building);
  const nextTariff = nextIndex !== null ? conf.tariffs?.[nextIndex] : null;
  const rooms = facilityRooms(building);
  const guests = rooms
    ? Object.values(gameState.vehicles).filter(
        (v) =>
          v.visitBuildingId === building.id &&
          (v.state === 'VISITING' || v.state === 'TO_PARK' || v.state === 'OPTIONAL_SHOP')
      ).length
    : 0;
  const inside = Object.values(gameState.vehicles).filter(
    (v) => v.visitBuildingId === building.id && v.visitor?.phase === 'INSIDE'
  ).length;
  const sellValue = structureValue(building.id) + till;
  const canAffordUpgrade = !!upgrade && gameState.player.cash >= upgrade.cost;

  const handleClose = () => {
    sounds.playClick();
    selectBuilding(null);
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-40 flex items-center justify-center sm:justify-start sm:p-6 sm:left-4">
      <div className="w-[340px] pointer-events-auto select-none rounded-[2rem] overflow-hidden bg-[#161419] border border-white/10 shadow-2xl animate-fade-in flex flex-col">
        <div className={`${look.banner} px-5 py-3.5 flex items-center justify-between text-white shadow-md`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
              <Icon className="w-4 h-4 text-white" />
            </div>
            <span className="font-extrabold text-base tracking-tight">
              {look.label} Sv.{building.level}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-xl bg-black/20 hover:bg-black/40 text-white flex items-center justify-center transition-colors"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 text-xs">
          <p className="text-slate-300 text-[11px] leading-relaxed font-medium">{conf.blurb}</p>

          <div className="flex flex-col divide-y divide-white/5 text-xs">
            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">Moral etkisi</span>
              <span className={`font-extrabold font-mono ${moral > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                +{moral.toFixed(2)} puan
              </span>
            </div>

            {tariff && (
              <div className="flex justify-between items-center py-1.5">
                <span className="text-slate-400 font-semibold">
                  {building.type === 'hotel' ? 'Oda ücreti' : 'Kullanım ücreti'}
                </span>
                <span className={`font-extrabold font-mono ${tariff.price > 0 ? 'text-emerald-400' : 'text-white'}`}>
                  {tariff.price > 0 ? `${tariff.label} · ₺${tariff.price.toLocaleString('tr-TR')}` : tariff.label}
                </span>
              </div>
            )}

            {rooms > 0 && (
              <div className="flex justify-between items-center py-1.5">
                <span className="text-slate-400 font-semibold">Odalar</span>
                <span className={`font-extrabold font-mono ${guests >= rooms ? 'text-amber-400' : 'text-white'}`}>
                  {guests}/{rooms} dolu
                </span>
              </div>
            )}

            {building.type === 'mini_market' && (
              <div className="flex justify-between items-center py-1.5">
                <span className="text-slate-400 font-semibold">Raf stoğu</span>
                <span className="font-extrabold font-mono text-white">{gameState.market.stock}</span>
              </div>
            )}

            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">Bugünkü ciro</span>
              <span className="font-extrabold font-mono text-emerald-400">
                ₺{todayRevenue.toLocaleString('tr-TR')}
                {todayVisits > 0 && (
                  <span className="text-slate-500 font-semibold"> · {todayVisits} ziyaret</span>
                )}
              </span>
            </div>

            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-400 font-semibold">İçeride</span>
              <span className="font-extrabold font-mono text-white">
                {inside > 0 ? `${inside} kişi` : '—'}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 pt-1">
            {/* The money the place has taken sits in its till until it is
                fetched; this is the fetching. A manager does it on rounds. */}
            <button
              onClick={() => collectTill(building.id)}
              disabled={till <= 0}
              className={`w-full py-3.5 rounded-2xl font-extrabold text-sm transition-all shadow-lg flex items-center justify-center gap-2 ${
                till > 0
                  ? 'bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white shadow-emerald-900/30'
                  : 'bg-slate-800/60 text-slate-500 border border-white/5 cursor-not-allowed'
              }`}
            >
              <Coins className="w-4 h-4" />
              <span>{till > 0 ? `Kasayı Topla — ₺${till.toLocaleString('tr-TR')}` : 'Kasa boş'}</span>
            </button>

            {tariff && nextTariff && (
              <button
                onClick={() => cycleFacilityTariff(building.id)}
                className="w-full py-3.5 bg-[#d83f3f] hover:bg-[#c63232] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all shadow-lg"
              >
                Ücreti Değiştir ({tariff.label} → {nextTariff.label})
              </button>
            )}

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
                {look.label} Sv.{building.level + 1} — ₺{upgrade.cost.toLocaleString('tr-TR')}
              </button>
            ) : (
              <div className="w-full py-2.5 rounded-2xl bg-slate-800/60 border border-white/5 text-slate-500 text-center font-bold text-xs">
                Maksimum Seviye (Sv.{building.level})
              </div>
            )}

            <button
              onClick={() => {
                sounds.playClick();
                relocateStructure(building.id);
              }}
              className="w-full py-3.5 bg-[#252227] hover:bg-[#322d35] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all border border-white/5 shadow-md"
            >
              Taşı
            </button>

            <button
              onClick={() => rotateBuilding(building.id)}
              className="w-full py-3.5 bg-[#252227] hover:bg-[#322d35] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all border border-white/5 shadow-md"
            >
              Döndür
            </button>

            <button
              onClick={() => sellStructure(building.id)}
              className="w-full py-3.5 bg-[#d83f3f] hover:bg-[#c63232] active:scale-98 text-white rounded-2xl font-extrabold text-sm transition-all shadow-lg"
            >
              Yık — +₺{sellValue.toLocaleString('tr-TR')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Name shown for a facility type where only the short form fits. */
export function facilityShortName(type: string): string {
  return LOOK[type]?.label ?? GAME_CONFIG.buildings[type]?.name ?? type;
}
