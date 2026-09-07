import React, { useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { X, Hammer, Lock, Milestone } from 'lucide-react';
import { buyableParcels, parcelPrice, paveCost, parseParcelKey, LAND_BOUNDS, PARCEL } from '../../domain/services/land';
import { sounds } from '../../audio/soundEffects';
import { CatalogPreview, CatalogPhotoBooth } from '../CatalogPreview';

/** A small drawn picture for a card the catalogue has no model for. */
const LandPicture: React.FC<{ kind: 'land' | 'concrete' }> = ({ kind }) => (
  <div className="h-28 rounded-2xl bg-[#1a1618] border border-white/5 flex items-center justify-center overflow-hidden">
    {kind === 'land' ? (
      <svg viewBox="0 0 120 80" className="w-32 h-24" aria-hidden>
        <polygon points="60,14 112,40 60,66 8,40" fill="#3f8a3a" />
        <polygon points="8,40 60,66 60,74 8,48" fill="#2f6a2c" />
        <polygon points="112,40 60,66 60,74 112,48" fill="#27561f" />
        <rect x="78" y="10" width="2" height="30" fill="#e2e8f0" />
        <polygon points="80,10 96,15 80,20" fill="#f8fafc" />
        <circle cx="52" cy="44" r="7" fill="#4ade80" />
        <circle cx="52" cy="41" r="6" fill="#86efac" />
      </svg>
    ) : (
      <svg viewBox="0 0 120 80" className="w-32 h-24" aria-hidden>
        <polygon points="60,18 108,40 60,62 12,40" fill="#9aa3ad" />
        <polygon points="12,40 60,62 60,70 12,48" fill="#6b7480" />
        <polygon points="108,40 60,62 60,70 108,48" fill="#576069" />
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1={22 + i * 10} y1={40 + i * 4.6} x2={70 + i * 10} y2={18 + i * 4.6} stroke="#cbd5e1" strokeWidth="1.2" opacity="0.7" />
        ))}
      </svg>
    )}
  </div>
);

/**
 * Land is bought and paved on the map, but the player looks for it here, so
 * the catalogue carries the two cards that open the map for each job —
 * modelled on the reference Emre gave (2026-09-07) — and the road work.
 */
