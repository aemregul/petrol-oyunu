import React, { useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG, BuildingCatalogItem } from '../../config/gameConfig';
import { GameState } from '../../domain/types/gameState';
import { X, Hammer, Lock, Milestone, Sun } from 'lucide-react';
import { solarPrice, solarUpkeep, solarPeakKwhPerHour } from '../../domain/services/energy';
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

type Category = 'station' | 'service' | 'energy' | 'land';

const TABS: Array<{ id: Category; name: string }> = [
  { id: 'station', name: 'İstasyon' },
  { id: 'service', name: 'Tesisler' },
  { id: 'energy', name: 'Enerji' },
  { id: 'land', name: 'Arsa' }
];

/** Which tab a catalogue item lives under. */
function categoryOf(item: BuildingCatalogItem): Category {
  if (item.category === 'service') return 'service';
  if (item.category === 'energy') return 'energy';
  return 'station';
}

/**
 * Why a catalogue item cannot be built right now, in the words the card
 * shows in orange — or null when it can. Prerequisites are read from what
 * stands anywhere on the station; the placement rules say the rest, block
 * by block, when the piece is put down.
 */
export function catalogLock(state: GameState, item: BuildingCatalogItem): string | null {
  const has = (type: string) => Object.values(state.buildings).some((b) => b.type === type);
  if (state.player.level < item.unlockLevel) return `Seviye ${item.unlockLevel} gerekli`;
  if (item.type.startsWith('tank_') && has(item.type)) return 'Zaten kurulu — yükseltin';
  if (item.type === 'tank_expansion') {
    const farm = Object.values(state.buildings).find((b) => b.type === 'tank_farm');
    if (!farm || farm.level < 3) return 'Tank Sahası Sv.3 gerekli';
  }
  if (item.type === 'ev_storage' && !has('ev_substation')) return 'Elektrik altyapısı gerekli';
  if (
    (item.type === 'ev_charger_ac' || item.type === 'ev_charger_dc' || item.type === 'diesel_generator') &&
    !has('ev_storage')
  ) {
    return 'Enerji depolama gerekli';
  }
  return null;
}

/** The small coloured tag beside the size: what the thing is measured in. */
function featureBadge(item: BuildingCatalogItem): string | null {
  switch (item.type) {
    case 'pump_standard':
      return '8 L/sn';
    case 'ev_substation':
      return 'temel';
    case 'ev_storage':
      return `${GAME_CONFIG.ev.storageKwhByLevel[0]} kWh`;
    case 'ev_charger_ac':
      return `₺${GAME_CONFIG.ev.acPricePerKwh}/kWh`;
    case 'ev_charger_dc':
      return `₺${GAME_CONFIG.ev.dcPricePerKwh}/kWh`;
    case 'diesel_generator':
      return `+${GAME_CONFIG.ev.generator.kwhPerHour} kWh/sa`;
    case 'hotel':
      return `${GAME_CONFIG.facilities.hotel.rooms?.[0] ?? 6} oda`;
    default:
      return null;
  }
}

/** "Sv.1" for what is upgraded in place, "#3" for what is bought again and again. */
function cardTitle(state: GameState, item: BuildingCatalogItem): string {
  const repeatable = ['pump_standard', 'ev_charger_ac', 'ev_charger_dc', 'car_park', 'truck_park', 'light_pole', 'trash_can', 'decoration'];
  if (repeatable.includes(item.type)) {
    const count = item.type === 'pump_standard'
      ? Object.keys(state.pumps).length
      : Object.values(state.buildings).filter((b) => b.type === item.type).length;
    return `${item.name} #${count + 1}`;
  }
  if (GAME_CONFIG.buildingUpgrades[item.type]) return `${item.name} Sv.1`;
  return item.name;
}

/**
 * Panels are not bought here: they go on a pump's canopy, from that pump's
 * own card. This card says so, and says what a roof is worth, so the player
 * learns it from the catalogue and not by accident.
 */
const RoofCards: React.FC<{ level: number; onClose: () => void }> = ({ level, onClose }) => {
  const addNotification = useGameStore((s) => s.addNotification);
  const conf = GAME_CONFIG.ev.solar;
  const card = 'bg-[#2a2427] border border-white/10 rounded-3xl p-4 flex flex-col gap-3';
  const badge = 'px-2 py-0.5 rounded-lg text-[11px] font-extrabold';
  const locked = level < conf.unlockLevel;
  const roofs: Array<{ key: string; name: string; size: [number, number]; where: string; blurb: string; icon: React.ReactNode }> = [
    {
      key: 'canopy',
      name: 'Güneşli Sundurma',
      size: GAME_CONFIG.buildings.canopy.size,
      where: 'Sundurmalı bir pompanın kartından kurulur.',
      blurb: 'Ada sundurmasının üstüne paneller. Gündüz bataryayı doldurur; yağmurda ve kirli istasyonda az üretir.',
      icon: <Sun className="w-10 h-10 text-amber-300" />
    },
  ];
  return (
    <>
      {roofs.map((roof) => (
        <div key={roof.key} className={card}>
          <div className="h-28 rounded-2xl bg-gradient-to-b from-[#1a1618] to-[#0f0d0e] border border-white/5 flex items-center justify-center">
            {roof.icon}
          </div>
          <div className="font-extrabold text-sm text-white leading-tight">{roof.name}</div>
          <div className="flex flex-wrap gap-2">
            <span className={`${badge} bg-amber-500/20 text-amber-300`}>öğlen {solarPeakKwhPerHour(roof.size)} kWh/sa</span>
            <span className={`${badge} bg-white/10 text-slate-300`}>{roof.size[0]}×{roof.size[1]} çatı</span>
            <span className={`${badge} bg-white/10 text-slate-300`}>₺{solarUpkeep(roof.size)}/gün</span>
          </div>
          <div className="text-xs text-slate-400 leading-relaxed flex-1">{roof.blurb}</div>
          <div className="text-xs font-extrabold text-amber-400">
            {locked ? `Seviye ${conf.unlockLevel} gerekli` : roof.where}
          </div>
          {locked ? (
            <div className="w-full py-3 rounded-2xl bg-[#221d20] border border-white/5 text-slate-500 text-sm font-extrabold text-center tracking-wider flex items-center justify-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>KİLİTLİ</span>
            </div>
          ) : (
            <button
              onClick={() => {
                addNotification({ type: 'INFO', title: roof.name, message: roof.where });
                onClose();
              }}
              className="w-full py-3 rounded-2xl font-extrabold text-sm border bg-[#1f1b1d] border-white/10 hover:bg-[#332c30] text-white transition-all"
            >
              ₺{solarPrice(roof.size).toLocaleString('tr-TR')} · çatıdan kur
            </button>
          )}
        </div>
      ))}
    </>
  );
};

