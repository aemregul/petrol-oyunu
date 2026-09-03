import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { FuelType } from '../../domain/types/gameState';
import { GAME_CONFIG, SupplierType } from '../../config/gameConfig';
import { X, Truck, Calendar } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';
import { isFuelDealOn, FUEL_DEAL_DISCOUNT } from '../../domain/services/simulationEngine';

const FUEL_ORDER_STEP = 200;

const FUEL_COLORS: Record<FuelType, string> = {
  gasoline: '#22c55e',
  diesel:   '#f97316',
  lpg:      '#3b82f6'
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
  const free        = unlocked ? Math.max(0, tank.capacity - tank.stock) : 0;
  const full        = free < conf.orderMinLiters;

  const supplier    = GAME_CONFIG.suppliers.find((s) => s.id === supplierId)
    ?? GAME_CONFIG.suppliers[1];

  const baseUnitCost = dealOn
    ? Number(((pricing?.todayWholesaleCost ?? conf.baseWholesale) * (1 - FUEL_DEAL_DISCOUNT)).toFixed(2))
    : (pricing?.todayWholesaleCost ?? conf.baseWholesale);
  const unitCost = Number((baseUnitCost * supplier.priceMultiplier).toFixed(2));

  const maxLiters   = Math.max(conf.orderMinLiters, Math.floor(free / FUEL_ORDER_STEP) * FUEL_ORDER_STEP);
  const [liters, setLiters]   = useState<number>(Math.min(conf.orderMinLiters, maxLiters));
  const clampedLiters         = Math.min(maxLiters, Math.max(conf.orderMinLiters, liters));
  const totalCost             = clampedLiters * unitCost + conf.deliveryFee;
  const canAfford             = gameState.player.cash >= totalCost;

  const step = (delta: number) => {
    setLiters((prev) => Math.min(maxLiters, Math.max(conf.orderMinLiters, prev + delta)));
  };

  const handleMax = () => setLiters(maxLiters);

  const handleOrder = () => {
    if (full || !canAfford || !unlocked) return;
    sounds.playClick();
    orderFuel(fuelType, clampedLiters, supplierId);
    // Modal kapanmaz, satır stok değeri güncellenir.
  };

  const color = FUEL_COLORS[fuelType];
  const fillPct = unlocked ? Math.round((tank.stock / tank.capacity) * 100) : 0;
  const diffLiters = unlocked ? clampedLiters : 0;

  if (!unlocked) return null;

  return (
    <div
      className="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-4 flex items-center gap-3"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      {/* Yakıt ikonu */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white font-black text-xs"
        style={{ background: `${color}22`, border: `1.5px solid ${color}55` }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill={color}>
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/>
        </svg>
      </div>

      {/* İsim + stok */}
      <div className="flex-1 min-w-0">
        <div className="font-bold text-white text-sm">{FUEL_LABEL[fuelType]}</div>
        {full ? (
          <div className="text-xs text-slate-400">Tank dolu</div>
        ) : (
          <div className="text-xs text-slate-400">
            {tank.stock.toFixed(0)} / {tank.capacity} L
            <span className="ml-1.5 text-emerald-400 font-medium">
              +{diffLiters} L · alış {unitCost.toFixed(1)} TL/L
            </span>
          </div>
        )}
        {/* Bar */}
        <div className="mt-1.5 w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${fillPct}%`, background: color }}
          />
        </div>
      </div>

      {/* Kontroller */}
      {full ? (
        <div className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-400 bg-slate-700/60 border border-slate-600/40 select-none">
          Dolu
        </div>
      ) : (
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => step(-FUEL_ORDER_STEP)}
            disabled={clampedLiters <= conf.orderMinLiters}
            className="w-8 h-8 rounded-xl bg-slate-700 border border-slate-600 text-slate-200 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center font-bold text-sm transition-all"
          >
            −
          </button>
          <input
            type="number"
            min={conf.orderMinLiters}
            max={maxLiters}
            step={FUEL_ORDER_STEP}
            value={clampedLiters}
            onChange={(e) => setLiters(Number(e.target.value))}
            className="w-14 text-center bg-slate-900 border border-slate-600 rounded-xl text-white text-sm font-mono py-1 focus:outline-none focus:border-slate-400"
          />
          <button
            onClick={() => step(FUEL_ORDER_STEP)}
            disabled={clampedLiters >= maxLiters}
            className="w-8 h-8 rounded-xl bg-slate-700 border border-slate-600 text-slate-200 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center font-bold text-sm transition-all"
          >
            +
          </button>
          <button
            onClick={handleMax}
            className="px-2.5 py-1.5 rounded-xl bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 text-xs font-bold transition-all"
          >
            MAX
          </button>
          {/* Sipariş butonu */}
          <button
            onClick={handleOrder}
            disabled={!canAfford}
            className={`px-4 py-2 rounded-xl text-sm font-extrabold transition-all shadow-lg ${
              !canAfford
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed border border-slate-600'
                : 'text-white hover:scale-[1.03]'
            }`}
            style={canAfford ? { background: color, boxShadow: `0 4px 20px ${color}55` } : {}}
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
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-xl shadow-2xl text-slate-100 flex flex-col max-h-[90vh]">

        {/* Başlık */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Truck className="w-4 h-4" />
            </div>
            <span className="font-extrabold text-base text-white">Yakıt Siparişi</span>
          </div>
          <button
            onClick={() => { sounds.playClick(); setActiveModal('NONE'); }}
            className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all"
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
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold uppercase tracking-wider">
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
                    className={`rounded-2xl py-3 px-3 flex flex-col items-center gap-1 transition-all font-bold text-sm ${
                      active
                        ? 'text-white shadow-lg'
                        : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                    style={active ? {
                      background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                      boxShadow: '0 4px 20px #ef444455'
                    } : {}}
                  >
                    <span className="text-center leading-tight">{s.name}</span>
                    <span className={`text-xs font-normal ${active ? 'text-red-200' : 'text-slate-400'}`}>
                      {s.tag}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Dinamik açıklama */}
            <div className="text-sm text-slate-300 leading-snug">
              {supplier.description}
            </div>
            <div className="text-xs text-slate-500 leading-relaxed border-t border-dashed border-slate-700 pt-3">
              Litreyi elle yazabilir, –/+ ile {FUEL_ORDER_STEP}L adımlayabilir ya da MAX ile depoyu fulleyebilirsin.
              Her yakıtın tankeri ayrı gelir ve boşaltır.
            </div>
          </div>

          {/* Alım Defteri */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <Calendar className="w-3.5 h-3.5" />
              Alım Defteri
            </div>

            {history.length === 0 ? (
              <div className="text-center text-slate-500 text-xs py-6">
                Henüz tamamlanan teslimat yok.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {history.map((rec) => {
                  const color = FUEL_COLORS[rec.fuelType];
                  const label = FUEL_LABEL[rec.fuelType];
                  return (
                    <div
                      key={rec.id}
                      className="flex items-center gap-3 py-1.5 px-3 rounded-xl hover:bg-slate-800/60 text-xs transition-all"
                    >
                      <span className="text-slate-500 font-mono w-12 shrink-0">
                        Gün {rec.day}
                      </span>
                      <span className="font-bold w-20 shrink-0" style={{ color }}>
                        {label}
                      </span>
                      <span className="text-slate-300 font-mono w-14 text-right shrink-0">
                        {rec.liters.toLocaleString('tr-TR')}L
                      </span>
                      <span className="text-slate-200 font-mono flex-1 text-right">
                        ₺{rec.totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-slate-400 font-mono w-14 text-right shrink-0">
                        ₺{rec.unitCost.toFixed(1)}/L
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Son 7 gün özeti */}
            <div className="text-right text-xs text-slate-400 border-t border-slate-800 pt-2 font-mono">
              Son 7 gün yakıt gideri:{' '}
              <span className="text-slate-200 font-bold">
                ₺{last7Cost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
