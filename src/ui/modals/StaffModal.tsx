import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { X, Users, UserCheck, Shield, Sliders, CheckCircle2, AlertCircle, ArrowUpCircle, Trash2, Check, Lock } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import {
  MANAGER_DUTIES,
  MANAGER_DUTY_SETTING,
  MANAGER_MAX_LEVEL,
  dutyEnabled,
  dutyMinLevel,
  dutyUnlocked,
  managerLevel,
  managerTier,
  managerTierAt
} from '../../domain/services/managerDuties';
import type { ManagerDuty } from '../../config/gameConfig';
import { pumpName } from '../../domain/services/pumpNames';

/** What each duty is called on the panel, and what it means in a line. */
const DUTY_LABEL: Record<ManagerDuty, { label: string; hint: string }> = {
  collectTills: { label: 'Kumbara topla', hint: 'Tesislerin kasasını dolaşıp parayı istasyon kasasına aktarır.' },
  fuelOrder: { label: 'Yakıt sipariş et', hint: 'Tank eşiğin altına inince tanker çağırır.' },
  assignAttendants: { label: 'Pompacı ata', hint: 'Boşta kalan pompacıyı boş pompaya koyar.' },
  maintenance: { label: 'Bakım yaptır', hint: 'Yıpranan pompayı arızalanmadan, boşken servise sokar.' },
  pricing: { label: 'Fiyat dengele', hint: 'Bölge ortalamasını izler, marjı korur.' },
  nightGridFill: { label: 'Bataryayı gece doldur', hint: 'Şebekeden yalnızca gece tarifesinde çeker.' },
  cleanStation: { label: 'Sahayı temizle', hint: 'Temizlik %50 altına inince sahayı ve panelleri yıkatır.' },
  repair: { label: 'Arıza tamir et', hint: 'Arızalanan pompayı tekrar hizmete alır.' },
  dealStock: { label: 'İndirimde stokla', hint: 'Tedarikçi indirimi açılınca depoları fuller.' }
};