const LandCards: React.FC<{
  onBuyLand: () => void;
  onPave: () => void;
  onUpgradeRoad: () => void;
}> = ({ onBuyLand, onPave, onUpgradeRoad }) => {
  const station = useGameStore((s) => s.gameState.station);
  const player = useGameStore((s) => s.gameState.player);
  const road = GAME_CONFIG.roadUpgrade;

  const owned = station.plots.ownedParcels;
  const paved = station.plots.pavedParcels;
  const forSale = buyableParcels(owned, station.roadLevel);
  const prices = forSale.map((p) => parcelPrice(owned, p.row));
  const cheapest = prices.length ? Math.min(...prices) : 0;
  const dearest = prices.length ? Math.max(...prices) : 0;
  // Every parcel the map could ever hold on the side(s) open to the player.
  const rows = station.roadLevel >= 2 ? LAND_BOUNDS.maxRow - LAND_BOUNDS.minRow + 1 : LAND_BOUNDS.maxRow + 1;
  const total = (LAND_BOUNDS.maxCol - LAND_BOUNDS.minCol + 1) * rows;
  const unpaved = owned.filter((key) => !paved.includes(key));
  const paveFrom = unpaved.length ? Math.min(...unpaved.map((key) => paveCost(parseParcelKey(key).row))) : 0;

  const roadDone = station.roadLevel >= 2;
  const meetsRoadRequirements =
    player.level >= road.minLevel && player.reputation >= road.minReputation;
  const canAffordRoad = player.cash >= road.price;

  const card = 'bg-[#2a2427] border border-white/10 rounded-3xl p-4 flex flex-col gap-3';
  const badge = 'px-2 py-0.5 rounded-lg text-[11px] font-extrabold';

  return (
    <>
      <div className={card}>
        <LandPicture kind="land" />
        <div className="font-extrabold text-sm text-white">
          Arsa Satın Al ({owned.length}/{total})
        </div>
        <div className="flex gap-2">
          <span className={`${badge} bg-sky-500/20 text-sky-300`}>
            {prices.length ? `₺${cheapest.toLocaleString('tr-TR')}–${dearest.toLocaleString('tr-TR')}` : 'satılık yok'}
          </span>
          <span className={`${badge} bg-white/10 text-slate-300`}>{PARCEL.width}×{PARCEL.depth} birim</span>
        </div>
        <div className="text-xs text-slate-400 leading-relaxed flex-1">
          Bitişik parsele tıkla (yol karşısına da geçebilirsin). Konuma göre fiyat
          değişir — yola bakan parseller pahalı, arkadakiler ucuz; istasyon
          geliştikçe artar. Arsa çitle gelir; inşaat için ayrıca beton dökülür.
        </div>
        <button
          onClick={onBuyLand}
          disabled={forSale.length === 0}
          className={`w-full py-3 rounded-2xl font-extrabold text-sm border transition-all ${
            forSale.length === 0
              ? 'bg-[#221d20] border-white/5 text-slate-500 cursor-not-allowed'
              : 'bg-[#1f1b1d] border-white/10 hover:bg-[#332c30] text-white'
          }`}
        >
          {forSale.length === 0 ? 'KİLİTLİ' : `₺${cheapest.toLocaleString('tr-TR')}`}
        </button>
      </div>

      <div className={card}>
        <LandPicture kind="concrete" />
        <div className="font-extrabold text-sm text-white">Zemin Betonu</div>
        <div className="flex gap-2">
          <span className={`${badge} bg-sky-500/20 text-sky-300`}>arsa başı</span>
        </div>
        <div className="text-xs text-slate-400 leading-relaxed">
          Çimen arsana beton döşe (yapı kurmak için şart; yola bakan parsel biraz
          daha pahalı).
        </div>
        <div className={`text-xs font-extrabold flex-1 ${unpaved.length ? 'text-emerald-400' : 'text-amber-400'}`}>
          {unpaved.length ? `${unpaved.length} betonsuz arsan var` : 'Betonsuz arsan yok'}
        </div>
        <button
          onClick={onPave}
          disabled={unpaved.length === 0}
          className={`w-full py-3 rounded-2xl font-extrabold text-sm border transition-all ${
            unpaved.length === 0
              ? 'bg-[#221d20] border-white/5 text-slate-500 cursor-not-allowed'
              : 'bg-[#1f1b1d] border-white/10 hover:bg-[#332c30] text-white'
          }`}
        >
          {unpaved.length === 0 ? 'KİLİTLİ' : `₺${paveFrom.toLocaleString('tr-TR')}`}
        </button>
      </div>

      <div className={`${card} ${roadDone ? 'opacity-70' : ''}`}>
        <div className="h-28 rounded-2xl bg-[#1a1618] border border-white/5 flex items-center justify-center">
          <Milestone className="w-12 h-12 text-amber-400" />
        </div>
        <div className="font-extrabold text-sm text-white">Yol Genişletme</div>
        <div className="flex gap-2">
          <span className={`${badge} bg-amber-500/20 text-amber-300`}>₺{road.price.toLocaleString('tr-TR')}</span>
          <span className={`${badge} bg-white/10 text-slate-300`}>Sv{road.minLevel} · {road.minReputation.toFixed(2)} itibar</span>
        </div>
        <div className="text-xs text-slate-400 leading-relaxed flex-1">
          Karayolunu bölünmüş yola çevirir: karşı yöne ikinci bir şerit ve arada
          peyzajlı refüj gelir. Yolun karşısındaki parseller satın alınabilir olur.
        </div>
        {roadDone ? (
          <div className="w-full py-3 rounded-2xl bg-[#221d20] border border-white/5 text-emerald-400 text-sm font-extrabold text-center">
            Yol Genişletildi
          </div>
        ) : (
          <button
            onClick={onUpgradeRoad}
            disabled={!meetsRoadRequirements || !canAffordRoad}
            className={`w-full py-3 rounded-2xl font-extrabold text-sm border transition-all ${
              !meetsRoadRequirements || !canAffordRoad
                ? 'bg-[#221d20] border-white/5 text-slate-500 cursor-not-allowed'
                : 'bg-[#1f1b1d] border-white/10 hover:bg-[#332c30] text-white'
            }`}
          >
            {!meetsRoadRequirements ? 'KİLİTLİ' : `₺${road.price.toLocaleString('tr-TR')}`}
          </button>
        )}
      </div>
    </>
  );
};

