import React from 'react';
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
  share: number;
  value: string;
}> = ({ label, color, share, value }) => (
  <div className="game-glass px-2.5 py-1.5 flex items-center gap-2 pointer-events-auto">
    <span className="k-label leading-none">{label}</span>
    <span className="k-bar w-14 h-2.5">
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`, background: color }} />
    </span>
    <span className="font-display text-[14px] leading-none text-ink tabular-nums whitespace-nowrap">{value}</span>
  </div>
);

/** Rendered inline under the top strip, centred; the HUD places it. */
export const StockStrip: React.FC = () => {
  const tanks = useGameStore((s) => s.gameState.tanks);
  const gameState = useGameStore((s) => s.gameState);

  const kwh = energyAvailable(gameState, 'near') + energyAvailable(gameState, 'far');
  const kwhCap = energyCapacityOn(gameState, 'near') + energyCapacityOn(gameState, 'far');

  return (
    <div className="flex flex-wrap justify-center gap-2 pointer-events-none min-w-0">
      {FUELS.map((fuel) => {
        const tank = tanks[fuel];
        const conf = GAME_CONFIG.fuels[fuel];
        if (!tank || !conf) return null;
        return (
          <Card
            key={fuel}
            label={conf.shortName}
            color={conf.color}
            share={tank.capacity > 0 ? tank.stock / tank.capacity : 0}
            value={`${Math.round(tank.stock).toLocaleString('tr-TR')}L`}
          />
        );
      })}
      {kwhCap > 0 && (
        <Card label="Batarya" color="#f2c230" share={kwh / kwhCap} value={`${Math.round(kwh)}/${Math.round(kwhCap)}`} />
      )}
    </div>
  );
};