export const StaffModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const hirePumpAttendant = useGameStore((s) => s.hirePumpAttendant);
  const assignAttendantToPump = useGameStore((s) => s.assignAttendantToPump);
  const upgradeAttendant = useGameStore((s) => s.upgradeAttendant);
  const fireAttendant = useGameStore((s) => s.fireAttendant);
  const hireManager = useGameStore((s) => s.hireManager);
  const upgradeManager = useGameStore((s) => s.upgradeManager);
  const fireManager = useGameStore((s) => s.fireManager);
  const updateManagerSettings = useGameStore((s) => s.updateManagerSettings);

  const [activeTab, setActiveTab] = useState<'attendants' | 'manager'>('attendants');

  const attendants = Object.values(gameState.employees).filter((e) => e.role === 'PUMP_ATTENDANT');
  const managerConf = GAME_CONFIG.employees.manager;
  // What a new attendant costs, from the config rather than a number typed
  // into the card: the figures moved (Emre, 2026-09-08) and the card lied.
  const recruit = GAME_CONFIG.employees.pumpAttendant.tierLevels[0];
  const lira = (n: number) => n.toLocaleString('tr-TR');
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
                  Maaş: {lira(recruit.dailyWage)} TL/gün • İşe Alım: {lira(recruit.hireCost)} TL
                </div>
              </div>
              <button
                onClick={() => hirePumpAttendant()}
                disabled={gameState.player.level < 3 || gameState.player.cash < recruit.hireCost}
                className={`game-btn px-5 py-2.5 rounded-md font-display tracking-wide text-xs uppercase ${
                  gameState.player.level < 3 || gameState.player.cash < recruit.hireCost
                    ? 'bg-card text-mute cursor-not-allowed'
                    : 'bg-kgrn hover:bg-kgrn-dark text-white'
                }`}
              >
                {gameState.player.level < 3 ? 'Seviye 3 Gerekli' : `İşe Al (₺${lira(recruit.hireCost)})`}
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

                        <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
                          {/* Where they stand: one chip per bay, the one they are on
                              lit, plus "Boşta". A native select looked like a form on
                              a card (Emre, 2026-09-09). */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              onClick={() => assignAttendantToPump(emp.id, null)}
                              className={`game-btn px-2.5 py-1.5 rounded-md font-display text-xs tracking-wide ${
                                emp.assignedPumpId ? 'bg-board text-ink hover:bg-card' : 'bg-kyel text-ink'
                              }`}
                              title="Pompadan al, boşta beklesin"
                            >
                              Boşta
                            </button>
                            {Object.values(gameState.pumps).map((p) => {
                              const mine = emp.assignedPumpId === p.id;
                              const taken = !mine && attendants.some((other) => other.assignedPumpId === p.id);
                              return (
                                <button
                                  key={p.id}
                                  onClick={() => assignAttendantToPump(emp.id, p.id)}
                                  disabled={taken}
                                  title={taken ? 'Bu pompada başka pompacı var' : `Sv.${p.level} pompa`}
                                  className={`game-btn px-2.5 py-1.5 rounded-md font-display text-xs tracking-wide ${
                                    mine
                                      ? 'bg-kgrn text-white'
                                      : taken
                                        ? 'bg-board text-mute opacity-60 cursor-not-allowed'
                                        : 'bg-board text-ink hover:bg-card'
                                  }`}
                                >
                                  {pumpName(gameState, p)}
                                </button>
                              );
                            })}
                          </div>

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
                    Müdür belirlediğin kasa rezervi dahilinde istasyonu tur tur dolaşır: Sv.1 kasaları toplar,
                    yakıt sipariş eder, pompacı atar ve bakım yaptırır; Sv.2 fiyat dengeler, bataryayı gece
                    doldurur, sahayı temizler ve arıza tamir eder; Sv.3 tedarikçi indiriminde depoları fuller.
                    Terfi paralı.
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs text-ink">
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${gameState.player.level >= managerConf.minLevel ? 'text-kgrn' : 'text-mute'}`}
                    />
                    <span>Oyuncu Seviyesi: {managerConf.minLevel} ({gameState.player.level}/{managerConf.minLevel})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${gameState.player.reputation >= managerConf.minReputation ? 'text-kgrn' : 'text-mute'}`}
                    />
                    <span>İstasyon İtibarı: {managerConf.minReputation.toFixed(2)} ({gameState.player.reputation.toFixed(2)}/{managerConf.minReputation.toFixed(2)})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${attendants.length >= managerConf.minActiveAttendants ? 'text-kgrn' : 'text-mute'}`}
                    />
                    <span>Aktif Pompacı: {managerConf.minActiveAttendants} ({attendants.length}/{managerConf.minActiveAttendants})</span>
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
                    <span>İşe Alım Bedeli: {lira(managerConf.hireCost)} TL</span>
                  </div>
                </div>

                <button
                  onClick={hireManager}
                  className="game-btn w-full py-3.5 rounded-md font-display tracking-wide text-sm uppercase bg-kgrn hover:bg-kgrn-dark text-white mt-2"
                >
                  Müdürü Göreve Başlat (₺{lira(managerConf.hireCost)})
                </button>
              </div>
            ) : (
              // The manager's card: grade, pay, promotion, and the job
              // description as toggles — what the grade has not unlocked shows
              // locked with the grade that would unlock it.
              (() => {
                const level = managerLevel(gameState);
                const tier = managerTier(gameState);
                const next = level < MANAGER_MAX_LEVEL ? managerTierAt(level + 1) : null;
                const settings = gameState.managerSettings;
                const canPromote =
                  !!next &&
                  gameState.player.reputation >= next.minReputation &&
                  gameState.player.cash >= next.upgradeCost;
                const allThresholds = managerTierAt(MANAGER_MAX_LEVEL).orderThresholds;
                const thresholdMinLevel = (pct: number) =>
                  managerConf.tiers.find((t) => t.orderThresholds.includes(pct))?.level ?? MANAGER_MAX_LEVEL;
                const fillMinLevel =
                  managerConf.tiers.find((t) => t.canFillTank)?.level ?? MANAGER_MAX_LEVEL;
                const fillOn = settings.orderTargetPercent >= 100;
                const chip = (on: boolean, locked: boolean) =>
                  `game-btn flex items-center gap-1.5 border-2 border-ink rounded-md px-3 py-1.5 font-display text-xs tracking-wide ${
                    locked
                      ? 'bg-board text-mute opacity-70 cursor-not-allowed'
                      : on
                        ? 'bg-kgrn text-white'
                        : 'bg-board text-ink hover:bg-paper'
                  }`;
                const dutyLine = (t: (typeof managerConf.tiers)[number], from: (typeof managerConf.tiers)[number] | null) =>
                  t.duties
                    .filter((d) => !from || !from.duties.includes(d))
                    .map((d) => DUTY_LABEL[d].label.toLowerCase())
                    .join(', ');

                return (
                  <div className="flex flex-col gap-4">
                    <div className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-3">
                      <div className="flex flex-wrap justify-between items-center gap-2 border-b-2 border-dotted border-mute/60 pb-2">
                        <div className="flex items-center gap-2">
                          <Shield className="w-5 h-5 text-kblu" />
                          <span className="font-display text-base text-ink">Müdür Sv.{level}</span>
                          <span className="text-xs text-mute">
                            · yevmiye ₺{tier.dailyWage.toLocaleString('tr-TR')}/gün
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {next ? (
                            <button
                              onClick={upgradeManager}
                              disabled={!canPromote}
                              title={
                                canPromote
                                  ? `Tur ${next.tourSeconds} sn'ye iner, yevmiye ₺${next.dailyWage.toLocaleString('tr-TR')}/gün olur.`
                                  : `İtibar ${next.minReputation.toFixed(2)} ve ₺${next.upgradeCost.toLocaleString('tr-TR')} gerekir.`
                              }
                              className={`game-btn flex items-center gap-1 px-3 py-1.5 rounded-md font-display text-xs uppercase tracking-wide ${
                                canPromote ? 'bg-kyel text-ink' : 'bg-board text-mute opacity-70 cursor-not-allowed'
                              }`}
                            >
                              <ArrowUpCircle className="w-4 h-4" />
                              Sv.{next.level} terfi · ₺{next.upgradeCost.toLocaleString('tr-TR')}
                            </button>
                          ) : (
                            <span className="k-label">MAKS · Sv.{MANAGER_MAX_LEVEL}</span>
                          )}
                          <button
                            onClick={fireManager}
                            className="game-btn flex items-center gap-1 px-3 py-1.5 rounded-md font-display text-xs uppercase tracking-wide bg-kred text-white"
                          >
                            <Trash2 className="w-4 h-4" />
                            İşten Çıkar
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] text-mute leading-relaxed">
                        <b className="text-ink">{tier.tourSeconds} sn'de bir tur</b> (
                        {managerConf.tiers.map((t) => `Sv.${t.level} ${t.tourSeconds}`).join(' · ')}
                        ): {managerConf.tiers.map((t, i) => (
                          <span key={t.level}>
                            {i > 0 ? '; ' : ''}
                            <b className={t.level <= level ? 'text-ink' : 'text-mute'}>Sv.{t.level}</b>{' '}
                            {dutyLine(t, i > 0 ? managerConf.tiers[i - 1] : null)}
                          </span>
                        ))}
                        . Sen başka şubedeyken şubeyi işletir — günlük net kazancı kasana otomatik yazılır.
                        {next && (
                          <>
                            {' '}Terfi için itibar {next.minReputation.toFixed(2)} (
                            {gameState.player.reputation.toFixed(2)}).
                          </>
                        )}
                      </div>
                    </div>

                    <div className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-3">
                      <span className="k-label">Müdüre talimat — neyi yapsın, ne zaman sipariş versin</span>
                      <div className="flex flex-wrap gap-2">
                        {MANAGER_DUTIES.map((duty) => {
                          const unlocked = dutyUnlocked(gameState, duty);
                          const on = dutyEnabled(settings, duty);
                          return (
                            <button
                              key={duty}
                              disabled={!unlocked}
                              title={
                                unlocked
                                  ? DUTY_LABEL[duty].hint
                                  : `Sv.${dutyMinLevel(duty)} müdürle açılır. ${DUTY_LABEL[duty].hint}`
                              }
                              onClick={() =>
                                updateManagerSettings({ [MANAGER_DUTY_SETTING[duty]]: !on })
                              }
                              className={chip(on, !unlocked)}
                            >
                              {unlocked ? (
                                on ? <Check className="w-3.5 h-3.5" /> : null
                              ) : (
                                <Lock className="w-3.5 h-3.5" />
                              )}
                              {DUTY_LABEL[duty].label}
                              {!unlocked && <span className="text-[10px]">Sv.{dutyMinLevel(duty)}</span>}
                            </button>
                          );
                        })}
                      </div>

                      <span className="k-label mt-1">Tank şu orana düşünce sipariş versin</span>
                      <div className="flex flex-wrap gap-2">
                        {allThresholds.map((pct) => {
                          const unlocked = tier.orderThresholds.includes(pct);
                          const on = settings.orderThresholdPercent === pct;
                          return (
                            <button
                              key={pct}
                              disabled={!unlocked}
                              title={unlocked ? `Tank %${pct} altına inince tanker çağırır.` : `Sv.${thresholdMinLevel(pct)} müdürle açılır.`}
                              onClick={() => updateManagerSettings({ orderThresholdPercent: pct })}
                              className={chip(on, !unlocked)}
                            >
                              {!unlocked && <Lock className="w-3.5 h-3.5" />}%{pct}
                            </button>
                          );
                        })}
                        <button
                          disabled={!tier.canFillTank}
                          title={
                            tier.canFillTank
                              ? 'Sipariş depoyu %100 doldurur; kapalıyken %90 hedefler.'
                              : `Sv.${fillMinLevel} müdürle açılır.`
                          }
                          onClick={() => updateManagerSettings({ orderTargetPercent: fillOn ? 90 : 100 })}
                          className={chip(fillOn, !tier.canFillTank)}
                        >
                          {tier.canFillTank ? (fillOn ? <Check className="w-3.5 h-3.5" /> : null) : <Lock className="w-3.5 h-3.5" />}
                          Depoyu FULLE
                        </button>
                      </div>
                      <div className="text-[11px] text-mute">
                        Şu an: tank %{settings.orderThresholdPercent} altına inince %{settings.orderTargetPercent} seviyesine kadar
                        sipariş. Pompa bakımı sağlık %{settings.minHealthThreshold} altına inince.
                        {dutyUnlocked(gameState, 'nightGridFill') && (
                          <>
                            {' '}Gece tarifesi {GAME_CONFIG.ev.gridTariff.night.from}:00–{GAME_CONFIG.ev.gridTariff.night.to}:00,
                            batarya %{GAME_CONFIG.ev.nightFillFloorPercent} altına inerse saate bakmadan doldurur.
                          </>
                        )}
                      </div>
                    </div>

                    <div className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="font-display text-base text-ink">Kasa Rezervi Güvencesi</span>
                        <span className="font-display tabular-nums text-kgrn">
                          ₺{settings.kasaReserve.toLocaleString('tr-TR')}
                        </span>
                      </div>
                      <div className="text-[11px] text-mute">
                        Müdür yapacağı hiçbir harcamada — sipariş, bakım, tamir — kasanı bu tutarın altına düşüremez.
                        Günün maaşları ve kredi taksitleri de bütçeden önce ayrılır.
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        )}
      </div>
    </div>
  );
};
