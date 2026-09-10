import React from 'react';
import { useGameStore, EDIT_MODE_LEVEL } from '../store/gameStore';
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
  toilet: { icon: Bath, banner: 'k-head-blu', label: 'Tuvalet' },
  mini_market: { icon: ShoppingBag, banner: 'k-head-blu', label: 'Mini Market' },
  cafe: { icon: Coffee, banner: 'k-head-blu', label: 'Kahveci' },
  restaurant: { icon: UtensilsCrossed, banner: 'k-head-blu', label: 'Restoran' },
  hotel: { icon: BedDouble, banner: 'k-head-blu', label: 'Otel' },
  rest_complex: { icon: Building, banner: 'k-head-blu', label: 'Dinlenme Tesisi' }
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
  // Rearranging is a late-game luxury; the panel says so rather than offering
  // a button that only warns (Emre, 2026-09-10).
  const canMove = gameState.player.level >= EDIT_MODE_LEVEL;
  const canAffordUpgrade = !!upgrade && gameState.player.cash >= upgrade.cost;

  const handleClose = () => {
    sounds.playClick();
    selectBuilding(null);
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-40 flex items-center justify-center p-4">
      <div className="w-[340px] max-h-[88vh] overflow-y-auto pointer-events-auto select-none game-surface animate-fade-in flex flex-col">
        <div className={`k-head ${look.banner}`}>
          <div className="flex items-center gap-2.5">
            <div className="game-icon-badge w-8 h-8">
              <Icon className="w-4 h-4" />
            </div>
            <span>
              {look.label} Sv.{building.level}
            </span>
          </div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-8 h-8 rounded-md flex items-center justify-center"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 text-xs">
          <p className="text-ink/80 text-[12px] leading-relaxed font-semibold">{conf.blurb}</p>

          <div className="flex flex-col text-xs">
            <div className="k-row">
              <span>Moral etkisi</span>
              <span className={moral > 0 ? 'text-kgrn' : 'text-mute'}>
                +{moral.toFixed(2)} puan
              </span>
            </div>

            {tariff && (
              <div className="k-row">
                <span>
                  {building.type === 'hotel' ? 'Oda ücreti' : 'Kullanım ücreti'}
                </span>
                <span className={tariff.price > 0 ? 'text-kgrn' : ''}>
                  {tariff.price > 0 ? `${tariff.label} · ₺${tariff.price.toLocaleString('tr-TR')}` : tariff.label}
                </span>
              </div>
            )}

            {rooms > 0 && (
              <div className="k-row">
                <span>Odalar</span>
                <span className={guests >= rooms ? 'text-kyel-dark' : ''}>
                  {guests}/{rooms} dolu
                </span>
              </div>
            )}

            {building.type === 'mini_market' && (
              <div className="k-row">
                <span>Raf stoğu</span>
                <span>{gameState.market.stock}</span>
              </div>
            )}

            <div className="k-row">
              <span>Bugünkü ciro</span>
              <span className="text-kgrn">
                ₺{todayRevenue.toLocaleString('tr-TR')}
                {todayVisits > 0 && (
                  <span className="text-mute font-sans font-bold text-xs"> · {todayVisits} ziyaret</span>
                )}
              </span>
            </div>

            <div className="k-row">
              <span>İçeride</span>
              <span>
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
              className={`w-full py-3.5 game-btn font-display tracking-wide text-sm flex items-center justify-center gap-2 ${
                till > 0 ? 'bg-kgrn hover:bg-kgrn-dark text-white' : 'bg-card text-mute'
              }`}
            >
              <Coins className="w-4 h-4" />
              <span>{till > 0 ? `Kasayı Topla — ₺${till.toLocaleString('tr-TR')}` : 'Kasa boş'}</span>
            </button>

            {tariff && nextTariff && (
              <button
                onClick={() => cycleFacilityTariff(building.id)}
                className="w-full py-3.5 game-btn bg-kyel hover:bg-kyel-dark text-ink font-display tracking-wide text-sm"
              >
                Ücreti Değiştir ({tariff.label} → {nextTariff.label})
              </button>
            )}

            {upgrade ? (
              <button
                onClick={() => upgradeBuilding(building.id)}
                title={upgrade.effectsDescription}
                className={`w-full py-3.5 game-btn font-display tracking-wide text-sm ${
                  canAffordUpgrade ? 'bg-kgrn hover:bg-kgrn-dark text-white' : 'bg-card text-mute'
                }`}
              >
                {look.label} Sv.{building.level + 1} — ₺{upgrade.cost.toLocaleString('tr-TR')}
              </button>
            ) : (
              <div className="w-full py-2.5 rounded-md bg-board border-2 border-dashed border-mute text-mute text-center font-extrabold text-xs">
                Maksimum Seviye (Sv.{building.level})
              </div>
            )}

            <button
              onClick={() => {
                sounds.playClick();
                relocateStructure(building.id);
              }}
              disabled={!canMove}
              title={canMove ? 'Yapıyı kaldır ve yeni yerine koy' : `Taşımak için Seviye ${EDIT_MODE_LEVEL} gerekiyor`}
              className={`w-full py-3.5 game-btn font-display tracking-wide text-sm ${
                canMove
                  ? 'bg-card hover:bg-board text-ink'
                  : 'bg-board text-mute cursor-not-allowed'
              }`}
            >
              {canMove ? 'Taşı' : `Taşı — Sv.${EDIT_MODE_LEVEL}`}
            </button>

            <button
              onClick={() => rotateBuilding(building.id)}
              className="w-full py-3.5 game-btn bg-card hover:bg-board text-ink font-display tracking-wide text-sm"
            >
              Döndür
            </button>

            <button
              onClick={() => sellStructure(building.id)}
              className="w-full py-3.5 game-btn bg-kred hover:bg-kred-dark text-white font-display tracking-wide text-sm"
            >
              Yık — ₺{sellValue.toLocaleString('tr-TR')} iade
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
