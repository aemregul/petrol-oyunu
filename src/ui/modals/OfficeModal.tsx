import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG } from '../../config/gameConfig';
import { GameState } from '../../domain/types/gameState';
import { calculateEndOfDayReputation } from '../../domain/formulas/economy';
import { stopChance } from '../../domain/services/simulationEngine';
import { FuelType, MissionEntity } from '../../domain/types/gameState';
import { X, Fuel, Power, Move, Pencil, Check, Minus, Plus, Users, Landmark, CalendarDays, Star, Gift, ArrowLeft, CreditCard } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

type OfficeTab = 'summary' | 'price' | 'accounts' | 'missions';

const FUELS: FuelType[] = ['gasoline', 'diesel', 'lpg'];

function formatTarget(value: number): string {
  return value >= 1000 ? value.toLocaleString('tr-TR') : `${Math.round(value * 10) / 10}`;
}

/**
 * The office's books, in the figures the summary card shows. Kept as pure
 * arithmetic over the state so the card's numbers can be pinned in a test,
 * and so the day-end settlement and the card agree on what a day costs.
 */
export function officeFigures(state: GameState) {
  const stockValue = Object.values(state.tanks).reduce(
    (sum, tank) => sum + tank.stock * tank.averageCost,
    0
  );
  const tills = Object.values(state.buildings).reduce((sum, b) => sum + (b.till ?? 0), 0);

  const managerWage = state.station.managerId ? GAME_CONFIG.employees.manager.dailyWage : 0;
  const wages =
    Object.values(state.employees).reduce((sum, e) => sum + e.wage, 0) + managerWage;

  let upkeep = 0;
  for (const pump of Object.values(state.pumps)) {
    upkeep += GAME_CONFIG.buildings.pump_standard.dailyUpkeep + (pump.level - 1) * 40;
    if (pump.hasCanopy) upkeep += GAME_CONFIG.buildings.canopy.dailyUpkeep;
  }
  for (const building of Object.values(state.buildings)) {
    upkeep += GAME_CONFIG.buildings[building.type]?.dailyUpkeep ?? 0;
  }
  const loans = state.loans
    .filter((l) => l.state === 'ACTIVE')
    .reduce((sum, l) => sum + Math.min(l.dailyPayment, l.remaining), 0);

  // What the day's service so far would do to the name at closing time —
  // the same sums the settlement runs, on today's figures.
  const t = state.dayState.todayStats;
  const served = t.customersServed;
  const failed = t.customersLost;
  const avgScore = served > 0 ? t.serviceScoreSum / served : 60;
  const tookOn = served + failed;
  const lostPenalty = tookOn > 0 ? Math.min(0.35, (failed / tookOn) * 0.6) : 0;
  const reputationTarget = calculateEndOfDayReputation(
    state.player.reputation,
    avgScore,
    -lostPenalty
  );

  // How the board and the name are pulling custom, against a plain station
  // at the regional price with a middling name.
  const customerEffect = Math.round((stopChance(state, 'near') / 0.3 - 1) * 100);

  const pumps = Object.keys(state.pumps).length;
  const attendants = Object.values(state.employees).filter(
    (e) => e.role === 'PUMP_ATTENDANT'
  ).length;
  const unmanned = Object.values(state.pumps).filter(
    (p) =>
      !Object.values(state.employees).some(
        (e) => e.role === 'PUMP_ATTENDANT' && e.assignedPumpId === p.id
      )
  ).length;

  return {
    cash: state.player.cash,
    stockValue: Math.round(stockValue),
    tills: Math.round(tills),
    assets: Math.round(state.player.cash + stockValue + tills),
    dailyExpenses: Math.round(wages + upkeep + loans),
    wages: Math.round(wages),
    customerEffect,
    reputationTarget,
    served,
    failed,
    pumps,
    attendants,
    unmanned,
    hireAllCost: unmanned * GAME_CONFIG.employees.pumpAttendant.tierLevels[0].hireCost
  };
}

const lira = (n: number) => `₺${Math.round(n).toLocaleString('tr-TR')}`;

const Row: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({
  label,
  value,
  tone = 'text-white'
}) => (
  <div className="flex justify-between items-center py-3 border-b border-white/10">
    <span className="text-[15px] font-bold text-slate-400">{label}</span>
    <span className={`text-[15px] font-extrabold font-mono tabular-nums ${tone}`}>{value}</span>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-slate-400 pt-4 pb-1 border-b border-white/10">
      {title}
    </div>
    {children}
  </div>
);

