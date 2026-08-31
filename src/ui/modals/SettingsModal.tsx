import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { X, Settings as SettingsIcon, Volume2, Monitor, RotateCcw, AlertTriangle } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

export const SettingsModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const resetGameSave = useGameStore((s) => s.resetGameSave);

  const [confirmReset, setConfirmReset] = useState(false);
  const [vol, setVol] = useState(gameState.settings.masterVolume);

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  const handleVolumeChange = (newVol: number) => {
    setVol(newVol);
    sounds.setMasterVolume(newVol);
  };

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
    } else {
      resetGameSave();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-100 flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-b from-slate-800 to-slate-800/60 px-6 py-4 border-b-2 border-slate-700 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge !rounded-2xl w-10 h-10 !bg-slate-700/50 text-slate-300 flex items-center justify-center">
              <SettingsIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">Sistem Ayarları</div>
              <div className="text-base font-extrabold text-white">Oyun & Performans</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn w-8 h-8 rounded-xl bg-slate-700 border-2 border-slate-600 hover:bg-slate-600 text-slate-200 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-5">
          {/* Audio Controls */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                <Volume2 className="w-4 h-4 text-sky-400" />
                <span>Ses Seviyesi</span>
              </div>
              <span className="text-xs font-mono text-slate-400 font-bold">{Math.round(vol * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={vol}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
            />
          </div>

          {/* Save Reset */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <div className="text-xs font-bold text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Kayıtlı Oyunu Sıfırla</span>
            </div>
            <div className="text-[11px] text-slate-400">
              Tüm istasyon ilerlemenizi siler ve oyunu 15.000 TL başlangıç sermayesiyle yeniden başlatır.
            </div>
            <button
              onClick={handleReset}
              className={`w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                confirmReset
                  ? 'game-btn bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 border-2 border-red-300/60 text-white animate-pulse'
                  : 'game-btn bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{confirmReset ? 'Emin misiniz? (Onaylamak için tekrar tıklayın)' : 'Oyunu Sıfırla'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
