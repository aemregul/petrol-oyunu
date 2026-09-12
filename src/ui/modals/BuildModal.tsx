import React, { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG, BuildingCatalogItem } from '../../config/gameConfig';
import { GameState } from '../../domain/types/gameState';
import { X, Hammer, Lock, Milestone, Sun } from 'lucide-react';
import { solarPrice, solarUpkeep, solarPeakKwhPerHour } from '../../domain/services/energy';
import { unitPrice, ownedCount, catalogLimitReason } from '../../domain/services/catalogRules';
import { buyableParcels, parcelPrice, paveCost, parseParcelKey, LAND_BOUNDS, PARCEL } from '../../domain/services/land';
import { sounds } from '../../audio/soundEffects';
import { openTabs } from '../lessons/openTabs';
import { CatalogPreview, CatalogPhotoBooth } from '../CatalogPreview';

/*
 * Karton (Emre, 2026-09-07): every catalogue card is a paper sticker with an
 * ink line and a hard shadow; the image sits in a board frame, the price is
 * a green button, and a lock is a cardboard-coloured block.
 */
const CARD = 'bg-paper border-2 border-ink rounded-md p-4 flex flex-col gap-3 shadow-k';
const BADGE = 'px-2 py-0.5 rounded-sm text-[11px] font-black border border-ink';
const BADGE_PLAIN = `${BADGE} bg-card text-ink`;
const BADGE_FEATURE = `${BADGE} bg-kblu text-white`;
const BADGE_PRICE = `${BADGE} bg-kyel text-ink`;
const FRAME = 'h-28 bg-board border-2 border-ink rounded-md flex items-center justify-center overflow-hidden';
const LOCKED = 'w-full game-btn bg-card text-mute font-display tracking-wider py-3 text-center flex items-center justify-center gap-1.5';
const BUY = 'w-full game-btn font-display text-base py-3 flex items-center justify-center gap-1.5';
const BUY_ON = 'bg-kgrn hover:bg-kgrn-dark text-white';
const BUY_OFF = 'bg-card text-mute';

