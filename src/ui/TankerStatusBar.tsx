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
            className="game-surface w-60 px-2.5 py-2 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 text-[11px] tabular-nums animate-fade-in"
          >
            <span
              className="game-icon-badge w-6 h-6 !bg-black/40"
              style={{ borderColor: fuel?.color ?? '#e2e8f0' }}
            >
              <Truck className="w-3.5 h-3.5" style={{ color: fuel?.color ?? '#e2e8f0' }} />
            </span>
            <span className="game-title text-white text-[11px] truncate">
              {order.liters} L {fuel?.shortName ?? order.fuelType}
            </span>
            <span className="text-slate-300 font-mono font-bold text-right whitespace-nowrap">
              {label(order)}
            </span>
          </div>
        );
      })}
    </div>
  );
};
