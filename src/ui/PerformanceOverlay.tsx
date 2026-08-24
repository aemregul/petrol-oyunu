import React, { useState, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { Activity, PlusCircle, Unlock } from 'lucide-react';
import { TransactionService } from '../domain/services/TransactionService';
import { SaveManager } from '../domain/services/SaveManager';

export const PerformanceOverlay: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const perfMetrics = useGameStore((s) => s.perfMetrics);
  const updatePerfMetrics = useGameStore((s) => s.updatePerfMetrics);
  const devUnlockEverything = useGameStore((s) => s.devUnlockEverything);
  const [showDebug, setShowDebug] = useState(false);

  // The vehicle map gets a new identity on every simulation tick, so this
  // effect must not depend on it: re-creating the loop 20 times a second
  // reset the frame counter before it could ever measure a full second.
  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let animId: number;

    const loop = () => {
      frameCount++;
      const now = performance.now();
      const elapsed = now - lastTime;

      if (elapsed >= 1000) {
        updatePerfMetrics({
          fps: Math.round((frameCount * 1000) / elapsed),
          activeVehicles: Object.keys(useGameStore.getState().gameState.vehicles).length
        });
        frameCount = 0;
        lastTime = now;
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [updatePerfMetrics]);

  const handleAddCheats = (amount: number) => {
    const state = useGameStore.getState().gameState;
    TransactionService.executeCashTransaction(state, {
      type: 'TUTORIAL_REWARD',
      amount,
      description: `Geliştirici Test Sermayesi (+${amount} TL)`
    });
    SaveManager.saveGame(state);
    useGameStore.setState({ gameState: { ...state } });
  };

  return (
    <div className="fixed bottom-4 left-4 z-40 select-none pointer-events-auto">
      <div className="bg-slate-950/80 border border-slate-800 backdrop-blur-md rounded-2xl p-2 px-3 shadow-xl flex items-center gap-3 text-[10px] font-mono text-slate-400">
        <div className="flex items-center gap-1">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-white font-bold">{perfMetrics.fps} FPS</span>
        </div>
        <div className="w-px h-3 bg-slate-800" />
        <div>
          Araç: <span className="text-white font-bold">{Object.keys(gameState.vehicles).length}</span>
        </div>
        <div className="w-px h-3 bg-slate-800" />
        <div>
          Draw Calls: <span className="text-white font-bold">{perfMetrics.drawCalls}</span>
        </div>

        <button
          onClick={() => setShowDebug(!showDebug)}
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-sans text-[9px] font-bold"
        >
          {showDebug ? 'Kapat' : 'Test Paneli'}
        </button>
      </div>

      {showDebug && (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-3 shadow-2xl mt-2 flex flex-col gap-2 animate-fade-in text-xs">
          <div className="font-bold text-white uppercase text-[10px]">Geliştirici & QA Test Butonları</div>
          <div className="flex gap-2">
            <button
              onClick={() => handleAddCheats(10000)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>+10.000 TL</span>
            </button>
            <button
              onClick={() => handleAddCheats(100000)}
              className="bg-sky-600 hover:bg-sky-500 text-white px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>+100.000 TL</span>
            </button>
          </div>

          <button
            onClick={devUnlockEverything}
            className="bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 justify-center"
          >
            <Unlock className="w-3.5 h-3.5" />
            <span>Her Şeyin Kilidini Aç (Seviye 10 + 500.000 TL)</span>
          </button>

          <div className="text-[10px] text-slate-400 leading-relaxed">
            Tüm yapılar, arsa genişlemeleri, krediler, müdür ve dizel/LPG tankları
            açılır. Pompalar üç yakıtı da destekler hale gelir.
          </div>
        </div>
      )}
    </div>
  );
};
