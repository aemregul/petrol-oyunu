import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { X, Hammer, Lock, Map as MapIcon, Milestone } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

/**
 * Land and road work are bought on the map rather than placed from the
 * catalogue, but players look for them here, so the catalogue carries the
 * entry points.
 */
const LandAndRoadCards: React.FC<{
  onBuyLand: () => void;
  onUpgradeRoad: () => void;
}> = ({ onBuyLand, onUpgradeRoad }) => {
  const station = useGameStore((s) => s.gameState.station);
  const player = useGameStore((s) => s.gameState.player);
  const road = GAME_CONFIG.roadUpgrade;

  const roadDone = station.roadLevel >= 2;
  const meetsRoadRequirements =
    player.level >= road.minLevel && player.reputation >= road.minReputation;
  const canAffordRoad = player.cash >= road.price;

  return (
    <>
      <div className="bg-slate-950/60 border border-slate-700/80 rounded-2xl p-4 flex flex-col justify-between gap-3 hover:border-emerald-500/50 transition-all">
        <div>
          <div className="flex justify-between items-start mb-1">
            <div className="font-extrabold text-sm text-white">Arsa Satın Al</div>
            <div className="font-mono font-bold text-emerald-400 text-sm">değişken</div>
          </div>
          <div className="text-xs text-slate-400 leading-relaxed mb-3">
            Haritada komşu parsellerin üstüne gelip satın alın. Arsa çitle çevrili
            gelir; inşaat için ayrıca beton dökmeniz gerekir.
          </div>
          <div className="text-[10px] font-mono text-slate-400 bg-slate-900/80 p-2 rounded-xl border border-slate-800">
            Sahip olunan parsel: {station.plots.ownedParcels.length} · Betonlanan:{' '}
            {station.plots.pavedParcels.length}
          </div>
        </div>
        <button
          onClick={onBuyLand}
          className="w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1.5 transition-all"
        >
          <MapIcon className="w-3.5 h-3.5" />
          <span>Haritada Aç</span>
        </button>
      </div>

      <div
        className={`bg-slate-950/60 border rounded-2xl p-4 flex flex-col justify-between gap-3 transition-all ${
          roadDone ? 'border-slate-800 opacity-70' : 'border-slate-700/80 hover:border-amber-500/50'
        }`}
      >
        <div>
          <div className="flex justify-between items-start mb-1">
            <div className="font-extrabold text-sm text-white">Yol Genişletme</div>
            <div className="font-mono font-bold text-emerald-400 text-sm">
              ₺{road.price.toLocaleString('tr-TR')}
            </div>
          </div>
          <div className="text-xs text-slate-400 leading-relaxed mb-3">
            Karayolunu bölünmüş yola çevirir: karşı yöne ikinci bir şerit ve arada
            peyzajlı refüj gelir. Yolun karşısındaki parseller satın alınabilir hale
            gelir.
          </div>
          <div className="text-[10px] font-mono text-slate-400 bg-slate-900/80 p-2 rounded-xl border border-slate-800">
            Seviye {road.minLevel} · {road.minReputation.toFixed(2)} itibar gerekir
          </div>
        </div>

        {roadDone ? (
          <div className="w-full py-2.5 rounded-xl bg-slate-800/80 text-emerald-400 text-xs font-bold flex items-center justify-center gap-1.5">
            <Milestone className="w-3.5 h-3.5" />
            <span>Yol Zaten Genişletildi</span>
          </div>
        ) : !meetsRoadRequirements ? (
          <div className="w-full py-2.5 rounded-xl bg-slate-800/80 text-slate-500 text-xs font-bold flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            <span>Seviye {road.minLevel} & {road.minReputation.toFixed(2)} İtibar</span>
          </div>
        ) : (
          <button
            onClick={onUpgradeRoad}
            disabled={!canAffordRoad}
            className={`w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
              canAffordRoad
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Milestone className="w-3.5 h-3.5" />
            <span>{canAffordRoad ? 'Yolu Genişlet' : 'Yetersiz Bakiye'}</span>
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

  const handleSelectBuild = (type: string) => {
    enterBuildMode(type);
  };

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700/80 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <Hammer className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">İstasyon Geliştirme</div>
              <div className="text-base font-extrabold text-white">İnşaat & Tesis Kataloğu</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex border-b border-slate-800 p-2 gap-2 bg-slate-950/40 overflow-x-auto">
          {[
            { id: 'all', name: 'Tümü' },
            { id: 'pump', name: 'Pompalar' },
            { id: 'tank', name: 'Tanklar' },
            { id: 'structure', name: 'Yapılar' },
            { id: 'service', name: 'Tesis & Market' },
            { id: 'energy', name: 'Elektrik & Şarj' },
            { id: 'land', name: 'Arsa & Altyapı' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                sounds.playClick();
                setCategory(tab.id as any);
              }}
              className={`px-4 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all ${
                category === tab.id
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>

        {/* Catalog Grid */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
          {category === 'land' && <LandAndRoadCards
            onBuyLand={() => { enterLandMode(); setActiveModal('NONE'); }}
            onUpgradeRoad={upgradeRoad}
          />}

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
                <div>
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-extrabold text-sm text-white">{item.name}</div>
                    <div className="font-mono font-bold text-emerald-400 text-sm">
                      ₺{item.price.toLocaleString('tr-TR')}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 leading-relaxed mb-3">{item.description}</div>

                  <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400 bg-slate-900/80 p-2 rounded-xl border border-slate-800">
                    <div>Boyut: {item.size[0]}x{item.size[1]}m</div>
                    <div>•</div>
                    <div>Günlük Bakım: ₺{item.dailyUpkeep}/gün</div>
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
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20'
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
