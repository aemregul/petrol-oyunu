import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG, ATTENDANT_HIRE_LEVEL } from '../../config/gameConfig';
import { X, Users, UserCheck, Shield, Sliders, CheckCircle2, AlertCircle, ArrowUpCircle, Trash2, Check, Lock } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import { openTabs } from '../lessons/openTabs';
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
  // The open tab, for a lesson that teaches each tab the first time it is shown.
  useEffect(() => {
    openTabs.staff = activeTab;
    return () => {
      openTabs.staff = null;
    };
  }, [activeTab]);

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
        <div className="flex border-b-2 border-ink p-2 gap-2 bg-board" data-tour="staff-tabs">
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
            data-tour="staff-tab-manager"
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
            <div data-tour="staff-hire" className="bg-board border-2 border-ink rounded-md p-4 flex justify-between items-center">
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
                disabled={gameState.player.level < ATTENDANT_HIRE_LEVEL || gameState.player.cash < recruit.hireCost}
                className={`game-btn px-5 py-2.5 rounded-md font-display tracking-wide text-xs uppercase ${
                  gameState.player.level < ATTENDANT_HIRE_LEVEL || gameState.player.cash < recruit.hireCost
                    ? 'bg-card text-mute cursor-not-allowed'
                    : 'bg-kgrn hover:bg-kgrn-dark text-white'
                }`}
              >
                {gameState.player.level < ATTENDANT_HIRE_LEVEL
                  ? `Seviye ${ATTENDANT_HIRE_LEVEL} Gerekli`
                  : `İşe Al (₺${lira(recruit.hireCost)})`}
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

                  // Every card is the same four rows in the same order, whatever the
                  // level — name, figures, post, next step — so two attendants read
                  // as two lines of one table, not two different forms (Emre,
                  // 2026-09-10: "kutular eşit şekilde alt alta değil").
                  const speedNow = Math.round(currentTier.speedMultiplier * 100);
                  const progress = nextTier
                    ? Math.min(100, Math.round((emp.serviceCount / Math.max(1, nextTier.requiredServices || 1)) * 100))
                    : 100;

                  return (
                    <div
                      key={emp.id}
                      className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-3"
                    >
                      {/* 1 — Name, level, and the one destructive action, right. */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-display text-base text-ink truncate">{emp.name}</span>
                          <span className="bg-kblu text-white text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-ink whitespace-nowrap">
                            Seviye {emp.level}
                          </span>
                          {emp.level === 3 && (
                            <span className="bg-kyel text-ink text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-ink whitespace-nowrap">
                              ⭐ USTA
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => fireAttendant(emp.id)}
                          title="İşten Çıkar"
                          className="game-btn p-2 rounded-md bg-kred hover:bg-kred-dark text-white flex items-center justify-center shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* 2 — Four equal figures. */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { label: 'Maaş', value: `₺${emp.wage.toLocaleString('tr-TR')}/gün`, tone: 'text-ink' },
                          { label: 'Hizmet', value: String(emp.serviceCount), tone: 'text-ink' },
                          { label: 'Dolum hızı', value: `%${speedNow}`, tone: 'text-kgrn' },
                          { label: 'Tepki', value: `${currentTier.actionDelaySeconds}s`, tone: 'text-kblu' }
                        ].map((cell) => (
                          <div key={cell.label} className="bg-paper border-2 border-ink rounded-md px-3 py-2">
                            <div className="k-label">{cell.label}</div>
                            <div className={`font-display font-extrabold text-[15px] tabular-nums ${cell.tone}`}>
                              {cell.value}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* 3 — Where they stand: one chip per bay, the one they are on
                          lit, plus "Boşta". A native select looked like a form on a
                          card (Emre, 2026-09-09). */}
                      <div data-tour="staff-post" className="flex items-center gap-3">
                        <span className="k-label w-20 shrink-0">Görev yeri</span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => assignAttendantToPump(emp.id, null)}
                            className={`game-btn px-2.5 py-1.5 rounded-md font-display text-xs tracking-wide ${
                              emp.assignedPumpId ? 'bg-paper text-ink hover:bg-card' : 'bg-kyel text-ink'
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
                                      ? 'bg-paper text-mute opacity-60 cursor-not-allowed'
                                      : 'bg-paper text-ink hover:bg-card'
                                }`}
                              >
                                {pumpName(gameState, p)}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 4 — The next step, in the same slot on every card: what the
                          next grade brings, how far along the attendant is, and the
                          one button that buys it. At the top grade the slot says so
                          instead of vanishing, so the cards keep one shape. */}
                      <div data-tour="staff-train" className="flex items-center gap-3 bg-paper border-2 border-ink rounded-md px-3 py-2">
                        <span className="k-label w-20 shrink-0">
                          {nextTier ? `Seviye ${nextTier.level}` : 'Usta'}
                        </span>
                        {nextTier ? (
                          <>
                            <div className="flex-1 min-w-0 flex flex-col gap-1">
                              <div className="text-xs font-mono text-ink flex flex-wrap gap-x-3">
                                <span>
                                  Dolum <span className="text-kgrn font-bold">%{speedNow} → %{Math.round(nextTier.speedMultiplier * 100)}</span>
                                </span>
                                <span>
                                  Tepki <span className="text-kblu font-bold">{currentTier.actionDelaySeconds}s → {nextTier.actionDelaySeconds}s</span>
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="k-bar flex-1">
                                  <i className={hasEnoughServices ? 'bg-kgrn' : 'bg-kyel'} style={{ width: `${progress}%` }} />
                                </div>
                                <span className={`text-[11px] font-mono tabular-nums whitespace-nowrap ${hasEnoughServices ? 'text-kgrn font-bold' : 'text-mute'}`}>
                                  {emp.serviceCount}/{nextTier.requiredServices} hizmet
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => upgradeAttendant(emp.id)}
                              disabled={!hasEnoughServices || !hasEnoughCash}
                              title={
                                !hasEnoughServices
                                  ? 'Önce yeterli hizmet sayısına ulaşmalı'
                                  : !hasEnoughCash
                                    ? 'Kasa yetmiyor'
                                    : 'Bir üst seviyeye eğit'
                              }
                              className={`game-btn text-xs font-display tracking-wide px-3 py-2 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                                hasEnoughServices && hasEnoughCash
                                  ? 'bg-kblu hover:bg-kblu-dark text-white'
                                  : 'bg-card text-mute cursor-not-allowed'
                              }`}
                            >
                              <ArrowUpCircle className="w-3.5 h-3.5" />
                              <span>Eğit — ₺{nextTier.hireCost.toLocaleString('tr-TR')}</span>
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-ink">
                            En yüksek seviye — dolum <span className="text-kgrn font-bold">%{speedNow}</span>, tepki{' '}
                            <span className="text-kblu font-bold">{currentTier.actionDelaySeconds}s</span>.
                          </span>
                        )}
                      </div>
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
              // Hiring: what the job is in one line, then the five conditions
              // as one table — label left, where you stand right, a tick or a
              // cross — and the one button. It used to be a paragraph and a
              // two-column scatter of "(x/y)" fragments (Emre, 2026-09-10).
              (() => {
                const cash = gameState.player.cash;
                const rows: Array<{ label: string; value: string; met: boolean }> = [
                  {
                    label: 'Oyuncu seviyesi',
                    value: `${gameState.player.level} / ${managerConf.minLevel}`,
                    met: gameState.player.level >= managerConf.minLevel
                  },
                  {
                    label: 'İstasyon itibarı',
                    value: `${gameState.player.reputation.toFixed(2)} / ${managerConf.minReputation.toFixed(2)}`,
                    met: gameState.player.reputation >= managerConf.minReputation
                  },
                  {
                    label: 'Aktif pompacı',
                    value: `${attendants.length} / ${managerConf.minActiveAttendants}`,
                    met: attendants.length >= managerConf.minActiveAttendants
                  },
                  {
                    label: 'Son 3 günde kârlı gün',
                    value:
                      recentProfits.length < 3
                        ? `${profitableDays} / ${managerConf.minProfitableDaysInLast3} · ${recentProfits.length}/3 gün veri`
                        : `${profitableDays} / ${managerConf.minProfitableDaysInLast3}`,
                    met: profitBarMet
                  },
                  {
                    label: 'İşe alım bedeli',
                    value: `₺${lira(managerConf.hireCost)} · kasa ₺${lira(Math.round(cash))}`,
                    met: cash >= managerConf.hireCost
                  }
                ];
                const allMet = rows.every((r) => r.met);

                return (
                  <div className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-kblu" />
                      <span className="font-display text-base text-ink">İstasyon Müdürü İşe Al</span>
                    </div>
                    <div className="text-xs text-mute">
                      Belirlediğin kasa rezervine dokunmadan istasyonu tur tur dolaşır: kasaları toplar, yakıt
                      sipariş eder, pompacı atar, bakım yaptırır. Seviyesi yükseldikçe görevleri artar.
                    </div>

                    <div data-tour="manager-requirements" className="bg-paper border-2 border-ink rounded-md px-3">
                      {rows.map((r) => (
                        <div key={r.label} className="k-row last:border-b-0">
                          <span className="flex items-center gap-2">
                            {r.met ? (
                              <CheckCircle2 className="w-4 h-4 text-kgrn shrink-0" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-kred shrink-0" />
                            )}
                            {r.label}
                          </span>
                          <span className={r.met ? 'text-kgrn' : 'text-ink'}>{r.value}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      data-tour="manager-hire"
                      onClick={hireManager}
                      disabled={!allMet}
                      title={allMet ? 'Müdürü göreve başlat' : 'Eksik şartlar kırmızı işaretli'}
                      className={`game-btn w-full py-3.5 rounded-md font-display tracking-wide text-sm uppercase ${
                        allMet ? 'bg-kgrn hover:bg-kgrn-dark text-white' : 'bg-card text-mute cursor-not-allowed'
                      }`}
                    >
                      Müdürü Göreve Başlat — ₺{lira(managerConf.hireCost)}
                    </button>
                  </div>
                );
              })()
            ) : (
              // The manager's card, in the same four rows as an attendant's:
              // name and grade, four figures, the next grade, the job as
              // toggles. One shape for everyone on the payroll.
              (() => {
                const level = managerLevel(gameState);
                const tier = managerTier(gameState);
                const next = level < MANAGER_MAX_LEVEL ? managerTierAt(level + 1) : null;
                const settings = gameState.managerSettings;
                const repOk = !!next && gameState.player.reputation >= next.minReputation;
                const cashOk = !!next && gameState.player.cash >= next.upgradeCost;
                const canPromote = repOk && cashOk;
                const allThresholds = managerTierAt(MANAGER_MAX_LEVEL).orderThresholds;
                const thresholdMinLevel = (pct: number) =>
                  managerConf.tiers.find((t) => t.orderThresholds.includes(pct))?.level ?? MANAGER_MAX_LEVEL;
                const fillMinLevel =
                  managerConf.tiers.find((t) => t.canFillTank)?.level ?? MANAGER_MAX_LEVEL;
                const fillOn = settings.orderTargetPercent >= 100;
                const chip = (on: boolean, locked: boolean) =>
                  `game-btn flex items-center justify-center gap-1.5 border-2 border-ink rounded-md px-3 py-1.5 font-display text-xs tracking-wide ${
                    locked
                      ? 'bg-paper text-mute opacity-70 cursor-not-allowed'
                      : on
                        ? 'bg-kgrn text-white'
                        : 'bg-paper text-ink hover:bg-card'
                  }`;
                const gained = next
                  ? next.duties
                      .filter((d) => !tier.duties.includes(d))
                      .map((d) => DUTY_LABEL[d].label.toLowerCase())
                      .join(', ')
                  : '';
                const cells = [
                  { label: 'Yevmiye', value: `₺${tier.dailyWage.toLocaleString('tr-TR')}/gün`, tone: 'text-ink' },
                  { label: 'Tur süresi', value: `${tier.tourSeconds} sn`, tone: 'text-kblu' },
                  { label: 'İtibar', value: gameState.player.reputation.toFixed(2), tone: 'text-ink' },
                  { label: 'Kasa rezervi', value: `₺${settings.kasaReserve.toLocaleString('tr-TR')}`, tone: 'text-kgrn' }
                ];

                return (
                  <div className="flex flex-col gap-4">
                    <div className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-3">
                      {/* 1 — Who, what grade; the one destructive action, right. */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Shield className="w-5 h-5 text-kblu shrink-0" />
                          <span className="font-display text-base text-ink truncate">İstasyon Müdürü</span>
                          <span className="bg-kblu text-white text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-ink whitespace-nowrap">
                            Seviye {level}
                          </span>
                          {!next && (
                            <span className="bg-kyel text-ink text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-ink whitespace-nowrap">
                              ⭐ MAKS
                            </span>
                          )}
                        </div>
                        <button
                          onClick={fireManager}
                          title="İşten Çıkar"
                          className="game-btn p-2 rounded-md bg-kred hover:bg-kred-dark text-white flex items-center justify-center shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* 2 — Four equal figures. */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {cells.map((cell) => (
                          <div key={cell.label} className="bg-paper border-2 border-ink rounded-md px-3 py-2">
                            <div className="k-label">{cell.label}</div>
                            <div className={`font-display font-extrabold text-[15px] tabular-nums ${cell.tone}`}>
                              {cell.value}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* 3 — The next grade, in the same slot as an attendant's. */}
                      <div className="flex items-center gap-3 bg-paper border-2 border-ink rounded-md px-3 py-2">
                        <span className="k-label w-20 shrink-0">{next ? `Seviye ${next.level}` : 'Maks'}</span>
                        {next ? (
                          <>
                            <div className="flex-1 min-w-0 text-xs font-mono text-ink flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>
                                Tur <span className="text-kblu font-bold">{tier.tourSeconds} → {next.tourSeconds} sn</span>
                              </span>
                              <span>
                                Yevmiye <span className="font-bold">₺{next.dailyWage.toLocaleString('tr-TR')}/gün</span>
                              </span>
                              {gained && (
                                <span>
                                  Yeni görev <span className="text-kgrn font-bold">{gained}</span>
                                </span>
                              )}
                              <span className={repOk ? 'text-kgrn' : 'text-kred'}>
                                İtibar {gameState.player.reputation.toFixed(2)} / {next.minReputation.toFixed(2)}
                              </span>
                            </div>
                            <button
                              onClick={upgradeManager}
                              disabled={!canPromote}
                              title={
                                canPromote
                                  ? 'Bir üst seviyeye terfi ettir'
                                  : !repOk
                                    ? `İtibar ${next.minReputation.toFixed(2)} gerekir`
                                    : 'Kasa yetmiyor'
                              }
                              className={`game-btn text-xs font-display tracking-wide px-3 py-2 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                                canPromote ? 'bg-kblu hover:bg-kblu-dark text-white' : 'bg-card text-mute cursor-not-allowed'
                              }`}
                            >
                              <ArrowUpCircle className="w-3.5 h-3.5" />
                              <span>Terfi — ₺{next.upgradeCost.toLocaleString('tr-TR')}</span>
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-ink">
                            En yüksek seviye — tur <span className="text-kblu font-bold">{tier.tourSeconds} sn</span>, bütün görevler açık.
                          </span>
                        )}
                      </div>
                    </div>

                    {/* The job: what to do, when to order, how much to keep back —
                        three labelled rows, chips in an even grid instead of a
                        wrap, and one line saying what the settings add up to. */}
                    <div className="bg-board border-2 border-ink rounded-md p-4 flex flex-col gap-3">
                      <div data-tour="manager-duties" className="flex items-start gap-3">
                        <span className="k-label w-20 shrink-0 pt-2">Görevler</span>
                        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                                onClick={() => updateManagerSettings({ [MANAGER_DUTY_SETTING[duty]]: !on })}
                                className={chip(on, !unlocked)}
                              >
                                {unlocked ? (
                                  on ? <Check className="w-3.5 h-3.5 shrink-0" /> : <span className="w-3.5" />
                                ) : (
                                  <Lock className="w-3.5 h-3.5 shrink-0" />
                                )}
                                <span className="truncate">{DUTY_LABEL[duty].label}</span>
                                {!unlocked && <span className="text-[10px] shrink-0">Sv.{dutyMinLevel(duty)}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div data-tour="manager-threshold" className="flex items-start gap-3">
                        <span className="k-label w-20 shrink-0 pt-2">Sipariş eşiği</span>
                        <div className="flex-1 flex flex-wrap gap-2">
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
                            Depoyu fulle
                          </button>
                        </div>
                      </div>

                      <div data-tour="manager-summary" className="flex items-start gap-3 bg-paper border-2 border-ink rounded-md px-3 py-2">
                        <span className="k-label w-20 shrink-0 pt-0.5">Özet</span>
                        <div className="text-xs text-ink leading-relaxed">
                          Tank <b>%{settings.orderThresholdPercent}</b> altına inince <b>%{settings.orderTargetPercent}</b>'e kadar sipariş ·
                          bakım sağlık <b>%{settings.minHealthThreshold}</b> altında
                          {dutyUnlocked(gameState, 'nightGridFill') && (
                            <>
                              {' '}· batarya gece tarifesinde ({GAME_CONFIG.ev.gridTariff.night.from}:00–{GAME_CONFIG.ev.gridTariff.night.to}:00),
                              %{GAME_CONFIG.ev.nightFillFloorPercent} altında hemen
                            </>
                          )}
                          {' '}· kasa <b>₺{settings.kasaReserve.toLocaleString('tr-TR')}</b> altına asla inmez; maaşlar ve taksitler
                          bütçeden önce ayrılır.
                        </div>
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