/** A small drawn picture for a card the catalogue has no model for. */
const LandPicture: React.FC<{ kind: 'land' | 'concrete' }> = ({ kind }) => (
  <div className={FRAME}>
    {kind === 'land' ? (
      <svg viewBox="0 0 120 80" className="w-32 h-24" aria-hidden>
        <polygon points="60,14 112,40 60,66 8,40" fill="#3f8a3a" />
        <polygon points="8,40 60,66 60,74 8,48" fill="#2f6a2c" />
        <polygon points="112,40 60,66 60,74 112,48" fill="#27561f" />
        <rect x="78" y="10" width="2" height="30" fill="rgb(var(--k-ink))" />
        <polygon points="80,10 96,15 80,20" fill="#e0452b" />
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

  return (
    <>
      <div className={CARD}>
        <LandPicture kind="land" />
        <div className="font-display text-base text-ink tracking-wide leading-tight">
          Arsa Satın Al ({owned.length}/{total})
        </div>
        <div className="flex gap-2">
          <span className={BADGE_FEATURE}>
            {prices.length ? `₺${cheapest.toLocaleString('tr-TR')}–${dearest.toLocaleString('tr-TR')}` : 'satılık yok'}
          </span>
          <span className={BADGE_PLAIN}>{PARCEL.width}×{PARCEL.depth} birim</span>
        </div>
        <div className="text-xs text-mute leading-relaxed flex-1">
          Bitişik parsele tıkla (yol karşısına da geçebilirsin). Konuma göre fiyat
          değişir — yola bakan parseller pahalı, arkadakiler ucuz; istasyon
          geliştikçe artar. Arsa çitle gelir; inşaat için ayrıca beton dökülür.
        </div>
        <button
          data-tour="land-buy"
          onClick={onBuyLand}
          disabled={forSale.length === 0}
          className={`${BUY} ${forSale.length === 0 ? BUY_OFF : BUY_ON}`}
        >
          {forSale.length === 0 ? 'KİLİTLİ' : `₺${cheapest.toLocaleString('tr-TR')}`}
        </button>
      </div>

      <div className={CARD}>
        <LandPicture kind="concrete" />
        <div className="font-display text-base text-ink tracking-wide leading-tight">Zemin Betonu</div>
        <div className="flex gap-2">
          <span className={BADGE_FEATURE}>arsa başı</span>
        </div>
        <div className="text-xs text-mute leading-relaxed">
          Çimen arsana beton döşe (yapı kurmak için şart; yola bakan parsel biraz
          daha pahalı).
        </div>
        <div className={`text-xs font-black flex-1 ${unpaved.length ? 'text-kgrn' : 'text-kyel-dark'}`}>
          {unpaved.length ? `${unpaved.length} betonsuz arsan var` : 'Betonsuz arsan yok'}
        </div>
        <button
          data-tour="land-pave"
          onClick={onPave}
          disabled={unpaved.length === 0}
          className={`${BUY} ${unpaved.length === 0 ? BUY_OFF : BUY_ON}`}
        >
          {unpaved.length === 0 ? 'KİLİTLİ' : `₺${paveFrom.toLocaleString('tr-TR')}`}
        </button>
      </div>

      <div className={`${CARD} ${roadDone ? 'opacity-70' : ''}`}>
        <div className={FRAME}>
          <Milestone className="w-12 h-12 text-kyel-dark" />
        </div>
        <div className="font-display text-base text-ink tracking-wide leading-tight">Yol Genişletme</div>
        <div className="flex gap-2">
          <span className={BADGE_PRICE}>₺{road.price.toLocaleString('tr-TR')}</span>
          <span className={BADGE_PLAIN}>Sv{road.minLevel} · {road.minReputation.toFixed(2)} itibar</span>
        </div>
        <div className="text-xs text-mute leading-relaxed flex-1">
          Karayolunu bölünmüş yola çevirir: karşı yöne ikinci bir şerit ve arada
          peyzajlı refüj gelir. Yolun karşısındaki parseller satın alınabilir olur.
        </div>
        {roadDone ? (
          <div className="w-full py-3 rounded-md bg-card border-2 border-ink text-kgrn font-display tracking-wide text-center">
            Yol Genişletildi
          </div>
        ) : (
          <button
            onClick={onUpgradeRoad}
            disabled={!meetsRoadRequirements || !canAffordRoad}
            className={`${BUY} ${!meetsRoadRequirements || !canAffordRoad ? BUY_OFF : BUY_ON}`}
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
  // Both blocks full, or the station's one of it already standing.
  const limit = catalogLimitReason(state, item.type);
  if (limit) return limit;
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
  const locked = level < conf.unlockLevel;
  const roofs: Array<{ key: string; name: string; size: [number, number]; where: string; blurb: string; icon: React.ReactNode }> = [
    {
      key: 'canopy',
      name: 'Güneşli Sundurma',
      size: GAME_CONFIG.buildings.canopy.size,
      where: 'Sundurmalı bir pompanın kartından kurulur.',
      blurb: 'Ada sundurmasının üstüne paneller. Gündüz bataryayı doldurur; yağmurda ve kirli istasyonda az üretir.',
      icon: <Sun className="w-10 h-10 text-kyel-dark" />
    },
  ];
  return (
    <>
      {roofs.map((roof) => (
        <div key={roof.key} className={CARD} data-tour="roof-card">
          <div className={FRAME}>
            {roof.icon}
          </div>
          <div className="font-display text-base text-ink tracking-wide leading-tight">{roof.name}</div>
          <div className="flex flex-wrap gap-2">
            <span className={BADGE_PRICE}>öğlen {solarPeakKwhPerHour(roof.size)} kWh/sa</span>
            <span className={BADGE_PLAIN}>{roof.size[0]}×{roof.size[1]} çatı</span>
            <span className={BADGE_PLAIN}>₺{solarUpkeep(roof.size)}/gün</span>
          </div>
          <div className="text-xs text-mute leading-relaxed flex-1">{roof.blurb}</div>
          <div className={`text-xs font-black ${locked ? 'text-kred' : 'text-kyel-dark'}`}>
            {locked ? `Seviye ${conf.unlockLevel} gerekli` : roof.where}
          </div>
          {locked ? (
            <div className={LOCKED}>
              <Lock className="w-3.5 h-3.5" />
              <span>KİLİTLİ</span>
            </div>
          ) : (
            <button
              onClick={() => {
                addNotification({ type: 'INFO', title: roof.name, message: roof.where });
                onClose();
              }}
              className={`${BUY} ${BUY_ON}`}
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
  // The open tab, for a lesson that teaches each tab the first time it is shown.
  useEffect(() => {
    openTabs.build = category;
    return () => {
      openTabs.build = null;
    };
  }, [category]);

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

  return (
    <div className="k-dim animate-fade-in select-none">
      <CatalogPhotoBooth types={photographable} />
      <div className="game-surface w-full max-w-4xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="k-head k-head-yel shrink-0">
          <span className="font-display text-xl tracking-wide">İnşaat & Yatırım</span>
          <button
            onClick={handleClose}
            data-tour="build-close"
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-5 flex flex-wrap gap-2.5 shrink-0" data-tour="build-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                sounds.playClick();
                setCategory(tab.id);
              }}
              data-tour={`build-tab-${tab.id}`}
              className={category === tab.id ? 'k-tab k-tab-on' : 'k-tab'}
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
            const price = unitPrice(gameState, item.type);
            const canAfford = gameState.player.cash >= price;
            const feature = featureBadge(item);
            const rule = GAME_CONFIG.buildingRules[item.type];
            const cap = rule?.maxTotal ?? rule?.maxPerSide;
            const owned = ownedCount(gameState, item.type);

            return (
              <div key={item.type} className={CARD} data-tour={`build-card-${item.type}`}>
                {/* What the thing actually looks like, before paying for it. */}
                <CatalogPreview type={item.type} />

                <div className="font-display text-base text-ink tracking-wide leading-tight">{cardTitle(gameState, item)}</div>

                <div className="flex flex-wrap gap-2">
                  {feature && <span className={BADGE_FEATURE}>{feature}</span>}
                  <span className={BADGE_PLAIN}>{item.size[0]}×{item.size[1]}</span>
                  {item.dailyUpkeep > 0 && (
                    <span className={BADGE_PLAIN}>₺{item.dailyUpkeep}/gün</span>
                  )}
                  {cap !== undefined && (
                    <span
                      className={BADGE_PLAIN}
                      title={rule?.maxTotal !== undefined ? 'İstasyon genelinde sınır' : 'Arsa başına sınır'}
                    >
                      {owned}/{cap}{rule?.maxPerSide !== undefined && rule?.maxTotal === undefined ? ' · arsa başı' : ''}
                    </span>
                  )}
                </div>

                <div className="text-xs text-mute leading-relaxed flex-1">{item.description}</div>

                {lock && <div className="text-kred font-black text-xs">{lock}</div>}

                {lock ? (
                  <div className={LOCKED} data-tour="build-card-buy">
                    <Lock className="w-3.5 h-3.5" />
                    <span>KİLİTLİ</span>
                  </div>
                ) : (
                  <button
                    data-tour="build-card-buy"
                    onClick={() => enterBuildMode(item.type)}
                    disabled={!canAfford}
                    title={canAfford ? 'İnşa et' : 'Yetersiz bakiye'}
                    className={`${BUY} ${canAfford ? BUY_ON : BUY_OFF}`}
                  >
                    {!canAfford && <Hammer className="w-3.5 h-3.5" />}
                    <span>₺{price.toLocaleString('tr-TR')}</span>
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