export const BuildModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const enterBuildMode = useGameStore((s) => s.enterBuildMode);
  const enterLandMode = useGameStore((s) => s.enterLandMode);
  const upgradeRoad = useGameStore((s) => s.upgradeRoad);

  const [category, setCategory] = useState<Category>('station');

  const items =
    category === 'land'
      ? []
      : Object.values(GAME_CONFIG.buildings).filter(
          // Fixed infrastructure comes with the station; there is nothing to
          // choose here, only a level to raise on the thing itself.
          (b) => !b.fixed && categoryOf(b) === category
        );

  const photographable = useMemo(
    () => Object.values(GAME_CONFIG.buildings).filter((b) => !b.fixed).map((b) => b.type),
    []
  );

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  const card = 'bg-[#2a2427] border border-white/10 rounded-3xl p-4 flex flex-col gap-3';
  const badge = 'px-2 py-0.5 rounded-lg text-[11px] font-extrabold';

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <CatalogPhotoBooth types={photographable} />
      <div className="bg-[#231e21] border border-white/10 rounded-[2rem] w-full max-w-4xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[88vh]">
        <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-8 rounded-full bg-[#d64b4b]" />
            <span className="text-2xl font-black text-white">İnşaat & Yatırım</span>
          </div>
          <button
            onClick={handleClose}
            className="w-11 h-11 rounded-2xl bg-[#2f292c] border border-white/10 hover:bg-[#3a3337] text-slate-200 flex items-center justify-center transition-colors"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-5 flex flex-wrap gap-2.5 shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                sounds.playClick();
                setCategory(tab.id);
              }}
              className={`px-4 py-2.5 rounded-2xl text-[14px] font-extrabold border transition-all ${
                category === tab.id
                  ? 'bg-[#f3ede9] text-[#231e21] border-white/40 shadow-inner'
                  : 'bg-[#2a2427] text-slate-300 border-white/10 hover:bg-[#362f33] hover:text-white'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 flex-1">
          {category === 'land' && (
            <LandCards
              onBuyLand={() => enterLandMode('BUY')}
              onPave={() => enterLandMode('PAVE')}
              onUpgradeRoad={upgradeRoad}
            />
          )}

          {items.map((item) => {
            const lock = catalogLock(gameState, item);
            const canAfford = gameState.player.cash >= item.price;
            const feature = featureBadge(item);

            return (
              <div key={item.type} className={card}>
                {/* What the thing actually looks like, before paying for it. */}
                <CatalogPreview type={item.type} />

                <div className="font-extrabold text-sm text-white leading-tight">{cardTitle(gameState, item)}</div>

                <div className="flex flex-wrap gap-2">
                  {feature && <span className={`${badge} bg-sky-500/20 text-sky-300`}>{feature}</span>}
                  <span className={`${badge} bg-white/10 text-slate-300`}>{item.size[0]}×{item.size[1]}</span>
                  {item.dailyUpkeep > 0 && (
                    <span className={`${badge} bg-white/10 text-slate-300`}>₺{item.dailyUpkeep}/gün</span>
                  )}
                </div>

                <div className="text-xs text-slate-400 leading-relaxed flex-1">{item.description}</div>

                {lock && <div className="text-xs font-extrabold text-amber-400">{lock}</div>}

                {lock ? (
                  <div className="w-full py-3 rounded-2xl bg-[#221d20] border border-white/5 text-slate-500 text-sm font-extrabold text-center tracking-wider flex items-center justify-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    <span>KİLİTLİ</span>
                  </div>
                ) : (
                  <button
                    onClick={() => enterBuildMode(item.type)}
                    disabled={!canAfford}
                    title={canAfford ? 'İnşa et' : 'Yetersiz bakiye'}
                    className={`w-full py-3 rounded-2xl font-extrabold text-sm border transition-all flex items-center justify-center gap-1.5 ${
                      canAfford
                        ? 'bg-[#1f1b1d] border-white/10 hover:bg-[#332c30] text-white'
                        : 'bg-[#221d20] border-white/5 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    {!canAfford && <Hammer className="w-3.5 h-3.5" />}
                    <span>₺{item.price.toLocaleString('tr-TR')}</span>
                  </button>
                )}
              </div>
            );
          })}

          {category === 'energy' && <RoofCards level={gameState.player.level} onClose={handleClose} />}
        </div>
      </div>
    </div>
  );
};
