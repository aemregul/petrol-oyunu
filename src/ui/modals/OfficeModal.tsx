import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GAME_CONFIG, upgradePathFor } from '../../config/gameConfig';
import { GameState } from '../../domain/types/gameState';
import { calculateEndOfDayReputation, calculateRepairCost } from '../../domain/formulas/economy';
import { solarCleanCost, solarCleanlinessOf } from '../../domain/services/energy';
import { Wrench, Droplets, Sun as SunIcon } from 'lucide-react';
import { stopChance, evPricePerKwh } from '../../domain/services/simulationEngine';
import { managerDailyWage } from '../../domain/services/managerDuties';
import { FuelType, MissionEntity } from '../../domain/types/gameState';
import { X, Fuel, Power, Move, Pencil, Check, Minus, Plus, Users, Landmark, CalendarDays, Star, Gift, ArrowLeft, CreditCard, Tag } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

type OfficeTab = 'summary' | 'price' | 'accounts' | 'missions' | 'maintenance';

const FUELS: FuelType[] = ['gasoline', 'diesel', 'lpg'];
const EV_KINDS: Array<'ac' | 'dc'> = ['ac', 'dc'];

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

  const wages =
    Object.values(state.employees).reduce((sum, e) => sum + e.wage, 0) + managerDailyWage(state);

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
  tone = 'text-ink'
}) => (
  // The value's colour sits on an inner span so a tone can beat k-row's own
  // ink without fighting its selector.
  <div className="k-row py-3">
    <span className="text-[15px]">{label}</span>
    <span>
      <span className={tone}>{value}</span>
    </span>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="k-label text-[11px] pt-4 pb-1 border-b-2 border-ink">
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
    className={`game-btn w-full py-3.5 font-display text-[17px] tracking-wide flex items-center justify-center gap-2.5 ${
      disabled
        ? 'bg-card text-mute'
        : tone === 'red'
          ? 'bg-kred hover:bg-kred-dark text-white'
          : 'bg-card hover:bg-board text-ink'
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
  <div className="flex items-center gap-3 py-3 border-b-2 border-dotted border-mute/60">
    <Icon className={`w-5 h-5 shrink-0 ${mission.completed ? 'text-kgrn' : 'text-mute'}`} />
    <div className="flex-1 min-w-0">
      <div className="text-[15px] font-extrabold text-ink truncate">{mission.description}</div>
      <div className="text-[13px] font-bold text-mute font-mono tabular-nums">
        {formatTarget(Math.min(mission.progress, mission.target))} / {formatTarget(mission.target)}
      </div>
    </div>
    {mission.completed ? (
      <button
        onClick={() => {
          sounds.playClick();
          onClaim();
        }}
        className="game-btn px-3.5 py-2 bg-kgrn hover:bg-kgrn-dark text-white text-[13px] font-display tracking-wide flex items-center gap-1.5 shrink-0"
      >
        <Gift className="w-4 h-4" />
        <span>+{lira(mission.rewardCash)}</span>
      </button>
    ) : (
      <span className="text-[15px] font-display tabular-nums text-kgrn shrink-0">
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
    <div className="flex items-center gap-3 pb-3 border-b-2 border-ink">
      <button
        onClick={onBack}
        className="game-btn bg-card text-ink w-10 h-10 rounded-md flex items-center justify-center"
        aria-label="Muhasebeye dön"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <div>
        <div className="k-label text-[11px]">Finans</div>
        <div className="font-display text-xl tracking-wide text-ink leading-tight">Krediler & Borç</div>
      </div>
    </div>

    {activeLoans.length > 0 && (
      <Section title="Açık Krediler">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
          {activeLoans.map((loan) => {
            const paid = Math.max(0, Math.min(1, 1 - loan.remaining / loan.totalDue));
            return (
              <div key={loan.id} className="bg-paper border-2 border-ink rounded-md p-4 shadow-k">
                <div className="flex justify-between items-start gap-3">
                  <span className="font-display text-base text-ink tracking-wide">{loan.name}</span>
                  <span className="text-[14px] font-display tabular-nums text-kred shrink-0">
                    {lira(loan.remaining)}
                  </span>
                </div>
                <div className="text-[12px] font-bold text-mute mt-1">
                  Günlük taksit {lira(loan.dailyPayment)}
                  {loan.missedCount > 0 ? ` · ${loan.missedCount} gecikme` : ''}
                </div>
                <div className="k-bar mt-3">
                  <div className="h-full bg-kgrn" style={{ width: `${paid * 100}%` }} />
                </div>
                <div className="text-[11px] font-bold text-mute mt-1 text-right">%{Math.round(paid * 100)} ödendi</div>
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
              className={`bg-paper border-2 border-ink rounded-md p-4 flex flex-col gap-3 shadow-k ${
                locked ? 'opacity-70' : ''
              }`}
            >
              <div className="flex justify-between items-start gap-3">
                <span className="font-display text-base text-ink tracking-wide">{loan.name}</span>
                <span className="text-[15px] font-display tabular-nums text-kgrn shrink-0">
                  {lira(loan.principal)}
                </span>
              </div>
              <div className="bg-board border-2 border-ink rounded-md p-3 grid grid-cols-2 gap-y-1.5 text-[12px] font-mono text-ink">
                <span>Vade: {loan.termDays} Gün</span>
                <span>Maliyet: %{Math.round(loan.totalCostRatio * 100)}</span>
                <span className="col-span-2">Günlük Taksit: {lira(loan.dailyPayment)}</span>
              </div>
              <div className="text-[11px] font-bold text-mute">
                Şartlar: Seviye {loan.minLevel} · {loan.minReputation.toFixed(1)} itibar
              </div>
              <button
                onClick={() => onTake(loan.id)}
                disabled={locked}
                className={`game-btn w-full py-3 text-[14px] font-display tracking-wide flex items-center justify-center gap-2 ${
                  locked
                    ? 'bg-card text-mute'
                    : 'bg-kgrn hover:bg-kgrn-dark text-white'
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
  const cleanStation = useGameStore((s) => s.cleanStation);
  const cleanSolarPanels = useGameStore((s) => s.cleanSolarPanels);
  const repairPump = useGameStore((s) => s.repairPump);
  const upgradeBuilding = useGameStore((s) => s.upgradeBuilding);
  const setFuelPrice = useGameStore((s) => s.setFuelPrice);
  const setEvPrice = useGameStore((s) => s.setEvPrice);
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
  const priceSign = Object.values(gameState.buildings).find((b) => b.type === 'price_sign');
  const priceSignUpgrade = priceSign
    ? GAME_CONFIG.buildingUpgrades[upgradePathFor('price_sign')]?.[priceSign.level + 1]
    : undefined;

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
    { id: 'maintenance', label: 'Bakım', onPick: () => setTab('maintenance') },
    { id: 'branches', label: 'Şubeler', onPick: () => undefined, soon: true }
  ];

  const adjustPrice = (fuelType: FuelType, delta: number) => {
    const pricing = gameState.pricing[fuelType];
    if (!pricing) return;
    sounds.playClick();
    setFuelPrice(fuelType, Math.max(10, pricing.playerPrice + delta), 'CUSTOM');
  };
  const installedChargers = {
    ac: Object.values(gameState.buildings).some((b) => b.type === 'ev_charger_ac'),
    dc: Object.values(gameState.buildings).some((b) => b.type === 'ev_charger_dc')
  };
  // How the board pulls custom against a plain station at the regional price.
  const customerFlow = Math.max(0, Math.round((stopChance(gameState, 'near') / 0.3) * 100));

  const t = gameState.dayState.todayStats;
  const todaySales = t.fuelRevenue + t.marketRevenue + t.tips;
  const todayProfit = todaySales - t.fuelCost - t.marketCost - t.repairs - (t.energyCost ?? 0);
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
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="k-head k-head-red shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-display text-xl tracking-wide">Ofis</span>
            {editingName === null ? (
              <button
                onClick={() => setEditingName(station.name)}
                title="İstasyon adını değiştir — tabelalar da güncellenir"
                className="ml-2 flex items-center gap-1.5 text-sm font-bold font-sans opacity-80 hover:opacity-100 transition-opacity"
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
                  className="bg-board border-2 border-ink rounded-md px-2 py-0.5 text-sm font-display text-ink w-44 outline-none"
                />
                <button onClick={commitName} title="Kaydet" className="game-btn bg-kgrn text-white w-7 h-7 rounded-md flex items-center justify-center">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditingName(null)} title="Vazgeç" className="game-btn bg-card text-ink w-7 h-7 rounded-md flex items-center justify-center">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleClose}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
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
                className={
                  active ? 'k-tab k-tab-on' : item.soon ? 'k-tab opacity-50 cursor-not-allowed' : 'k-tab'
                }
              >
                {item.label}
                {item.id === 'missions' && claimable > 0 && (
                  <span className="ml-1.5 inline-flex w-4 h-4 rounded-full bg-kgrn border border-ink text-white text-[10px] font-sans font-black items-center justify-center align-middle">
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
                <Row label="Aktif (varlık)" value={lira(figures.assets)} tone="text-kgrn" />
                <Row label="İşletme Sermayesi (stok)" value={lira(figures.stockValue)} />
                <Row label="Kasa" value={lira(figures.cash)} />
                <Row label="Günlük gider (yovmiye+OPEX+kredi)" value={lira(figures.dailyExpenses)} tone="text-kred" />
              </Section>

              <Section title="Müşteri & İtibar">
                <Row
                  label="Yakıt müşteri etkisi"
                  value={`${figures.customerEffect >= 0 ? '+' : ''}${figures.customerEffect}%`}
                  tone={figures.customerEffect >= 0 ? 'text-kgrn' : 'text-kred'}
                />
                <Row label="İtibar" value={`${player.reputation.toFixed(1)} / 5`} />
                <Row
                  label="Bugün servis / kaçan"
                  value={`${figures.served} / ${figures.failed}`}
                  tone={figures.failed > figures.served ? 'text-kred' : 'text-kgrn'}
                />
                <Row label="Gün sonu itibar hedefi" value={figures.reputationTarget.toFixed(1)} />
                <p className="text-[14px] font-semibold text-ink py-3 border-b-2 border-dotted border-mute/60">
                  {reputationNote}
                </p>
                <Row label="Toplam müşteri" value={player.statistics.totalCustomersServed} tone="text-kgrn" />
                <Row label="Kaçan müşteri" value={player.statistics.totalCustomersLost} />
              </Section>

              <Section title="Personel">
                <Row label="Pompacı" value={`${figures.attendants} / ${figures.pumps}`} />
                <Row label="Günlük yovmiye" value={lira(figures.wages)} tone="text-kred" />
              </Section>

              <Section title="Saha">
                <Row
                  label="Saha temizliği"
                  value={`%${Math.round(station.cleanliness)}`}
                  tone={station.cleanliness >= 70 ? 'text-kgrn' : station.cleanliness >= 40 ? 'text-kyel-dark' : 'text-kred'}
                />
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
                {/* Cleaning moved to the Bakım tab with the rest of the upkeep (Emre, 2026-09-09). */}
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
                    <div key={fuel} className="flex items-center gap-3 py-2.5 border-b-2 border-dotted border-mute/60">
                      <span className="text-[15px] font-display tracking-wide text-ink flex-1">{conf.shortName}</span>
                      <span
                        className={`text-[12px] font-bold font-mono tabular-nums ${
                          aboveRegion ? 'text-kred' : belowRegion ? 'text-kgrn' : 'text-mute'
                        }`}
                        title={`Alış ₺${pricing.todayWholesaleCost.toFixed(2)} · Bölge ₺${pricing.regionalAverage.toFixed(2)}`}
                      >
                        {pricing.todayWholesaleCost.toFixed(2)} {aboveRegion ? '▲' : belowRegion ? '▼' : '•'}
                      </span>
                      <button
                        onClick={() => adjustPrice(fuel, -0.1)}
                        className="game-btn bg-card hover:bg-board text-kred w-11 h-11 rounded-md flex items-center justify-center"
                        aria-label={`${conf.shortName} fiyatını düşür`}
                      >
                        <Minus className="w-5 h-5" />
                      </button>
                      <span className="w-24 h-11 rounded-md bg-board border-2 border-ink flex items-center justify-center text-[15px] font-display tabular-nums text-ink">
                        ₺{pricing.playerPrice.toFixed(2)}
                      </span>
                      <button
                        onClick={() => adjustPrice(fuel, 0.1)}
                        className="game-btn bg-card hover:bg-board text-kgrn w-11 h-11 rounded-md flex items-center justify-center"
                        aria-label={`${conf.shortName} fiyatını artır`}
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  );
                })}
                {/* The charging posts sell by the kWh and are priced here
                    too, once there is one to sell from (Emre, 2026-09-08).
                    The catalogue tariff stands in for the regional average;
                    the grid's daytime rate is what a kWh costs to buy. */}
                {EV_KINDS.filter((kind) => installedChargers[kind]).map((kind) => {
                  const price = evPricePerKwh(gameState, kind);
                  const listed = kind === 'dc' ? GAME_CONFIG.ev.dcPricePerKwh : GAME_CONFIG.ev.acPricePerKwh;
                  const above = price > listed + 0.005;
                  const below = price < listed - 0.005;
                  const label = kind === 'dc' ? 'DC Hızlı Şarj' : 'AC Şarj';
                  return (
                    <div key={kind} className="flex items-center gap-3 py-2.5 border-b-2 border-dotted border-mute/60">
                      <span className="text-[15px] font-display tracking-wide text-ink flex-1">
                        {label} <span className="text-[11px] text-mute">/kWh</span>
                      </span>
                      <span
                        className={`text-[12px] font-bold font-mono tabular-nums ${
                          above ? 'text-kred' : below ? 'text-kgrn' : 'text-mute'
                        }`}
                        title={`Şebeke gündüz ₺${GAME_CONFIG.ev.gridPricePerKwh.toFixed(2)} · Bölge ₺${listed.toFixed(2)}`}
                      >
                        {GAME_CONFIG.ev.gridPricePerKwh.toFixed(2)} {above ? '▲' : below ? '▼' : '•'}
                      </span>
                      <button
                        onClick={() => { sounds.playClick(); setEvPrice(kind, price - 0.5); }}
                        className="game-btn bg-card hover:bg-board text-kred w-11 h-11 rounded-md flex items-center justify-center"
                        aria-label={`${label} fiyatını düşür`}
                      >
                        <Minus className="w-5 h-5" />
                      </button>
                      <span className="w-24 h-11 rounded-md bg-board border-2 border-ink flex items-center justify-center text-[15px] font-display tabular-nums text-ink">
                        ₺{price.toFixed(2)}
                      </span>
                      <button
                        onClick={() => { sounds.playClick(); setEvPrice(kind, price + 0.5); }}
                        className="game-btn bg-card hover:bg-board text-kgrn w-11 h-11 rounded-md flex items-center justify-center"
                        aria-label={`${label} fiyatını artır`}
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  );
                })}
                <p className="text-[13px] font-bold text-kgrn text-center py-3 flex items-center justify-center gap-1.5">
                  <Users className="w-4 h-4" />
                  <span>Bu fiyatlarla müşteri akışı: %{customerFlow}</span>
                </p>
                <p className="text-[12px] font-semibold text-mute text-center pb-2">
                  Alış fiyatının yanındaki ok, satış fiyatının bölge ortalamasına göre yerini gösterir.
                </p>
              </Section>

              {/* The price board is a door into this tab, so its upgrade
                  lives here rather than on a card of its own. */}
              {priceSign && (
                <Section title="Fiyat Tabelası">
                  <Row label="Seviye" value={`Sv.${priceSign.level}`} />
                  {priceSignUpgrade ? (
                    <div className="pt-3">
                      <ActionButton
                        onClick={() => {
                          sounds.playClick();
                          upgradeBuilding(priceSign.id);
                        }}
                        icon={Tag}
                        label={`Tabela Sv.${priceSign.level + 1} — ${lira(priceSignUpgrade.cost)}`}
                        disabled={player.cash < priceSignUpgrade.cost}
                      />
                      <p className="text-[12px] font-semibold text-mute pt-2">{priceSignUpgrade.effectsDescription}</p>
                    </div>
                  ) : (
                    <p className="text-[12px] font-semibold text-mute py-2">Tabela son seviyede.</p>
                  )}
                </Section>
              )}
            </>
          ) : tab === 'maintenance' ? (
            // The maintenance desk (Emre, 2026-09-08): the forecourt, every
            // bay and every roof of panels on one page, each with what it
            // needs and what that costs, so nothing has to be hunted for
            // out on the plot.
            <>
              <Section title="Saha">
                <div className="flex items-center gap-3 py-3">
                  <span className="text-[15px] font-display text-ink flex-1">Temizlik</span>
                  <span className="k-bar w-28 h-2.5"><i style={{ width: `${Math.round(gameState.station.cleanliness)}%` }} className={gameState.station.cleanliness < 40 ? 'bg-kred' : 'bg-kgrn'} /></span>
                  <span className="font-display tabular-nums text-ink w-12 text-right">%{Math.round(gameState.station.cleanliness)}</span>
                  <button
                    onClick={() => { sounds.playClick(); cleanStation(); }}
                    disabled={gameState.station.cleanliness >= 100 || player.cash < GAME_CONFIG.economy.siteCleanCost}
                    className={`game-btn px-3 py-2 rounded-md font-display text-xs uppercase tracking-wide ${gameState.station.cleanliness >= 100 || player.cash < GAME_CONFIG.economy.siteCleanCost ? 'bg-card text-mute' : 'bg-kgrn text-white'}`}
                  >
                    Temizle · {lira(GAME_CONFIG.economy.siteCleanCost)}
                  </button>
                </div>
                <p className="text-[12px] font-semibold text-mute pb-2">Kirli saha müşteri memnuniyetini düşürür. Her temizlik +25 puan.</p>
              </Section>

              <Section title="Pompalar">
                {Object.values(gameState.pumps).map((pump) => {
                  const cost = calculateRepairCost(GAME_CONFIG.buildings.pump_standard.price, pump.health);
                  const broken = pump.state === 'BROKEN';
                  const fine = pump.health >= 99.5;
                  return (
                    <div key={pump.id} className="flex items-center gap-3 py-3 border-b-2 border-dotted border-mute/60">
                      <Wrench className={`w-4 h-4 shrink-0 ${broken ? 'text-kred' : pump.health < 40 ? 'text-kyel-dark' : 'text-mute'}`} />
                      <span className="text-[15px] font-display text-ink flex-1">
                        {pump.id}{broken ? <span className="text-kred text-xs font-black ml-2">ARIZALI</span> : null}
                      </span>
                      <span className="k-bar w-28 h-2.5"><i style={{ width: `${Math.round(pump.health)}%` }} className={broken || pump.health < 40 ? 'bg-kred' : 'bg-kgrn'} /></span>
                      <span className="font-display tabular-nums text-ink w-12 text-right">%{Math.round(pump.health)}</span>
                      <button
                        onClick={() => { sounds.playClick(); repairPump(pump.id); }}
                        disabled={fine || player.cash < cost}
                        className={`game-btn px-3 py-2 rounded-md font-display text-xs uppercase tracking-wide ${fine || player.cash < cost ? 'bg-card text-mute' : broken ? 'bg-kred text-white' : 'bg-kgrn text-white'}`}
                      >
                        {fine ? 'Sağlam' : `${broken ? 'Tamir' : 'Bakım'} · ${lira(cost)}`}
                      </button>
                    </div>
                  );
                })}
                <p className="text-[12px] font-semibold text-mute py-2">Sağlığı %25 altına düşen pompa arızalanabilir; arızalı pompa müşteri kaybettirir.</p>
              </Section>

              <Section title="Güneş Panelleri">
                {Object.values(gameState.pumps).filter((p) => p.hasCanopy && p.hasSolarCanopy).length === 0 ? (
                  <p className="text-[12px] font-semibold text-mute py-3">Güneşli sundurma yok. İnşaat → Enerji sekmesinden bir sundurmaya panel takılabilir.</p>
                ) : (
                  Object.values(gameState.pumps).filter((p) => p.hasCanopy && p.hasSolarCanopy).map((pump) => {
                    const clean = solarCleanlinessOf(pump);
                    const cost = solarCleanCost(GAME_CONFIG.buildings.canopy.size);
                    const spotless = clean >= 99;
                    return (
                      <div key={pump.id} className="flex items-center gap-3 py-3 border-b-2 border-dotted border-mute/60">
                        <SunIcon className={`w-4 h-4 shrink-0 ${clean < 50 ? 'text-kyel-dark' : 'text-mute'}`} />
                        <span className="text-[15px] font-display text-ink flex-1">{pump.id} çatısı</span>
                        <span className="k-bar w-28 h-2.5"><i style={{ width: `${Math.round(clean)}%` }} className={clean < 50 ? 'bg-kyel' : 'bg-kgrn'} /></span>
                        <span className="font-display tabular-nums text-ink w-12 text-right">%{Math.round(clean)}</span>
                        <button
                          onClick={() => { sounds.playClick(); cleanSolarPanels(pump.id); }}
                          disabled={spotless || player.cash < cost}
                          className={`game-btn px-3 py-2 rounded-md font-display text-xs uppercase tracking-wide flex items-center gap-1 ${spotless || player.cash < cost ? 'bg-card text-mute' : 'bg-kblu text-white'}`}
                        >
                          <Droplets className="w-3.5 h-3.5" />
                          {spotless ? 'Temiz' : `Yıka · ${lira(cost)}`}
                        </button>
                      </div>
                    );
                  })
                )}
                <p className="text-[12px] font-semibold text-mute py-2">
                  Kirli cam üretimi %{Math.round((1 - GAME_CONFIG.ev.solar.minGrimeFactor) * 100)} düşürür. Yağmur panelleri kısmen yıkar. Sv.2 müdür "Sahayı temizle" göreviyle yıkatabilir.
                </p>
              </Section>
            </>
          ) : tab === 'accounts' ? (
            <>
              <Section title="Satış & Faaliyet Kârı">
                <div className="grid grid-cols-3 k-label text-[11px] pt-2 pb-1">
                  <span>Dönem</span>
                  <span className="text-right">Satış</span>
                  <span className="text-right">Faaliyet Kârı</span>
                </div>
                <div className="grid grid-cols-3 py-2.5 border-b-2 border-dotted border-mute/60 text-[15px] font-extrabold font-mono tabular-nums text-ink">
                  <span className="font-sans text-ink">Günlük</span>
                  <span className="text-right text-ink">{lira(todaySales)}</span>
                  <span className={`text-right ${todayProfit >= 0 ? 'text-kgrn' : 'text-kred'}`}>{lira(todayProfit)}</span>
                </div>
                <div className="grid grid-cols-3 py-2.5 border-b-2 border-dotted border-mute/60 text-[15px] font-extrabold font-mono tabular-nums text-ink">
                  <span className="font-sans text-ink">Son 3 gün</span>
                  <span className="text-right text-mute">—</span>
                  <span className={`text-right ${recent.reduce((a, b) => a + b, 0) >= 0 ? 'text-kgrn' : 'text-kred'}`}>
                    {recent.length > 0 ? lira(recent.reduce((a, b) => a + b, 0)) : '—'}
                  </span>
                </div>
                <div className="grid grid-cols-3 py-2.5 border-b-2 border-dotted border-mute/60 text-[15px] font-extrabold font-mono tabular-nums text-ink">
                  <span className="font-sans text-ink">Toplam</span>
                  <span className="text-right text-ink">{lira(player.statistics.totalRevenue)}</span>
                  <span className="text-right text-mute">—</span>
                </div>
                <Row label="Tesis kasalarında bekleyen" value={lira(figures.tills)} tone="text-kyel-dark" />
                {(t.energyCost ?? 0) > 0 && (
                  <Row label="Bugünkü enerji (şebeke + jeneratör)" value={lira(t.energyCost ?? 0)} tone="text-kred" />
                )}
                {(t.solarKwh ?? 0) > 0 && (
                  <Row label="Bugünkü güneş üretimi" value={`${Math.round(t.solarKwh ?? 0)} kWh`} tone="text-kyel-dark" />
                )}
                {(t.generatorLiters ?? 0) > 0 && (
                  <Row
                    label="Jeneratörün yaktığı mazot"
                    value={`${Math.round(t.generatorLiters ?? 0)} L → ${Math.round(t.generatorKwh ?? 0)} kWh`}
                    tone="text-kyel-dark"
                  />
                )}
                <Row label="Tamamlanan gün" value={player.statistics.daysCompleted} />
              </Section>

              <Section title="Yakıt Alım Geçmişi">
                {purchases.length === 0 ? (
                  <p className="text-[14px] font-semibold text-mute py-3">Henüz yakıt siparişi verilmedi.</p>
                ) : (
                  purchases.map((p) => (
                    <div key={p.id} className="flex justify-between items-center py-2.5 border-b-2 border-dotted border-mute/60 gap-4">
                      <span className="text-[13px] font-semibold text-mute truncate">
                        Gün {p.day} · {p.liters.toLocaleString('tr-TR')} L {GAME_CONFIG.fuels[p.fuelType]?.shortName ?? p.fuelType}
                      </span>
                      <span className="text-[14px] font-extrabold font-mono tabular-nums text-kred shrink-0">
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
                  className="game-btn w-full py-3.5 font-display text-[17px] tracking-wide flex items-center justify-center gap-2.5 bg-kblu hover:bg-kblu-dark text-white"
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
                  <p className="text-[14px] font-semibold text-mute py-3">Bugün için görev yok; yarın sabah yenileri gelir.</p>
                ) : (
                  dailies.map((mission) => <MissionRow key={mission.id} mission={mission} icon={CalendarDays} onClaim={() => claimMissionReward(mission.id)} />)
                )}
                <p className="text-[13px] font-semibold text-mute py-3">
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
