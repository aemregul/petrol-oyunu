import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { FuelType } from '../../domain/types/gameState';
import { GAME_CONFIG, SupplierType } from '../../config/gameConfig';
import { X, Truck, Calendar } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import {
  isFuelDealOn,
  FUEL_DEAL_DISCOUNT,
  litersOnOrder,
  orderableLiters
} from '../../domain/services/simulationEngine';

// One button press is one order step (Emre, 2026-09-09: 600 L was unreachable at 200).
const FUEL_ORDER_STEP = GAME_CONFIG.fuels.gasoline.orderStepLiters;

/**
 * Karton: each fuel wears one of the sticker colours — green for petrol,
 * the dark yellow for diesel, blue for LPG. Whole literal strings so
 * Tailwind can find them.
 */
const FUEL_TONE: Record<FuelType, { text: string; bar: string; edge: string; btn: string }> = {
  gasoline: { text: 'text-kgrn', bar: 'bg-kgrn', edge: 'border-l-kgrn', btn: 'bg-kgrn hover:bg-kgrn-dark text-white' },
  diesel:   { text: 'text-kyel-dark', bar: 'bg-kyel-dark', edge: 'border-l-kyel-dark', btn: 'bg-kyel hover:bg-kyel-dark text-ink' },
  lpg:      { text: 'text-kblu', bar: 'bg-kblu', edge: 'border-l-kblu', btn: 'bg-kblu hover:bg-kblu-dark text-white' }
};

const FUEL_LABEL: Record<FuelType, string> = {
  gasoline: 'Benzin',
  diesel:   'Dizel (Mazot)',
  lpg:      'LPG'
};

// ─── Yakıt satırı ────────────────────────────────────────────────────────────

interface FuelRowProps {
  fuelType: FuelType;
  supplierId: string;
  dealOn: boolean;
}

