import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { X, Building2, TrendingUp, Sparkles, Award, BarChart3, Pencil, Check } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

export const OfficeModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const cleanStation = useGameStore((s) => s.cleanStation);
  const renameStation = useGameStore((s) => s.renameStation);

  const { player, station, tanks } = gameState;

  // İstasyonun adı markadır: burada değişir, fiyat totemi ve pilon tabelası
  // aynı isimden beslendiği için saha kendiliğinden güncellenir.
  const [editingName, setEditingName] = useState<string | null>(null);

  const commitName = () => {
    if (editingName !== null && renameStation(editingName)) setEditingName(null);
  };

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-gradient-to-b from-slate-800 to-slate-800/60 px-6 py-4 border-b-2 border-slate-700 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge !rounded-2xl w-10 h-10 !bg-sky-500/20 border border-sky-500/30 text-sky-400 flex items-center justify-center">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">İstasyon Yönetimi</div>
              {editingName === null ? (
                <div className="flex items-center gap-2">
                  <div className="text-base font-extrabold text-white">{station.name}</div>
                  <button
                    onClick={() => setEditingName(station.name)}
                    title="İstasyon adını değiştir — tabelalar da güncellenir"
                    className="text-slate-400 hover:text-sky-400 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={editingName}
                    maxLength={24}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitName();
                      if (e.key === 'Escape') setEditingName(null);
                    }}
                    className="bg-slate-950/80 border border-sky-500/50 rounded-lg px-2 py-0.5 text-base font-extrabold text-white w-48 outline-none focus:border-sky-400"
                  />
                  <button
                    onClick={commitName}
                    title="Kaydet"
                    className="game-btn w-7 h-7 rounded-lg bg-emerald-600/30 border border-emerald-500/40 text-emerald-400 flex items-center justify-center"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setEditingName(null)}
                    title="Vazgeç"
                    className="game-btn w-7 h-7 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-300 flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
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
        <div className="p-6 flex flex-col gap-4 overflow-y-auto flex-1">
          {/* Station Health & Cleanliness */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex justify-between items-center">
              <div>
                <div className="text-[11px] font-bold text-slate-400 uppercase">Saha Temizliği</div>
                <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
                  %{Math.round(station.cleanliness)}
                </div>
              </div>
              <button
                onClick={cleanStation}
                className="px-3 py-2 rounded-xl game-btn bg-slate-800 hover:bg-slate-700 text-xs font-bold text-sky-400 border border-slate-700 flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>Temizle (300 TL)</span>
              </button>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
              <div className="text-[11px] font-bold text-slate-400 uppercase">İstasyon İtibarı</div>
              <div className="text-xl font-black text-amber-400 font-mono mt-0.5">
                ★ {player.reputation.toFixed(2)} <span className="text-xs text-slate-400">/ 5.00</span>
              </div>
            </div>
          </div>

          {/* Lifetime Statistics */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-sky-400" />
              <span>İşletme İstatistikleri</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px] uppercase font-sans">Toplam Satılan Yakıt</span>
                <span className="text-base font-bold text-white">
                  {player.statistics.totalFuelSoldLiters.toFixed(0)} Litre
                </span>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px] uppercase font-sans">Toplam Ciro</span>
                <span className="text-base font-bold text-emerald-400">
                  ₺{player.statistics.totalRevenue.toLocaleString('tr-TR')}
                </span>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px] uppercase font-sans">Müşteri Sayısı</span>
                <span className="text-base font-bold text-sky-400">
                  {player.statistics.totalCustomersServed} Araç
                </span>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px] uppercase font-sans">Toplam Bahşiş</span>
                <span className="text-base font-bold text-amber-400">
                  ₺{player.statistics.totalTips.toLocaleString('tr-TR')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
