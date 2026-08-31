import React from 'react';
import { useGameStore } from '../store/gameStore';
import { GAME_CONFIG } from '../config/gameConfig';
import { Truck } from 'lucide-react';

/**
 * The corner ledger of every tanker on its way: which fuel, and where it is
 * in its journey. This replaces the toast per lifecycle step — a delivery is
 * routine, and routine belongs in a quiet corner, not in the player's face
 * three times per order.
 */
export const TankerStatusBar: React.FC = () => {
  const fuelOrders = useGameStore((s) => s.gameState.fuelOrders);
  if (fuelOrders.length === 0) return null;

  const label = (order: (typeof fuelOrders)[number]): string => {
    if (order.state === 'TRAVELLING') return `Yolda · ${Math.max(1, Math.ceil(order.remainingSeconds))} sn`;
    if (order.state === 'QUEUED_AT_GATE') return order.truck ? 'Tesise giriyor' : 'Kapıda bekliyor';
    if (order.state === 'UNLOADING') {
      const total = order.liters / GAME_CONFIG.economy.tankerUnloadSpeedLps;
      const pct = total > 0 ? Math.round((1 - order.remainingSeconds / total) * 100) : 0;
      return `Boşaltılıyor %${Math.max(0, Math.min(100, pct))}`;
    }
    return 'Ayrılıyor';
  };

  return (
    <div className="absolute bottom-20 right-4 flex flex-col gap-1.5 items-stretch pointer-events-none">
      {fuelOrders.map((order) => {
        const fuel = GAME_CONFIG.fuels[order.fuelType];
        return (
          <div
            key={order.id}
            className="w-56 bg-slate-900/85 border border-slate-700/70 backdrop-blur-sm rounded-xl px-2.5 py-1.5 shadow-lg grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[11px] font-mono tabular-nums animate-fade-in"
          >
            <Truck className="w-3.5 h-3.5" style={{ color: fuel?.color ?? '#e2e8f0' }} />
            <span className="font-bold text-white truncate">
              {order.liters} L {fuel?.shortName ?? order.fuelType}
            </span>
            <span className="text-slate-400 text-right whitespace-nowrap">{label(order)}</span>
          </div>
        );
      })}
    </div>
  );
};
