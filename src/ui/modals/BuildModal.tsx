import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { X, Hammer, Fuel, Database, Building2, ShoppingBag, Maximize, Lock, CheckCircle } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

export const BuildModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const enterBuildMode = useGameStore((s) => s.enterBuildMode);

  const [category, setCategory] = useState<'all' | 'pump' | 'tank' | 'structure' | 'service' | 'energy'>('all');

  const items = Object.values(GAME_CONFIG.buildings).filter((b) => category === 'all' || b.category === category);

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
            { id: 'energy', name: 'Elektrik & Şarj' }
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
          {items.map((item) => {
            const isUnlocked = gameState.player.level >= item.unlockLevel;
            const canAfford = gameState.player.cash >= item.price;

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

                {isUnlocked ? (
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
