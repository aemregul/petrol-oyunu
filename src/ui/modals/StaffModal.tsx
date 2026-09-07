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
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="k-head k-head-blu shrink-0">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge w-10 h-10">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold font-sans text-white/80 tracking-wider">İnsan Kaynakları & Otomasyon</div>
              <div className="font-display text-xl tracking-wide">Personel & İstasyon Müdürü</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-ink p-2 gap-2 bg-board">
          <button
            onClick={() => {
              sounds.playClick();
              setActiveTab('attendants');
            }}
            className={`k-tab flex-1 flex items-center justify-center gap-2 ${
              activeTab === 'attendants' ? 'k-tab-on' : ''
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
            className={`k-tab flex-1 flex items-center justify-center gap-2 ${
              activeTab === 'manager' ? 'k-tab-on' : ''
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
            <div className="bg-board border-2 border-ink rounded-md p-4 flex justify-between items-center">
              <div>
                <div className="font-display text-base text-ink">Yeni Pompacı İşe Al</div>
                <div className="text-xs text-mute">
                  Gelen araçların akaryakıt dolumunu ve tahsilatını otomatik gerçekleştirir.
                </div>
                <div className="text-[11px] font-mono text-kgrn mt-1">
                  Maaş: 650 TL/gün • İşe Alım: 7.500 TL
                </div>
              </div>
              <button
                onClick={() => hirePumpAttendant()}
                disabled={gameState.player.level < 3 || gameState.player.cash < 7500}
                className={`game-btn px-5 py-2.5 rounded-md font-display tracking-wide text-xs uppercase ${
                  gameState.player.level < 3 || gameState.player.cash < 7500
                    ? 'bg-card text-mute cursor-not-allowed'
                    : 'bg-kgrn hover:bg-kgrn-dark text-white'
                }`}
              >
                {gameState.player.level < 3 ? 'Seviye 3 Gerekli' : 'İşe Al (₺7.500)'}
              </button>
            </div>

            {/* List of Attendants */}
            <div className="flex flex-col gap-3">
              <div className="k-label">Mevcut Çalışanlar</div>
              {attendants.length === 0 ? (
                <div className="text-center py-8 text-mute text-xs bg-board rounded-md border-2 border-dashed border-mute">
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
                      className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-3"
                    >
                      {/* Top Row: Info + Assignment + Actions */}
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-display text-base text-ink">{emp.name}</span>
                            <span className="bg-kblu text-white text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-ink">
                              Seviye {emp.level}
                            </span>
                            {emp.level === 3 && (
                              <span className="bg-kyel text-ink text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-ink">
                                ⭐ USTA
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-mute mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>Maaş: ₺{emp.wage}/gün</span>
                            <span>•</span>
                            <span>Hizmet: {emp.serviceCount}</span>
                            <span>•</span>
                            <span className="text-kgrn font-semibold">
                              Dolum Hızı: %{Math.round(currentTier.speedMultiplier * 100)}
                            </span>
                            <span>•</span>
                            <span className="text-kblu font-semibold">
                              Tepki: {currentTier.actionDelaySeconds}s
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 w-full md:w-auto">
                          {/* Pump assignment selector */}
                          <select
                            value={emp.assignedPumpId || ''}
                            onChange={(e) => assignAttendantToPump(emp.id, e.target.value || null)}
                            className="bg-paper border-2 border-ink rounded-md text-ink font-display text-xs px-2 py-1 outline-none cursor-pointer"
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
                              className={`game-btn text-xs font-display tracking-wide px-3 py-2 rounded-md flex items-center gap-1.5 whitespace-nowrap ${
                                hasEnoughServices && hasEnoughCash
                                  ? 'bg-kblu hover:bg-kblu-dark text-white'
                                  : 'bg-card text-mute cursor-not-allowed'
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
                            className="game-btn p-2 rounded-md bg-kred hover:bg-kred-dark text-white flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Bottom Row: Next Level Perks Preview */}
                      {nextTier ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs bg-paper border-2 border-ink px-3 py-2 rounded-md">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-kyel-dark font-bold flex items-center gap-1">
                              <span>⚡</span> Seviye {nextTier.level} Kazanımları:
                            </span>
                            <span className="text-kgrn font-mono font-bold bg-board px-2 py-0.5 rounded-md border-2 border-kgrn">
                              Dolum Hızı: %{Math.round(currentTier.speedMultiplier * 100)} ➔ %{Math.round(nextTier.speedMultiplier * 100)} (+%{Math.round((nextTier.speedMultiplier - currentTier.speedMultiplier) * 100)})
                            </span>
                            <span className="text-kblu font-mono font-bold bg-board px-2 py-0.5 rounded-md border-2 border-kblu">
                              Tepki: {currentTier.actionDelaySeconds}s ➔ {nextTier.actionDelaySeconds}s (-{(currentTier.actionDelaySeconds - nextTier.actionDelaySeconds).toFixed(1)}s)
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-mute">
                            {hasEnoughServices ? (
                              <span className="text-kgrn font-bold">✓ Deneyim Yeterli ({emp.serviceCount}/{nextTier.requiredServices})</span>
                            ) : (
                              <span>Şart: {emp.serviceCount}/{nextTier.requiredServices} Hizmet</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="pt-2 border-t-2 border-dotted border-mute/60 flex items-center gap-1.5 text-xs text-kyel-dark font-semibold">
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
              <div className="bg-board border-2 border-ink rounded-md p-5 flex flex-col gap-4">
                <div>
                  <div className="font-display text-lg text-ink">İstasyon Müdürü İşe Alımı</div>
                  <div className="text-xs text-mute mt-1">
                    Müdür, belirlediğiniz kasa rezervi ve kurallar dahilinde otomatik yakıt siparişi verir,
                    fiyatları dengeler ve pompacıları yönetir.
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs text-ink">
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${gameState.player.level >= managerConf.minLevel ? 'text-kgrn' : 'text-mute'}`}
                    />
                    <span>Oyuncu Seviyesi: 10 ({gameState.player.level}/10)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${gameState.player.reputation >= managerConf.minReputation ? 'text-kgrn' : 'text-mute'}`}
                    />
                    <span>İstasyon İtibarı: 4.00 ({gameState.player.reputation.toFixed(2)}/4.00)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${attendants.length >= managerConf.minActiveAttendants ? 'text-kgrn' : 'text-mute'}`}
                    />
                    <span>Aktif Pompacı: 2 ({attendants.length}/2)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${profitBarMet ? 'text-kgrn' : 'text-mute'}`}
                    />
                    <span>
                      Son 3 günün {managerConf.minProfitableDaysInLast3}'si kârlı (
                      {profitableDays}/{managerConf.minProfitableDaysInLast3}
                      {recentProfits.length < 3 ? ` — ${recentProfits.length}/3 gün veri` : ''})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${gameState.player.cash >= managerConf.hireCost ? 'text-kgrn' : 'text-mute'}`}
                    />
                    <span>İşe Alım Bedeli: 45.000 TL</span>
                  </div>
                </div>

                <button
                  onClick={hireManager}
                  className="game-btn w-full py-3.5 rounded-md font-display tracking-wide text-sm uppercase bg-kgrn hover:bg-kgrn-dark text-white mt-2"
                >
                  Müdürü Göreve Başlat (₺45.000)
                </button>
              </div>
            ) : (
              // Active Automation Rules Configuration
              <div className="flex flex-col gap-4">
                <div className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-3">
                  <div className="flex justify-between items-center border-b-2 border-dotted border-mute/60 pb-2">
                    <span className="font-display text-base text-ink">Otomatik Yakıt Siparişi</span>
                    <input
                      type="checkbox"
                      checked={gameState.managerSettings.autoFuelOrder}
                      onChange={(e) => updateManagerSettings({ autoFuelOrder: e.target.checked })}
                      className="accent-kgrn w-4 h-4 cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="k-label block">Sipariş Eşiği</span>
                      <span className="font-display text-ink tabular-nums">
                        Tank %{gameState.managerSettings.orderThresholdPercent} altına inince
                      </span>
                    </div>
                    <div>
                      <span className="k-label block">Hedef Doluluk</span>
                      <span className="font-display text-ink tabular-nums">
                        %{gameState.managerSettings.orderTargetPercent} seviyesine kadar
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-2">
                  <div className="flex justify-between items-center border-b-2 border-dotted border-mute/60 pb-2">
                    <span className="font-display text-base text-ink">Tesis Kasalarını Topla</span>
                    <input
                      type="checkbox"
                      checked={gameState.managerSettings.autoCollectTills ?? true}
                      onChange={(e) => updateManagerSettings({ autoCollectTills: e.target.checked })}
                      className="accent-kgrn w-4 h-4 cursor-pointer"
                    />
                  </div>
                  <div className="text-[11px] text-mute">
                    Müdür her {gameState.managerSettings.collectIntervalHours ?? 2} saatte bir WC, market,
                    kahveci, restoran ve otelin kasasını dolaşıp parayı istasyon kasasına aktarır.
                    Kapalıyken parayı yapıların üstündeki rozete tıklayarak sen toplarsın.
                  </div>
                </div>

                <div className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-2">
                  <div className="flex justify-between items-center border-b-2 border-dotted border-mute/60 pb-2">
                    <span className="font-display text-base text-ink">Bataryayı Gece Doldur</span>
                    <input
                      type="checkbox"
                      checked={gameState.managerSettings.nightGridFill ?? false}
                      onChange={(e) => updateManagerSettings({ nightGridFill: e.target.checked })}
                      className="accent-kgrn w-4 h-4 cursor-pointer"
                    />
                  </div>
                  <div className="text-[11px] text-mute">
                    Müdür şebekeden yalnızca gece tarifesinde ({GAME_CONFIG.ev.gridTariff.night.from}:00–
                    {GAME_CONFIG.ev.gridTariff.night.to}:00, ₺{GAME_CONFIG.ev.gridTariff.night.price.toFixed(1)}/kWh) çeker.
                    Batarya %{GAME_CONFIG.ev.nightFillFloorPercent} altına inerse saate bakmadan doldurur.
                  </div>
                </div>

                <div className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="font-display text-base text-ink">Kasa Rezervi Güvencesi</span>
                    <span className="font-display tabular-nums text-kgrn">
                      ₺{gameState.managerSettings.kasaReserve.toLocaleString('tr-TR')}
                    </span>
                  </div>
                  <div className="text-[11px] text-mute">
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
