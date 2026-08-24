import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { FuelType } from '../../domain/types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';
import { X, Fuel, Truck, Clock, AlertCircle, Trash2 } from 'lucide-react';
import { sounds } from '../../audio/soundEffects';

export const FuelOrderModal: React.FC = () => {
  const gameState = useGameStore((s) => s.gameState);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const orderFuel = useGameStore((s) => s.orderFuel);
  const cancelFuelOrder = useGameStore((s) => s.cancelFuelOrder);

  const [selectedFuel, setSelectedFuel] = useState<FuelType>('gasoline');
  const [orderLiters, setOrderLiters] = useState<number>(500);

  const tank = gameState.tanks[selectedFuel];
  const fuelConf = GAME_CONFIG.fuels[selectedFuel];
  const pricing = gameState.pricing[selectedFuel];

  const freeCapacity = tank ? Math.max(0, tank.capacity - tank.stock) : 0;
  const maxOrder = Math.max(500, Math.floor(freeCapacity / 100) * 100);
  const clampedOrderLiters = Math.min(maxOrder, Math.max(500, orderLiters));

  const unitCost = pricing ? pricing.todayWholesaleCost : fuelConf.baseWholesale;
  const deliveryFee = fuelConf.deliveryFee;
  const totalCost = clampedOrderLiters * unitCost + deliveryFee;

  const inFlightOrders = gameState.fuelOrders.filter((o) => o.fuelType === selectedFuel);

  const handleOrder = () => {
    const success = orderFuel(selectedFuel, clampedOrderLiters);
    if (success) {
      setOrderLiters(500);
    }
  };

  const handleClose = () => {
    sounds.playClick();
    setActiveModal('NONE');
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in select-none">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden text-slate-100 flex flex-col">
        {/* Header */}
        <div className="bg-slate-800/80 px-6 py-4 border-b border-slate-700/80 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-500/30 text-sky-400 flex items-center justify-center">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">Lojistik & İkmal</div>
              <div className="text-base font-extrabold text-white">Akaryakıt Tankeri Siparişi</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fuel Selection Tabs */}
        <div className="flex border-b border-slate-800 p-2 gap-2 bg-slate-950/40">
          {(['gasoline', 'diesel', 'lpg'] as FuelType[]).map((fType) => {
            const conf = GAME_CONFIG.fuels[fType];
            const t = gameState.tanks[fType];
            const isUnlocked = t && t.capacity > 0;
            const isSelected = selectedFuel === fType;

            return (
              <button
                key={fType}
                onClick={() => {
                  if (isUnlocked) {
                    sounds.playClick();
                    setSelectedFuel(fType);
                  }
                }}
                disabled={!isUnlocked}
                className={`flex-1 py-3 px-4 rounded-2xl font-bold text-xs flex flex-col items-center gap-1 transition-all ${
                  !isUnlocked
                    ? 'opacity-40 bg-slate-900 text-slate-500 cursor-not-allowed'
                    : isSelected
                    ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/30'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Fuel className="w-3.5 h-3.5" />
                  <span>{conf.shortName}</span>
                </div>
                <div className="text-[10px] font-mono opacity-80">
                  {isUnlocked ? `${t.stock.toFixed(0)} / ${t.capacity} L` : `Kilitli (Seviye ${conf.unlockLevel})`}
                </div>
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div className="p-6 flex flex-col gap-5">
          {/* Tank Level Gauge */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
            <div className="flex justify-between items-center text-xs font-bold text-slate-300 mb-2">
              <span>{fuelConf.name} Tank Doluluğu</span>
              <span className="font-mono text-emerald-400">
                {tank.stock.toFixed(0)} L ({Math.round((tank.stock / tank.capacity) * 100)}%)
              </span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700 mb-3">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-all duration-300"
                style={{ width: `${Math.min(100, (tank.stock / tank.capacity) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400 font-mono">
              <span>Boş Kapasite: {freeCapacity.toFixed(0)} L</span>
              <span>Ağırlıklı Maliyet: {tank.averageCost.toFixed(2)} TL/L</span>
            </div>
          </div>

          {/* Order Liter Stepper & Slider */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-300 uppercase">Sipariş Miktarı</span>
              <span className="text-xl font-extrabold text-sky-400 font-mono">
                {clampedOrderLiters.toLocaleString('tr-TR')} Litre
              </span>
            </div>

            <input
              type="range"
              min={500}
              max={maxOrder}
              step={100}
              value={clampedOrderLiters}
              onChange={(e) => setOrderLiters(Number(e.target.value))}
              disabled={maxOrder <= 500 && freeCapacity < 500}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
            />

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/80 text-xs font-mono">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-sans">Birim Alış Fiyatı</span>
                <span className="font-bold text-white">{unitCost.toFixed(2)} TL/L</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-sans">Tanker Nakliye Bedeli</span>
                <span className="font-bold text-white">{deliveryFee} TL</span>
              </div>
            </div>
          </div>

          {/* Active In-flight Orders */}
          {inFlightOrders.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-bold text-slate-400 uppercase">Yoldaki Tankerler</div>
              {inFlightOrders.map((order) => (
                <div
                  key={order.id}
                  className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex justify-between items-center"
                >
                  <div className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-amber-400 animate-spin" />
                    <div>
                      <div className="text-xs font-bold text-white font-mono">
                        {order.liters} L {order.fuelType.toUpperCase()}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Kalan Süre: {Math.max(0, Math.ceil(order.remainingSeconds))} sn
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => cancelFuelOrder(order.id)}
                    className="p-1.5 rounded-lg bg-red-900/30 hover:bg-red-800/50 text-red-400 hover:text-red-200 text-xs flex items-center gap-1 transition-all"
                    title="İptal Et (%85 İade)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>İptal</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={handleOrder}
            disabled={freeCapacity < 500 || gameState.player.cash < totalCost}
            className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 ${
              freeCapacity < 500 || gameState.player.cash < totalCost
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-gradient-to-r from-sky-500 to-emerald-500 hover:from-sky-400 hover:to-emerald-400 text-slate-950 shadow-sky-500/30 hover:scale-[1.01]'
            }`}
          >
            <Truck className="w-4 h-4" />
            <span>Siparişi Onayla (₺{totalCost.toLocaleString('tr-TR')})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
