import React from 'react';
import { ArrowRight, X } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { dayReport } from '../../domain/services/dayReport';
import { DEPARTURE_GLYPHS } from '../../rendering/vehicleMood';

const lira = (n: number) => `₺${Math.round(n).toLocaleString('tr-TR')}`;
const cost = (n: number) => (Math.round(n) === 0 ? lira(0) : `−${lira(n)}`);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="min-w-0">
    <div className="k-label pt-2.5 pb-0.5 border-b-2 border-ink">{title}</div>
    {children}
  </div>
);

/** A figure row, tighter than the office's: the report is read at a glance. */
const Row: React.FC<{ label: string; value: React.ReactNode; tone?: string; strong?: boolean; hint?: string }> = ({
  label,
  value,
  tone = 'text-ink',
  strong,
  hint
}) => (
  <div className="k-row !py-0.5 !text-[12px] leading-tight" title={hint}>
    <span className={strong ? '!text-ink' : ''}>{label}</span>
    <span>
      <span className={`text-[13px] ${tone}`}>{value}</span>
    </span>
  </div>
);

const Tile: React.FC<{ label: string; value: React.ReactNode; note: string; tone?: string }> = ({
  label,
  value,
  note,
  tone = 'text-ink'
}) => (
  <div className="bg-card border-2 border-ink rounded-md px-2 py-1 min-w-0">
    <div className="k-label truncate">{label}</div>
    <div className={`font-display text-lg leading-tight tabular-nums ${tone}`}>{value}</div>
    <div className="text-[10px] font-semibold text-mute leading-tight truncate" title={note}>
      {note}
    </div>
  </div>
);

/**
 * The day-end report (players, 2026-09-13). Closing time settles the books and
 * stops the clock; this card says how the day went — the cars that came, the
 * ones served and the ones lost, what was earned against what it cost — and
 * the next morning starts from its button, never by itself. Closing the card
 * leaves the day stopped; the GÜN SONU button by the clock brings it back.
 * Kept compact (players, 2026-09-13): income and costs sit side by side so
 * the whole day reads without scrolling.
 */