const FuelRow: React.FC<FuelRowProps> = ({ fuelType, supplierId, dealOn }) => {
  const gameState    = useGameStore((s) => s.gameState);
  const orderFuel    = useGameStore((s) => s.orderFuel);

  const tank    = gameState.tanks[fuelType];
  const conf    = GAME_CONFIG.fuels[fuelType];
  const pricing = gameState.pricing[fuelType];

  const unlocked    = tank && tank.capacity > 0;
  // What is already bought and on its way counts as in the tank here: a
  // tanker on the road and the card still offering MAX again would send a
  // second lorry to a full tank (Emre, 2026-09-09).
  const onOrder     = unlocked ? Math.floor(litersOnOrder(gameState, fuelType)) : 0;
  const free        = unlocked ? Math.floor(orderableLiters(gameState, fuelType)) : 0;
  const full        = free < 1;

  const supplier    = GAME_CONFIG.suppliers.find((s) => s.id === supplierId)
    ?? GAME_CONFIG.suppliers[1];

  const baseUnitCost = dealOn
    ? Number(((pricing?.todayWholesaleCost ?? conf.baseWholesale) * (1 - FUEL_DEAL_DISCOUNT)).toFixed(2))
    : (pricing?.todayWholesaleCost ?? conf.baseWholesale);
  const unitCost = Number((baseUnitCost * supplier.priceMultiplier).toFixed(2));

  // The ceiling is the tank or the till, whichever comes first: after the
  // delivery fee, how many litres the cash covers (Emre, 2026-09-09: "param
  // ne kadarına yetiyorsa"). MAX fills to that, never past it.
  const affordable  = Math.floor((gameState.player.cash - conf.deliveryFee) / unitCost);
  const maxLiters   = Math.max(1, Math.min(free, affordable));
  const broke       = affordable < 1;
  // What the box holds is text while it is being typed: clamping every
  // keystroke made "600" impossible to enter, since "6" snapped to 500 and
  // the rest was typed over it. And any whole litre goes — 218 if that is
  // what the till allows (Emre, 2026-09-09); the minimum and the step are
  // the manager's rules for tankers it calls, not the player's. The number
  // is settled inside the tank when the box is left or the order is placed.
  const settle = (raw: number) => Math.min(maxLiters, Math.max(1, Math.round(raw)));
  const [liters, setLiters]   = useState<number>(Math.min(conf.orderMinLiters, maxLiters));
  const [typed, setTyped]     = useState<string | null>(null);
  const clampedLiters         = settle(liters);
  const totalCost             = clampedLiters * unitCost + conf.deliveryFee;
  const canAfford             = gameState.player.cash >= totalCost;

  const step = (delta: number) => {
    setTyped(null);
    setLiters((prev) => settle(settle(prev) + delta));
  };

  const handleMax = () => { setTyped(null); setLiters(maxLiters); };

  const commitTyped = () => {
    if (typed === null) return;
    const raw = Number(typed);
    if (Number.isFinite(raw) && raw > 0) setLiters(settle(raw));
    setTyped(null);
  };

  const handleOrder = () => {
    if (full || broke || !canAfford || !unlocked) return;
    const raw = typed === null ? clampedLiters : Number(typed);
    const amount = Number.isFinite(raw) && raw > 0 ? settle(raw) : clampedLiters;
    setTyped(null);
    setLiters(amount);
    sounds.playClick();
    orderFuel(fuelType, amount, supplierId);
    // The card stays open: one tanker is rarely the last (Emre, 2026-09-09).
  };

  const tone = FUEL_TONE[fuelType];
  // Two segments: what is in the tank, and — fainter — what is on its way to
  // it. Together they show the tank the way the order rule sees it.
  const fillPct = unlocked ? Math.min(100, Math.round((tank.stock / tank.capacity) * 100)) : 0;
  const onOrderPct = unlocked
    ? Math.min(100 - fillPct, Math.round((onOrder / tank.capacity) * 100))
    : 0;

  const diffLiters = unlocked ? clampedLiters : 0;

  if (!unlocked) return null;

  return (
    <div
      data-tour={`order-row-${fuelType}`}
      className={`bg-board border-2 border-ink border-l-[6px] rounded-md p-4 flex items-center gap-3 ${tone.edge}`}
    >
      {/* Yakıt ikonu */}
      <div className={`game-icon-badge w-10 h-10 ${tone.text}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/>
        </svg>
      </div>

      {/* İsim + stok */}
      <div className="flex-1 min-w-0">
        <div className="font-display text-base text-ink">{FUEL_LABEL[fuelType]}</div>
        {full ? (
          <div className="text-xs text-mute">
            {onOrder > 0 ? `Tank dolu · ${onOrder} L yolda` : 'Tank dolu'}
          </div>
        ) : (
          <div className="text-xs text-mute">
            {tank.stock.toFixed(0)} / {tank.capacity} L
            {onOrder > 0 && <span className="ml-1.5 font-medium">· {onOrder} L yolda</span>}
            <span className="ml-1.5 text-kgrn font-medium">
              +{diffLiters} L · alış {unitCost.toFixed(1)} TL/L
            </span>
            {affordable < free && (
              <span className={`ml-1.5 font-medium ${broke ? 'text-kred' : 'text-kyel-dark'}`}>
                {broke ? '· nakliye için para yok' : `· kasan ${affordable} L\'ye yeter`}
              </span>
            )}
          </div>
        )}
        {/* Bar: in the tank, then on the road */}
        <div className="mt-1.5 w-full k-bar flex">
          <div
            className={`h-full transition-all ${tone.bar}`}
            style={{ width: `${fillPct}%` }}
          />
          {onOrderPct > 0 && (
            <div
              className={`h-full transition-all opacity-40 ${tone.bar}`}
              style={{ width: `${onOrderPct}%` }}
              title={`${onOrder} L yolda`}
            />
          )}
        </div>
      </div>

      {/* Kontroller */}
      {full ? (
        <div className="px-5 py-2.5 rounded-md text-sm font-display tracking-wide text-mute bg-card border-2 border-ink select-none">
          Dolu
        </div>
      ) : (
        <div className="flex items-center gap-1.5 shrink-0">
          {/* The amount controls as one piece, so a lesson can point at them apart from the price. */}
          <div data-tour={`order-amount-${fuelType}`} className="flex items-center gap-1.5">
            <button
              onClick={() => step(-FUEL_ORDER_STEP)}
              disabled={clampedLiters <= 1}
              className="game-btn w-8 h-8 rounded-md bg-card hover:bg-board text-ink disabled:cursor-not-allowed flex items-center justify-center font-bold text-sm"
            >
              −
            </button>
            <input
              type="text"
              inputMode="numeric"
              value={typed ?? String(clampedLiters)}
              onChange={(e) => setTyped(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitTyped}
              onKeyDown={(e) => { if (e.key === 'Enter') { commitTyped(); handleOrder(); } }}
              title={`1–${maxLiters} L, istediğin rakamı yaz`}
              className="w-20 text-center bg-paper border-2 border-ink rounded-md text-ink font-display text-sm px-2 py-1 focus:outline-none"
            />
            <button
              onClick={() => step(FUEL_ORDER_STEP)}
              disabled={clampedLiters >= maxLiters}
              className="game-btn w-8 h-8 rounded-md bg-card hover:bg-board text-ink disabled:cursor-not-allowed flex items-center justify-center font-bold text-sm"
            >
              +
            </button>
            <button
              onClick={handleMax}
              className="game-btn px-2.5 py-1.5 rounded-md bg-card hover:bg-board text-ink text-xs font-display tracking-wide"
            >
              MAX
            </button>
          </div>
          {/* Sipariş butonu */}
          <button
            data-tour={`order-buy-${fuelType}`}
            onClick={handleOrder}
            disabled={!canAfford}
            className={`game-btn px-4 py-2 rounded-md text-sm font-display tracking-wide tabular-nums ${
              !canAfford
                ? 'bg-card text-mute cursor-not-allowed'
                : tone.btn
            }`}
          >
            ₺{totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Ana modal ───────────────────────────────────────────────────────────────

export const FuelOrderModal: React.FC = () => {
  const gameState      = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);

  const [supplierId, setSupplierId] = useState<SupplierType>('standart');

  const dealOn     = isFuelDealOn(gameState);
  const supplier   = GAME_CONFIG.suppliers.find((s) => s.id === supplierId)!;
  const FUELS: FuelType[] = ['gasoline', 'diesel', 'lpg'];

  // Alım Defteri
  const history = [...(gameState.fuelPurchaseHistory ?? [])].reverse().slice(0, 30);

  // Son 7 gün gider toplamı
  const today = gameState.dayState.currentDay;
  const last7Cost = gameState.fuelPurchaseHistory
    .filter((r) => r.day >= today - 6)
    .reduce((sum, r) => sum + r.totalCost, 0);

  return (
    <div className="k-dim animate-fade-in select-none">
      <div className="game-surface w-full max-w-xl flex flex-col max-h-[90vh]">

        {/* Başlık */}
        <div className="k-head k-head-grn shrink-0 rounded-t-md">
          <div className="flex items-center gap-3">
            <div className="game-icon-badge w-9 h-9">
              <Truck className="w-4 h-4" />
            </div>
            <span className="font-display text-xl tracking-wide">Yakıt Siparişi</span>
          </div>
          <button
            data-tour="order-close"
            onClick={() => { sounds.playClick(); setActiveModal('NONE'); }}
            className="game-btn bg-card text-ink w-9 h-9 rounded-md flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Kaydırılabilir gövde */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5">

          {/* Yakıt satırları */}
          <div className="flex flex-col gap-3">
            {FUELS.map((ft) => (
              <FuelRow key={ft} fuelType={ft} supplierId={supplierId} dealOn={dealOn} />
            ))}
          </div>

          {/* Tedarikçi seçimi */}
          <div data-tour="order-suppliers" className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5 k-label">
              <Truck className="w-3.5 h-3.5" />
              Tedarikçi
            </div>
            <div className="grid grid-cols-3 gap-2">
              {GAME_CONFIG.suppliers.map((s) => {
                const active = s.id === supplierId;
                return (
                  <button
                    key={s.id}
                    onClick={() => { sounds.playClick(); setSupplierId(s.id as SupplierType); }}
                    className={`game-btn rounded-md py-3 px-3 flex flex-col items-center gap-1 font-display tracking-wide text-sm ${
                      active
                        ? 'bg-kred text-white'
                        : 'bg-card hover:bg-board text-ink'
                    }`}
                  >
                    <span className="text-center leading-tight">{s.name}</span>
                    <span className={`text-xs font-sans font-semibold tracking-normal ${active ? 'text-white/80' : 'text-mute'}`}>
                      {s.tag}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Dinamik açıklama */}
            <div className="text-sm text-ink leading-snug">
              {supplier.description}
            </div>
            <div className="text-xs text-mute leading-relaxed border-t-2 border-dashed border-mute/60 pt-3">
              İstediğin litreyi yaz — 218 de olur — ya da –/+ ile {FUEL_ORDER_STEP}L adımla, MAX ile depoyu fulle. Kart sipariş sonrası açık kalır.
              Her yakıtın tankeri ayrı gelir ve boşaltır.
            </div>
          </div>

          {/* Alım Defteri */}
          <div className="flex flex-col gap-2" data-tour="order-ledger">
            <div className="flex items-center gap-1.5 k-label">
              <Calendar className="w-3.5 h-3.5" />
              Alım Defteri
            </div>

            {history.length === 0 ? (
              <div className="text-center text-mute text-xs py-6 bg-board border-2 border-dashed border-mute rounded-md">
                Henüz tamamlanan teslimat yok.
              </div>
            ) : (
              <div className="flex flex-col gap-1 bg-board border-2 border-ink rounded-md p-2">
                {history.map((rec) => {
                  const tone = FUEL_TONE[rec.fuelType];
                  const label = FUEL_LABEL[rec.fuelType];
                  return (
                    <div
                      key={rec.id}
                      className="flex items-center gap-3 py-1.5 px-3 rounded-md hover:bg-card text-xs transition-colors"
                    >
                      <span className="text-mute font-mono w-12 shrink-0">
                        Gün {rec.day}
                      </span>
                      <span className={`font-bold w-20 shrink-0 ${tone.text}`}>
                        {label}
                      </span>
                      <span className="text-ink font-mono w-14 text-right shrink-0">
                        {rec.liters.toLocaleString('tr-TR')}L
                      </span>
                      <span className="text-ink font-mono font-bold flex-1 text-right">
                        ₺{rec.totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-mute font-mono w-14 text-right shrink-0">
                        ₺{rec.unitCost.toFixed(1)}/L
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Son 7 gün özeti */}
            <div className="text-right text-xs text-mute border-t-2 border-dotted border-mute/60 pt-2 font-mono">
              Son 7 gün yakıt gideri:{' '}
              <span className="text-kred font-bold">
                ₺{last7Cost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