const ActionButton: React.FC<{
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  disabled?: boolean;
  tone?: 'plain' | 'red';
}> = ({ onClick, icon: Icon, label, disabled, tone = 'plain' }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full py-4 rounded-2xl font-extrabold text-[17px] flex items-center justify-center gap-2.5 transition-all border ${
      disabled
        ? 'bg-[#2a2427] border-white/5 text-slate-500 cursor-not-allowed'
        : tone === 'red'
          ? 'bg-[#d64b4b] hover:bg-[#c43f3f] border-red-300/30 text-white shadow-lg active:scale-[0.99]'
          : 'bg-[#2f292c] hover:bg-[#3a3337] border-white/10 text-white shadow-md active:scale-[0.99]'
    }`}
  >
    <Icon className="w-5 h-5" />
    <span>{label}</span>
  </button>
);

const MissionRow: React.FC<{
  mission: MissionEntity;
  icon: React.ElementType;
  onClaim: () => void;
}> = ({ mission, icon: Icon, onClaim }) => (
  <div className="flex items-center gap-3 py-3 border-b border-white/10">
    <Icon className={`w-5 h-5 shrink-0 ${mission.completed ? 'text-emerald-400' : 'text-slate-400'}`} />
    <div className="flex-1 min-w-0">
      <div className="text-[15px] font-extrabold text-white truncate">{mission.description}</div>
      <div className="text-[13px] font-bold text-slate-400 font-mono tabular-nums">
        {formatTarget(Math.min(mission.progress, mission.target))} / {formatTarget(mission.target)}
      </div>
    </div>
    {mission.completed ? (
      <button
        onClick={() => {
          sounds.playClick();
          onClaim();
        }}
        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[13px] font-extrabold flex items-center gap-1.5 shrink-0"
      >
        <Gift className="w-4 h-4" />
        <span>+{lira(mission.rewardCash)}</span>
      </button>
    ) : (
      <span className="text-[15px] font-extrabold font-mono tabular-nums text-emerald-400 shrink-0">
        +{lira(mission.rewardCash)}
      </span>
    )}
  </div>
);

/**
 * The loans desk: a page of its own inside the office card. Open loans on
 * top with what is left to pay; the packages below as cards, each with its
 * terms in a box and one button. Built to the look of the old bank screen
 * without being another screen.
 */
const LoansPage: React.FC<{
  activeLoans: GameState['loans'];
  level: number;
  reputation: number;
  onBack: () => void;
  onTake: (id: string) => void;
}> = ({ activeLoans, level, reputation, onBack, onTake }) => (
  <div className="pt-4">
    <div className="flex items-center gap-3 pb-3 border-b border-white/10">
      <button
        onClick={onBack}
        className="w-10 h-10 rounded-2xl bg-[#2f292c] border border-white/10 hover:bg-[#3a3337] text-slate-200 flex items-center justify-center"
        aria-label="Muhasebeye dön"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <div>
        <div className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-slate-400">Finans</div>
        <div className="text-lg font-black text-white leading-tight">Krediler & Borç</div>
      </div>
    </div>

    {activeLoans.length > 0 && (
      <Section title="Açık Krediler">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
          {activeLoans.map((loan) => {
            const paid = Math.max(0, Math.min(1, 1 - loan.remaining / loan.totalDue));
            return (
              <div key={loan.id} className="bg-[#2a2427] border border-white/10 rounded-2xl p-4">
                <div className="flex justify-between items-start gap-3">
                  <span className="text-[15px] font-extrabold text-white">{loan.name}</span>
                  <span className="text-[14px] font-extrabold font-mono tabular-nums text-rose-300 shrink-0">
                    {lira(loan.remaining)}
                  </span>
                </div>
                <div className="text-[12px] font-semibold text-slate-400 mt-1">
                  Günlük taksit {lira(loan.dailyPayment)}
                  {loan.missedCount > 0 ? ` · ${loan.missedCount} gecikme` : ''}
                </div>
                <div className="h-1.5 rounded-full bg-black/40 overflow-hidden mt-3">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paid * 100}%` }} />
                </div>
                <div className="text-[11px] font-bold text-slate-500 mt-1 text-right">%{Math.round(paid * 100)} ödendi</div>
              </div>
            );
          })}
        </div>
      </Section>
    )}

    <Section title="Kredi Paketleri">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
        {GAME_CONFIG.loans.map((loan) => {
          const levelOk = level >= loan.minLevel;
          const repOk = reputation >= loan.minReputation;
          const taken = activeLoans.some((l) => l.productId === loan.id);
          const locked = !levelOk || !repOk || taken;
          return (
            <div
              key={loan.id}
              className={`bg-[#2a2427] border rounded-2xl p-4 flex flex-col gap-3 ${
                locked ? 'border-white/10' : 'border-emerald-500/40'
              }`}
            >
              <div className="flex justify-between items-start gap-3">
                <span className="text-[15px] font-extrabold text-white">{loan.name}</span>
                <span className="text-[15px] font-extrabold font-mono tabular-nums text-emerald-400 shrink-0">
                  {lira(loan.principal)}
                </span>
              </div>
              <div className="bg-[#1a1618] border border-white/5 rounded-xl p-3 grid grid-cols-2 gap-y-1.5 text-[12px] font-mono text-slate-300">
                <span>Vade: {loan.termDays} Gün</span>
                <span>Maliyet: %{Math.round(loan.totalCostRatio * 100)}</span>
                <span className="col-span-2">Günlük Taksit: {lira(loan.dailyPayment)}</span>
              </div>
              <div className="text-[11px] font-semibold text-slate-500">
                Şartlar: Seviye {loan.minLevel} · {loan.minReputation.toFixed(1)} itibar
              </div>
              <button
                onClick={() => onTake(loan.id)}
                disabled={locked}
                className={`w-full py-3 rounded-2xl text-[14px] font-extrabold flex items-center justify-center gap-2 border transition-all ${
                  locked
                    ? 'bg-[#221d20] border-white/5 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-300/30 text-white shadow-lg'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span>{taken ? 'Bu kredi açık' : !levelOk || !repOk ? 'Kilitli' : 'Krediyi Kullan'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </Section>
  </div>
);

/**
 * The office: the station's books at a glance, and the three things the
 * player does from the desk — staff every pump, open or shut the doors, move
 * the office. Opens from the bottom bar and by clicking the office itself.
 * Laid out after the reference Emre gave (2026-09-07): one dark card,
 * tabbed, figures in rows, actions stacked underneath.
 */
export const OfficeModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const renameStation = useGameStore((s) => s.renameStation);
  const hirePumpAttendant = useGameStore((s) => s.hirePumpAttendant);
  const toggleStationOpen = useGameStore((s) => s.toggleStationOpen);
  const relocateStructure = useGameStore((s) => s.relocateStructure);
  const setFuelPrice = useGameStore((s) => s.setFuelPrice);
  const claimMissionReward = useGameStore((s) => s.claimMissionReward);

  const officeTab = useGameStore((s) => s.officeTab);
  const takeLoan = useGameStore((s) => s.takeLoan);
  const [tab, setTab] = useState<OfficeTab>(officeTab);
  // A page inside a tab: the loans desk sits behind Muhasebe rather than
  // spilling into it as a list (Emre, 2026-09-07). Same card, one level in.
  const [loansOpen, setLoansOpen] = useState(false);
  // A door that asks for a tab gets it even if the card is already open.
  useEffect(() => {
    setTab(officeTab);
    setLoansOpen(false);
  }, [officeTab]);
  const [editingName, setEditingName] = useState<string | null>(null);

  const { player, station } = gameState;
  const figures = officeFigures(gameState);
  const office = Object.values(gameState.buildings).find((b) => b.type === 'office');

  const commitName = () => {
    if (editingName !== null && renameStation(editingName)) setEditingName(null);
  };

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  const hireAll = () => {
    sounds.playClick();
    for (let i = 0; i < figures.unmanned; i++) {
      if (!hirePumpAttendant()) break;
    }
  };

  const moveOffice = () => {
    if (!office) return;
    sounds.playClick();
    setActiveModal('NONE');
    relocateStructure(office.id);
  };

  const tabs: Array<{ id: string; label: string; onPick: () => void; soon?: boolean }> = [
    { id: 'summary', label: 'Özet', onPick: () => setTab('summary') },
    { id: 'price', label: 'Fiyat', onPick: () => setTab('price') },
    { id: 'accounts', label: 'Muhasebe', onPick: () => setTab('accounts') },
    { id: 'tenders', label: 'İhaleler', onPick: () => undefined, soon: true },
    { id: 'missions', label: 'Görevler', onPick: () => setTab('missions') },
    { id: 'branches', label: 'Şubeler', onPick: () => undefined, soon: true }
  ];

  const adjustPrice = (fuelType: FuelType, delta: number) => {
    const pricing = gameState.pricing[fuelType];
    if (!pricing) return;
    sounds.playClick();
    setFuelPrice(fuelType, Math.max(10, pricing.playerPrice + delta), 'CUSTOM');
  };
  // How the board pulls custom against a plain station at the regional price.
  const customerFlow = Math.max(0, Math.round((stopChance(gameState, 'near') / 0.3) * 100));

  const t = gameState.dayState.todayStats;
  const todaySales = t.fuelRevenue + t.marketRevenue + t.tips;
  const todayProfit = todaySales - t.fuelCost - t.marketCost - t.repairs;
  const recent = player.statistics.recentNetProfits ?? [];
  const purchases = [...(gameState.fuelPurchaseHistory ?? [])].reverse().slice(0, 6);
  const activeLoans = gameState.loans.filter((l) => l.state === 'ACTIVE');

  const pending = gameState.missions.filter((m) => !m.claimed);
  const dailies = pending.filter((m) => m.type !== 'TUTORIAL');
  const goals = pending.filter((m) => m.type === 'TUTORIAL');
  const claimable = pending.filter((m) => m.completed).length;

  const quietDay = figures.served < 3;
  const reputationNote = quietDay
    ? `Bugün neredeyse hiç müşteri görmedin — itibar yavaşça ${figures.reputationTarget.toFixed(1)}'a doğru aşınır.`
    : figures.reputationTarget >= player.reputation
      ? `Bugünkü hizmet itibarı ${figures.reputationTarget.toFixed(1)}'a taşır.`
      : `Bugünkü kayıplar itibarı ${figures.reputationTarget.toFixed(1)}'a çeker.`;

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-[#231e21] border border-white/10 rounded-[2rem] w-full max-w-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-8 rounded-full bg-[#d64b4b]" />
            <span className="text-2xl font-black text-white">Ofis</span>
            {editingName === null ? (
              <button
                onClick={() => setEditingName(station.name)}
                title="İstasyon adını değiştir — tabelalar da güncellenir"
                className="ml-2 flex items-center gap-1.5 text-sm font-bold text-slate-400 hover:text-white transition-colors"
              >
                <span>{station.name}</span>
                <Pencil className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="ml-2 flex items-center gap-1.5">
                <input
                  autoFocus
                  value={editingName}
                  maxLength={24}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitName();
                    if (e.key === 'Escape') setEditingName(null);
                  }}
                  className="bg-black/40 border border-white/20 rounded-lg px-2 py-0.5 text-sm font-bold text-white w-44 outline-none focus:border-white/50"
                />
                <button onClick={commitName} title="Kaydet" className="w-7 h-7 rounded-lg bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 flex items-center justify-center">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditingName(null)} title="Vazgeç" className="w-7 h-7 rounded-lg bg-white/10 border border-white/10 text-slate-300 flex items-center justify-center">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleClose}
            className="w-11 h-11 rounded-2xl bg-[#2f292c] border border-white/10 hover:bg-[#3a3337] text-slate-200 flex items-center justify-center transition-colors"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-5 flex flex-wrap gap-2.5 shrink-0">
          {tabs.map((item) => {
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.soon) return;
                  sounds.playClick();
                  setLoansOpen(false);
                  item.onPick();
                }}
                disabled={item.soon}
                title={item.soon ? 'Yakında' : undefined}
                className={`px-4 py-2.5 rounded-2xl text-[14px] font-extrabold border transition-all ${
                  active
                    ? 'bg-[#f3ede9] text-[#231e21] border-white/40 shadow-inner'
                    : item.soon
                      ? 'bg-[#2a2427] text-slate-500 border-white/5 cursor-not-allowed'
                      : 'bg-[#2a2427] text-slate-300 border-white/10 hover:bg-[#362f33] hover:text-white'
                }`}
              >
                {item.label}
                {item.id === 'missions' && claimable > 0 && (
                  <span className="ml-1.5 inline-flex w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] items-center justify-center align-middle">
                    {claimable}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="px-6 pb-6 overflow-y-auto flex-1">
          {loansOpen ? (
            <LoansPage
              activeLoans={activeLoans}
              level={player.level}
              reputation={player.reputation}
              onBack={() => {
                sounds.playClick();
                setLoansOpen(false);
              }}
              onTake={(id) => {
                sounds.playClick();
                takeLoan(id);
              }}
            />
          ) : tab === 'summary' ? (
            <>
              <Section title="Finansal Durum">
                <Row label="Aktif (varlık)" value={lira(figures.assets)} tone="text-emerald-400" />
                <Row label="İşletme Sermayesi (stok)" value={lira(figures.stockValue)} />
                <Row label="Kasa" value={lira(figures.cash)} />
                <Row label="Günlük gider (yovmiye+OPEX+kredi)" value={lira(figures.dailyExpenses)} tone="text-rose-300" />
              </Section>

              <Section title="Müşteri & İtibar">
                <Row
                  label="Yakıt müşteri etkisi"
                  value={`${figures.customerEffect >= 0 ? '+' : ''}${figures.customerEffect}%`}
                  tone={figures.customerEffect >= 0 ? 'text-emerald-400' : 'text-rose-300'}
                />
                <Row label="İtibar" value={`${player.reputation.toFixed(1)} / 5`} />
                <Row
                  label="Bugün servis / kaçan"
                  value={`${figures.served} / ${figures.failed}`}
                  tone={figures.failed > figures.served ? 'text-rose-300' : 'text-emerald-400'}
                />
                <Row label="Gün sonu itibar hedefi" value={figures.reputationTarget.toFixed(1)} />
                <p className="text-[14px] font-semibold text-slate-300 py-3 border-b border-white/10">
                  {reputationNote}
                </p>
                <Row label="Toplam müşteri" value={player.statistics.totalCustomersServed} tone="text-emerald-400" />
                <Row label="Kaçan müşteri" value={player.statistics.totalCustomersLost} />
              </Section>

              <Section title="Personel">
                <Row label="Pompacı" value={`${figures.attendants} / ${figures.pumps}`} />
                <Row label="Günlük yovmiye" value={lira(figures.wages)} tone="text-rose-300" />
              </Section>

              <div className="flex flex-col gap-3 pt-5">
                <ActionButton
                  onClick={hireAll}
                  icon={Fuel}
                  label={
                    figures.unmanned > 0
                      ? `Tüm pompalara pompacı (${lira(figures.hireAllCost)})`
                      : 'Her pompada pompacı var'
                  }
                  disabled={figures.unmanned === 0 || player.cash < figures.hireAllCost}
                />
                <ActionButton
                  onClick={() => {
                    sounds.playClick();
                    toggleStationOpen();
                  }}
                  icon={Power}
                  label={station.open ? 'İstasyonu Kapat' : 'İstasyonu Aç'}
                  tone="red"
                />
                <ActionButton onClick={moveOffice} icon={Move} label="Ofisi Taşı" disabled={!office} />
              </div>
            </>
          ) : tab === 'price' ? (
            <>
              <Section title="Yakıt Satış Fiyatları">
                {FUELS.map((fuel) => {
                  const pricing = gameState.pricing[fuel];
                  const conf = GAME_CONFIG.fuels[fuel];
                  if (!pricing || !conf) return null;
                  const aboveRegion = pricing.playerPrice > pricing.regionalAverage + 0.005;
                  const belowRegion = pricing.playerPrice < pricing.regionalAverage - 0.005;
                  return (
                    <div key={fuel} className="flex items-center gap-3 py-2.5 border-b border-white/10">
                      <span className="text-[15px] font-bold text-white flex-1">{conf.shortName}</span>
                      <span
                        className={`text-[12px] font-bold font-mono tabular-nums ${
                          aboveRegion ? 'text-rose-300' : belowRegion ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                        title={`Alış ₺${pricing.todayWholesaleCost.toFixed(2)} · Bölge ₺${pricing.regionalAverage.toFixed(2)}`}
                      >
                        {pricing.todayWholesaleCost.toFixed(2)} {aboveRegion ? '▲' : belowRegion ? '▼' : '•'}
                      </span>
                      <button
                        onClick={() => adjustPrice(fuel, -0.1)}
                        className="w-11 h-11 rounded-2xl bg-[#2f292c] border border-white/10 hover:bg-[#3a3337] text-rose-400 flex items-center justify-center"
                        aria-label={`${conf.shortName} fiyatını düşür`}
                      >
                        <Minus className="w-5 h-5" />
                      </button>
                      <span className="w-24 h-11 rounded-2xl bg-[#1a1618] border border-white/10 flex items-center justify-center text-[15px] font-extrabold font-mono tabular-nums text-white">
                        ₺{pricing.playerPrice.toFixed(2)}
                      </span>
                      <button
                        onClick={() => adjustPrice(fuel, 0.1)}
                        className="w-11 h-11 rounded-2xl bg-[#2f292c] border border-white/10 hover:bg-[#3a3337] text-rose-400 flex items-center justify-center"
                        aria-label={`${conf.shortName} fiyatını artır`}
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  );
                })}
                <p className="text-[13px] font-bold text-emerald-400 text-center py-3 flex items-center justify-center gap-1.5">
                  <Users className="w-4 h-4" />
                  <span>Bu fiyatlarla müşteri akışı: %{customerFlow}</span>
                </p>
                <p className="text-[12px] font-semibold text-slate-500 text-center pb-2">
                  Alış fiyatının yanındaki ok, satış fiyatının bölge ortalamasına göre yerini gösterir.
                </p>
              </Section>
            </>
          ) : tab === 'accounts' ? (
            <>
              <Section title="Satış & Faaliyet Kârı">
                <div className="grid grid-cols-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 pt-2 pb-1">
                  <span>Dönem</span>
                  <span className="text-right">Satış</span>
                  <span className="text-right">Faaliyet Kârı</span>
                </div>
                <div className="grid grid-cols-3 py-2.5 border-b border-white/10 text-[15px] font-extrabold font-mono tabular-nums">
                  <span className="font-sans text-white">Günlük</span>
                  <span className="text-right text-white">{lira(todaySales)}</span>
                  <span className={`text-right ${todayProfit >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>{lira(todayProfit)}</span>
                </div>
                <div className="grid grid-cols-3 py-2.5 border-b border-white/10 text-[15px] font-extrabold font-mono tabular-nums">
                  <span className="font-sans text-white">Son 3 gün</span>
                  <span className="text-right text-slate-500">—</span>
                  <span className={`text-right ${recent.reduce((a, b) => a + b, 0) >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>
                    {recent.length > 0 ? lira(recent.reduce((a, b) => a + b, 0)) : '—'}
                  </span>
                </div>
                <div className="grid grid-cols-3 py-2.5 border-b border-white/10 text-[15px] font-extrabold font-mono tabular-nums">
                  <span className="font-sans text-white">Toplam</span>
                  <span className="text-right text-white">{lira(player.statistics.totalRevenue)}</span>
                  <span className="text-right text-slate-500">—</span>
                </div>
                <Row label="Tesis kasalarında bekleyen" value={lira(figures.tills)} tone="text-amber-300" />
                <Row label="Tamamlanan gün" value={player.statistics.daysCompleted} />
              </Section>

              <Section title="Yakıt Alım Geçmişi">
                {purchases.length === 0 ? (
                  <p className="text-[14px] font-semibold text-slate-400 py-3">Henüz yakıt siparişi verilmedi.</p>
                ) : (
                  purchases.map((p) => (
                    <div key={p.id} className="flex justify-between items-center py-2.5 border-b border-white/10 gap-4">
                      <span className="text-[13px] font-semibold text-slate-400 truncate">
                        Gün {p.day} · {p.liters.toLocaleString('tr-TR')} L {GAME_CONFIG.fuels[p.fuelType]?.shortName ?? p.fuelType}
                      </span>
                      <span className="text-[14px] font-extrabold font-mono tabular-nums text-rose-300 shrink-0">
                        −{lira(p.totalCost)}
                      </span>
                    </div>
                  ))
                )}
              </Section>

              <div className="pt-5">
                <button
                  onClick={() => {
                    sounds.playClick();
                    setLoansOpen(true);
                  }}
                  className="w-full py-4 rounded-2xl font-extrabold text-[17px] flex items-center justify-center gap-2.5 bg-[#1ea7c0] hover:bg-[#1993aa] border border-cyan-200/30 text-white shadow-lg active:scale-[0.99] transition-all"
                >
                  <Landmark className="w-5 h-5" />
                  <span>Krediler{activeLoans.length > 0 ? ` (${activeLoans.length} açık)` : ''}</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <Section title="Bugünün Görevleri">
                {dailies.length === 0 ? (
                  <p className="text-[14px] font-semibold text-slate-400 py-3">Bugün için görev yok; yarın sabah yenileri gelir.</p>
                ) : (
                  dailies.map((mission) => <MissionRow key={mission.id} mission={mission} icon={CalendarDays} onClaim={() => claimMissionReward(mission.id)} />)
                )}
                <p className="text-[13px] font-semibold text-slate-400 py-3">
                  Görevler her gün yenilenir. Ödül tamamlandığı anda kasaya geçer.
                </p>
              </Section>
              {goals.length > 0 && (
                <Section title="Sıradaki Hedefler">
                  {goals.map((mission) => <MissionRow key={mission.id} mission={mission} icon={Star} onClaim={() => claimMissionReward(mission.id)} />)}
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
