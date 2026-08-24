import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { SaveManager } from '../domain/services/SaveManager';

export const SimulationLoop: React.FC = () => {
  const simulationTick = useGameStore((s) => s.simulationTick);
  const gameState = useGameStore((s) => s.gameState);
  const lastTickTimeRef = useRef(performance.now());
  const autoSaveTimerRef = useRef(0);

  useEffect(() => {
    // Fixed Timestep Tick (20Hz = 50ms)
    const interval = setInterval(() => {
      const now = performance.now();
      const deltaSec = (now - lastTickTimeRef.current) / 1000;
      lastTickTimeRef.current = now;

      // Cap delta to prevent spiral of death on tab switch
      const safeDelta = Math.min(0.2, deltaSec);
      simulationTick(safeDelta);

      // Auto-save every 15 seconds
      autoSaveTimerRef.current += safeDelta;
      if (autoSaveTimerRef.current >= 15) {
        autoSaveTimerRef.current = 0;
        SaveManager.saveGame(useGameStore.getState().gameState);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [simulationTick]);

  return null;
};