export const BuildModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const enterBuildMode = useGameStore((s) => s.enterBuildMode);
  const enterLandMode = useGameStore((s) => s.enterLandMode);
  const upgradeRoad = useGameStore((s) => s.upgradeRoad);

  const [category, setCategory] = useState<
    'all' | 'pump' | 'tank' | 'structure' | 'service' | 'energy' | 'land'
  >('all');

  const items =
    category === 'land'
      ? []
      : Object.values(GAME_CONFIG.buildings).filter(
          // Fixed infrastructure comes with the station; there is nothing to
          // choose here, only a level to raise on the thing itself.
          (b) => !b.fixed && (category === 'all' || b.category === category)
        );

  const photographable = useMemo(
    () => Object.values(GAME_CONFIG.buildings).filter((b) => !b.fixed).map((b) => b.type),
    []
  );

  const handleSelectBuild = (type: string) => {
    enterBuildMode(type);
  };

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <CatalogPhotoBooth types={photographable} />
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-gradient-to-b from-slate-800 to-slate-800/60 px-6 py-4 border-b-2 border-slate-700 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge !rounded-2xl w-10 h-10 !bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <Hammer className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">İstasyon Geliştirme</div>
              <div className="text-base font-extrabold text-white">İnşaat & Tesis Kataloğu</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn w-8 h-8 rounded-xl bg-slate-700 border-2 border-slate-600 hover:bg-slate-600 text-slate-200 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex border-b-2 border-slate-800 p-2.5 gap-2 bg-slate-950/40 overflow-x-auto shrink-0">
          {[
            { id: 'all', name: 'Tümü' },
            { id: 'pump', name: 'Pompalar' },
            { id: 'tank', name: 'Tanklar' },
            { id: 'structure', name: 'Yapılar' },
            { id: 'service', name: 'Tesis & Market' },
            { id: 'energy', name: 'Elektrik & Şarj' },
            { id: 'land', name: 'Arsa' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                sounds.playClick();
                setCategory(tab.id as any);
              }}
              className={`game-btn px-4 py-2 rounded-xl font-extrabold text-xs whitespace-nowrap ${
                category === tab.id
                  ? 'bg-gradient-to-b from-amber-300 to-amber-500 border-2 border-amber-200/70 text-slate-950'
                  : 'bg-slate-800 border-2 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>

        {/* Catalog Grid */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 flex-1">
          {category === 'land' && (
            <LandCards
              onBuyLand={() => enterLandMode('BUY')}
              onPave={() => enterLandMode('PAVE')}
              onUpgradeRoad={upgradeRoad}
            />
          )}

          {items.map((item) => {
            const isUnlocked = gameState.player.level >= item.unlockLevel;
            const canAfford = gameState.player.cash >= item.price;
            // One tank package per fuel; the standing one is upgraded instead.
            const maxedOut =
              item.type.startsWith('tank_') &&
              Object.values(gameState.buildings).some((b) => b.type === item.type);

            return (
              <div
                key={item.type}
                className={`bg-slate-950/60 border rounded-2xl p-4 flex flex-col justify-between gap-3 transition-all ${
                  !isUnlocked
                    ? 'border-slate-800 opacity-60'
                    : 'border-slate-700/80 hover:border-amber-500/50'
                }`}
              >
                <div className="flex flex-col gap-3">
                  {/* What the thing actually looks like, before paying for it. */}
                  <CatalogPreview type={item.type} />

                  <div>
                    <div className="flex justify-between items-baseline gap-2">
                      <div className="font-extrabold text-sm text-white leading-tight">
                        {item.name}
                      </div>
                      <div className="font-mono font-bold text-emerald-400 text-sm whitespace-nowrap">
                        ₺{item.price.toLocaleString('tr-TR')}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="px-2 py-0.5 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-mono font-bold">
                        {item.size[0]}x{item.size[1]}m
                      </span>
                      <span className="px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-mono font-bold">
                        Bakım ₺{item.dailyUpkeep}/gün
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 leading-relaxed mt-2">
                      {item.description}
                    </div>
                  </div>
                </div>

                {maxedOut ? (
                  <div className="w-full py-2.5 rounded-xl bg-slate-800/80 text-slate-400 text-xs font-bold flex items-center justify-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Maksimum alım sayısına ulaşıldı — tankı yükseltin</span>
                  </div>
                ) : isUnlocked ? (
                  <button
                    onClick={() => handleSelectBuild(item.type)}
                    disabled={!canAfford}
                    className={`w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                      canAfford
                        ? 'game-btn bg-gradient-to-b from-amber-300 to-amber-500 hover:from-amber-200 hover:to-amber-400 border-2 border-amber-200/70 text-slate-950 shadow-lg shadow-amber-500/20'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Hammer className="w-3.5 h-3.5" />
                    <span>{canAfford ? 'İnşa Et' : 'Yetersiz Bakiye'}</span>
                  </button>
                ) : (
                  <div className="w-full py-2.5 rounded-xl bg-slate-800/80 text-slate-500 text-xs font-bold flex items-center justify-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Seviye {item.unlockLevel} Gerekli</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
