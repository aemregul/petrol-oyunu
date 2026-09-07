import React from 'react';
import { Fuel, BatteryCharging } from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import { GAME_CONFIG } from '../config/gameConfig';
import { energyAvailable, energyCapacityOn } from '../domain/services/simulationEngine';
import { FuelType } from '../domain/types/gameState';

/**
 * What the station has in the ground and in the battery, in one glance
 * (Emre, 2026-09-07): a card per fuel with its bar and litres, and one for
 * the battery in kWh. The battery card only appears once there is one.
 */
const FUELS: FuelType[] = ['gasoline', 'diesel', 'lpg'];

const Card: React.FC<{
  label: string;
  color: string;
  icon: React.ReactNode;
  share: number;
  value: string;
}> = ({ label, color, icon, share, value }) => (
  <div className="game-surface px-3 py-2 flex items-center gap-2.5 pointer-events-auto min-w-[11.5rem]">
    <div className="game-icon-badge w-7 h-7 !bg-black/40 shrink-0">{icon}</div>
    <div className="flex-1 min-w-0">
      <div className="text-[9px] uppercase font-bold text-slate-400 tracking-wider leading-none mb-1.5">{label}</div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-black/50 border border-white/5 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`, background: color }}
          />
        </div>
        <span className="text-[13px] font-black font-mono text-white tabular-nums whitespace-nowrap">{value}</span>
      </div>
    </div>
  </div>
);

export const StockStrip: React.FC = () => {
  const tanks = useGameStore((s) => s.gameState.tanks);
  const gameState = useGameStore((s) => s.gameState);

  const kwh = energyAvailable(gameState, 'near') + energyAvailable(gameState, 'far');
  const kwhCap = energyCapacityOn(gameState, 'near') + energyCapacityOn(gameState, 'far');

  return (
    <div className="fixed top-[4.9rem] inset-x-0 z-30 flex justify-center pointer-events-none px-4">
      <div className="flex flex-wrap justify-center gap-2">
        {FUELS.map((fuel) => {
          const tank = tanks[fuel];
          const conf = GAME_CONFIG.fuels[fuel];
          if (!tank || !conf) return null;
          return (
            <Card
              key={fuel}
              label={conf.shortName}
              color={conf.color}
              icon={<Fuel className="w-3.5 h-3.5" style={{ color: conf.color }} />}
              share={tank.capacity > 0 ? tank.stock / tank.capacity : 0}
              value={`${Math.round(tank.stock).toLocaleString('tr-TR')}L`}
            />
          );
        })}
        {kwhCap > 0 && (
          <Card
            label="Batarya"
            color="#22d3ee"
            icon={<BatteryCharging className="w-3.5 h-3.5" style={{ color: '#22d3ee' }} />}
            share={kwh / kwhCap}
            value={`${Math.round(kwh)}/${Math.round(kwhCap)}`}
          />
        )}
      </div>
    </div>
  );
};
