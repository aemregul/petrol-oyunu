import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { X, Users, UserCheck, Shield, Sliders, CheckCircle2, AlertCircle, ArrowUpCircle, Trash2 } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

export const StaffModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const hirePumpAttendant = useGameStore((s) => s.hirePumpAttendant);
  const assignAttendantToPump = useGameStore((s) => s.assignAttendantToPump);
  const upgradeAttendant = useGameStore((s) => s.upgradeAttendant);
  const fireAttendant = useGameStore((s) => s.fireAttendant);
  const hireManager = useGameStore((s) => s.hireManager);
  const updateManagerSettings = useGameStore((s) => s.updateManagerSettings);

  const [activeTab, setActiveTab] = useState<'attendants' | 'manager'>('attendants');

  const attendants = Object.values(gameState.employees).filter((e) => e.role === 'PUMP_ATTENDANT');
  const managerConf = GAME_CONFIG.employees.manager;
  const officeLevel = Object.values(gameState.buildings)
    .filter((b) => b.type === 'office')
    .reduce((best, b) => Math.max(best, b.level), 0);
  const recentProfits = gameState.player.statistics.recentNetProfits ?? [];
  const profitableDays = recentProfits.filter((n) => n > 0).length;
  const profitBarMet =
    recentProfits.length >= 3 && profitableDays >= managerConf.minProfitableDaysInLast3;
  const hasManager = !!gameState.station.managerId;

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-gradient-to-b from-slate-800 to-slate-800/60 px-6 py-4 border-b-2 border-slate-700 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge !rounded-2xl w-10 h-10 !bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">İnsan Kaynakları & Otomasyon</div>
              <div className="text-base font-extrabold text-white">Personel & İstasyon Müdürü</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn w-8 h-8 rounded-xl bg-slate-700 border-2 border-slate-600 hover:bg-slate-600 text-slate-200 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 p-2 gap-2 bg-slate-950/40">
          <button
            onClick={() => {
              sounds.playClick();
              setActiveTab('attendants');
            }}
            className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
              activeTab === 'attendants'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Pompacılar ({attendants.length})</span>
          </button>

          <button
            onClick={() => {
              sounds.playClick();
              setActiveTab('manager');
            }}
            className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
              activeTab === 'manager'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>İstasyon Müdürü {hasManager ? '(Aktif)' : '(Kilitli)'}</span>
          </button>
        </div>

        {/* Tab 1: Attendants */}
        {activeTab === 'attendants' && (
          <div className="p-6 flex flex-col gap-4 overflow-y-auto flex-1">
            {/* Hire Action Card */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex justify-between items-center">
              <div>
                <div className="font-extrabold text-sm text-white">Yeni Pompacı İşe Al</div>
                <div className="text-xs text-slate-400">
                  Gelen araçların akaryakıt dolumunu ve tahsilatını otomatik gerçekleştirir.
                </div>
                <div className="text-[11px] font-mono text-emerald-400 mt-1">
                  Maaş: 650 TL/gün • İşe Alım: 7.500 TL
                </div>
              </div>
              <button
                onClick={() => hirePumpAttendant()}
                disabled={gameState.player.level < 3 || gameState.player.cash < 7500}
                className={`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all ${
                  gameState.player.level < 3 || gameState.player.cash < 7500
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'game-btn bg-gradient-to-b from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 border-2 border-indigo-300/60 text-white shadow-lg shadow-indigo-600/30'
                }`}
              >
                {gameState.player.level < 3 ? 'Seviye 3 Gerekli' : 'İşe Al (₺7.500)'}
              </button>
            </div>

            {/* List of Attendants */}
            <div className="flex flex-col gap-3">
              <div className="text-xs font-bold text-slate-400 uppercase">Mevcut Çalışanlar</div>
              {attendants.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs bg-slate-950/30 rounded-2xl border border-slate-800/80">
                  Henüz işe alınmış pompacı bulunmuyor. İlk pompacıyı işe alarak dolumu otomatikleştirebilirsiniz.
                </div>
              ) : (
                attendants.map((emp) => {
                  const currentTier = GAME_CONFIG.employees.pumpAttendant.tierLevels[emp.level - 1] ?? {
                    speedMultiplier: 0.75,
                    actionDelaySeconds: 2.0
                  };
                  const nextTier = GAME_CONFIG.employees.pumpAttendant.tierLevels[emp.level];
                  const hasEnoughServices = nextTier ? emp.serviceCount >= (nextTier.requiredServices || 0) : false;
                  const hasEnoughCash = nextTier ? gameState.player.cash >= nextTier.hireCost : false;

                  return (
                    <div
                      key={emp.id}
                      className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3"
                    >
                      {/* Top Row: Info + Assignment + Actions */}
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm text-white">{emp.name}</span>
                            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-500/30">
                              Seviye {emp.level}
                            </span>
                            {emp.level === 3 && (
                              <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                                ⭐ USTA
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>Maaş: ₺{emp.wage}/gün</span>
                            <span>•</span>
                            <span>Hizmet: {emp.serviceCount}</span>
                            <span>•</span>
                            <span className="text-emerald-400 font-semibold">
                              Dolum Hızı: %{Math.round(currentTier.speedMultiplier * 100)}
                            </span>
                            <span>•</span>
                            <span className="text-sky-300 font-semibold">
                              Tepki: {currentTier.actionDelaySeconds}s
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 w-full md:w-auto">
                          {/* Pump assignment selector */}
                          <select
                            value={emp.assignedPumpId || ''}
                            onChange={(e) => assignAttendantToPump(emp.id, e.target.value || null)}
                            className="bg-slate-800 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 outline-none cursor-pointer"
                          >
                            <option value="">Atanmamış (Boşta)</option>
                            {Object.values(gameState.pumps).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.id.toUpperCase()} (Seviye {p.level})
                              </option>
                            ))}
                          </select>

                          {/* Upgrade Attendant */}
                          {nextTier && (
                            <button
                              onClick={() => upgradeAttendant(emp.id)}
                              disabled={!hasEnoughServices || !hasEnoughCash}
                              className={`game-btn text-xs font-bold px-3 py-2 rounded-xl border flex items-center gap-1.5 whitespace-nowrap transition-all ${
                                hasEnoughServices && hasEnoughCash
                                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white border-indigo-400/40 shadow-lg shadow-indigo-600/30 active:scale-95'
                                  : 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed'
                              }`}
                            >
                              <ArrowUpCircle className="w-3.5 h-3.5" />
                              <span>Eğit (₺{nextTier.hireCost.toLocaleString('tr-TR')})</span>
                            </button>
                          )}

                          {/* Fire / Dismiss Attendant */}
                          <button
                            onClick={() => fireAttendant(emp.id)}
                            title="İşten Çıkar"
                            className="p-2 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-400 hover:text-red-300 transition-all flex items-center justify-center active:scale-95"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Bottom Row: Next Level Perks Preview */}
                      {nextTier ? (
                        <div className="pt-2.5 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs bg-slate-900/40 px-3 py-2 rounded-xl">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-amber-400 font-bold flex items-center gap-1">
                              <span>⚡</span> Seviye {nextTier.level} Kazanımları:
                            </span>
                            <span className="text-emerald-300 font-mono font-bold bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                              Dolum Hızı: %{Math.round(currentTier.speedMultiplier * 100)} ➔ %{Math.round(nextTier.speedMultiplier * 100)} (+%{Math.round((nextTier.speedMultiplier - currentTier.speedMultiplier) * 100)})
                            </span>
                            <span className="text-sky-300 font-mono font-bold bg-sky-500/10 px-2 py-0.5 rounded-md border border-sky-500/20">
                              Tepki: {currentTier.actionDelaySeconds}s ➔ {nextTier.actionDelaySeconds}s (-{(currentTier.actionDelaySeconds - nextTier.actionDelaySeconds).toFixed(1)}s)
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {hasEnoughServices ? (
                              <span className="text-emerald-400 font-bold">✓ Deneyim Yeterli ({emp.serviceCount}/{nextTier.requiredServices})</span>
                            ) : (
                              <span>Şart: {emp.serviceCount}/{nextTier.requiredServices} Hizmet</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="pt-2 border-t border-slate-800/80 flex items-center gap-1.5 text-xs text-amber-300 font-semibold">
                          <span>🏆</span> Maksimum Usta Seviyesi: En yüksek dolum hızı (%110) ve anında reaksiyon (0.6s).
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Manager & Automation */}
        {activeTab === 'manager' && (
          <div className="p-6 flex flex-col gap-4 overflow-y-auto flex-1">
            {!hasManager ? (
              // Hire Manager Requirements Screen
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4">
                <div>
                  <div className="font-extrabold text-base text-white">İstasyon Müdürü İşe Alımı</div>
                  <div className="text-xs text-slate-400 mt-1">
                    Müdür, belirlediğiniz kasa rezervi ve kurallar dahilinde otomatik yakıt siparişi verir,
                    fiyatları dengeler ve pompacıları yönetir.
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${gameState.player.level >= managerConf.minLevel ? 'text-emerald-400' : 'text-slate-600'}`}
                    />
                    <span>Oyuncu Seviyesi: 10 ({gameState.player.level}/10)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${gameState.player.reputation >= managerConf.minReputation ? 'text-emerald-400' : 'text-slate-600'}`}
                    />
                    <span>İstasyon İtibarı: 4.00 ({gameState.player.reputation.toFixed(2)}/4.00)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${attendants.length >= managerConf.minActiveAttendants ? 'text-emerald-400' : 'text-slate-600'}`}
                    />
                    <span>Aktif Pompacı: 2 ({attendants.length}/2)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${officeLevel >= managerConf.minOfficeLevel ? 'text-emerald-400' : 'text-slate-600'}`}
                    />
                    <span>Yönetim Ofisi: Sv{managerConf.minOfficeLevel} ({officeLevel}/{managerConf.minOfficeLevel})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${profitBarMet ? 'text-emerald-400' : 'text-slate-600'}`}
                    />
                    <span>
                      Son 3 günün {managerConf.minProfitableDaysInLast3}'si kârlı (
                      {profitableDays}/{managerConf.minProfitableDaysInLast3}
                      {recentProfits.length < 3 ? ` — ${recentProfits.length}/3 gün veri` : ''})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${gameState.player.cash >= managerConf.hireCost ? 'text-emerald-400' : 'text-slate-600'}`}
                    />
                    <span>İşe Alım Bedeli: 45.000 TL</span>
                  </div>
                </div>

                <button
                  onClick={hireManager}
                  className="w-full py-3.5 rounded-2xl font-black text-sm uppercase tracking-wider game-btn bg-gradient-to-b from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 border-2 border-indigo-300/60 text-white shadow-xl shadow-indigo-600/30 transition-all mt-2"
                >
                  Müdürü Göreve Başlat (₺45.000)
                </button>
              </div>
            ) : (
              // Active Automation Rules Configuration
              <div className="flex flex-col gap-4">
                <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                    <span className="font-extrabold text-sm text-white">Otomatik Yakıt Siparişi</span>
                    <input
                      type="checkbox"
                      checked={gameState.managerSettings.autoFuelOrder}
                      onChange={(e) => updateManagerSettings({ autoFuelOrder: e.target.checked })}
                      className="w-4 h-4 accent-indigo-500 cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Sipariş Eşiği</span>
                      <span className="font-bold text-white font-mono">
                        Tank %{gameState.managerSettings.orderThresholdPercent} altına inince
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Hedef Doluluk</span>
                      <span className="font-bold text-white font-mono">
                        %{gameState.managerSettings.orderTargetPercent} seviyesine kadar
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="font-extrabold text-sm text-white">Kasa Rezervi Güvencesi</span>
                    <span className="font-mono font-bold text-emerald-400">
                      ₺{gameState.managerSettings.kasaReserve.toLocaleString('tr-TR')}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Müdür yapacağı hiçbir harcamada kasanızı bu tutarın altına düşüremez.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