export const DayReportModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const startNextDay = useGameStore((s) => s.startNextDay);

  const report = dayReport(gameState);
  const { income, expenses } = report;
  const net = Math.round(report.net);
  const dayOver = !gameState.dayState.isDayActive;
  const topLoss = report.lostBy[0];
  const { opening: repOpening, now: repNow } = report.reputation;

  return (
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        <div className="k-head k-head-blu shrink-0 !py-1.5">
          <div className="min-w-0">
            <div className="text-[10px] uppercase font-bold font-sans text-white/80 tracking-wider truncate">
              {gameState.station.name} · Gün sonu
            </div>
            <div className="font-display text-base leading-tight tracking-wide">Gün {report.day} Raporu</div>
          </div>
          <button
            onClick={() => setActiveModal('NONE')}
            className="game-btn bg-card text-ink w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            aria-label="Raporu kapat"
            title="Sahaya dön"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pb-3 overflow-y-auto flex-1">
          <Section title="Araçlar">
            <div className="grid grid-cols-4 gap-1.5 pt-2">
              <Tile label="Gelen" value={report.arrivals ?? '—'} tone="text-kblu" note="istasyona yönelen" />
              <Tile
                label="Hizmet"
                value={report.served + report.visited}
                tone="text-kgrn"
                note={report.visited > 0 ? `${report.served} yakıt · ${report.visited} tesis` : 'yakıt ve şarj'}
              />
              <Tile
                label="Kaybedilen"
                value={report.lost}
                tone={report.lost > 0 ? 'text-kred' : 'text-ink'}
                note="alamadan giden"
              />
              <Tile label="Sahada" value={report.stillHere} note="yarına devreder" />
            </div>
            {report.lostBy.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1.5">
                {report.lostBy.map(({ why, count }) => (
                  <span
                    key={why}
                    title={DEPARTURE_GLYPHS[why].hint}
                    className="bg-card border border-ink/40 rounded px-1.5 py-0.5 text-[11px] font-bold text-ink"
                  >
                    {DEPARTURE_GLYPHS[why].emoji} {DEPARTURE_GLYPHS[why].label}{' '}
                    <span className="text-kred tabular-nums">{count}</span>
                  </span>
                ))}
              </div>
            )}
            {topLoss && (
              <p className="text-[10px] font-semibold text-mute pt-1 leading-snug">{DEPARTURE_GLYPHS[topLoss.why].hint}</p>
            )}
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Section title="Gelir">
              <Row label="Akaryakıt ve şarj" value={lira(income.fuel)} />
              <Row label="Market ve tesisler" value={lira(income.market)} />
              <Row label="Bahşiş" value={lira(income.tips)} />
              <Row label="Toplam" value={lira(income.total)} tone="text-kgrn" strong />
              {report.averageScore !== null && (
                <Row label="Hizmet puanı" value={`${Math.round(report.averageScore)} / 100`} />
              )}
            </Section>

            <Section title="Gider">
              <Row label="Yakıt alış maliyeti" value={cost(expenses.fuel)} />
              {expenses.market > 0 && <Row label="Market maliyeti" value={cost(expenses.market)} />}
              <Row label="Maaşlar" value={cost(expenses.wages)} />
              <Row label="Bakım ve işletme" value={cost(expenses.upkeep)} />
              {expenses.energy > 0 && <Row label="Elektrik" value={cost(expenses.energy)} />}
              {expenses.repairs > 0 && <Row label="Tamir" value={cost(expenses.repairs)} />}
              {expenses.loans > 0 && <Row label="Kredi taksitleri" value={cost(expenses.loans)} />}
              <Row label="Toplam" value={cost(expenses.total)} tone="text-kred" strong />
            </Section>
          </div>

          <div
            className={`mt-2.5 flex items-center justify-between gap-3 border-2 border-ink rounded-md px-3 py-1 text-white ${
              net >= 0 ? 'bg-kgrn' : 'bg-kred'
            }`}
          >
            <span className="font-display text-sm tracking-wide">{net >= 0 ? 'Net Kâr' : 'Net Zarar'}</span>
            <span className="font-display text-lg tabular-nums">
              {net >= 0 ? '+' : '−'}
              {lira(Math.abs(net))}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Section title="Kasa">
              <Row
                label="Gün başı → sonu"
                value={
                  report.cash.opening !== null
                    ? `${lira(report.cash.opening)} → ${lira(report.cash.now)}`
                    : lira(report.cash.now)
                }
                hint="Kasa farkına yakıt siparişleri ve yatırımlar da girer; net kâr yalnız günün satış ve giderlerinden çıkar."
              />
            </Section>
            <Section title="İtibar">
              <Row
                label="Gün başı → sonu"
                value={repOpening !== null ? `★ ${repOpening.toFixed(2)} → ${repNow.toFixed(2)}` : `★ ${repNow.toFixed(2)}`}
                tone={repOpening === null ? 'text-ink' : repNow >= repOpening ? 'text-kgrn' : 'text-kred'}
              />
            </Section>
          </div>
          {report.missedLoanPayments > 0 && (
            <Row label="Ödenemeyen kredi taksiti" value={report.missedLoanPayments} tone="text-kred" />
          )}
        </div>

        <div className="px-4 py-2 border-t-2 border-ink shrink-0 flex gap-2">
          <button
            onClick={() => setActiveModal('NONE')}
            className="game-btn bg-card hover:bg-board text-ink px-3 py-1.5 font-display text-sm tracking-wide"
            title="Gün durmuş bekler; saatin yanındaki GÜN SONU düğmesi raporu geri açar"
          >
            Sahaya Dön
          </button>
          <button
            onClick={startNextDay}
            disabled={!dayOver}
            className="game-btn flex-1 bg-kgrn hover:bg-kgrn-dark text-white px-3 py-1.5 font-display text-sm tracking-wide flex items-center justify-center gap-2"
          >
            <span>Günü Kapat · Gün {report.day + 1}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
