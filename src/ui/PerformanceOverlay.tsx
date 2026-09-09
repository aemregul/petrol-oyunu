import React, { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { Activity } from 'lucide-react';

/**
 * A frame counter in the bottom-left corner, only while the player has
 * "FPS Göster" on in Settings > Grafik (Emre, 2026-09-09: the developer's
 * stats bar with vehicles and draw calls is gone, as is the test panel
 * that hung off it — the admin panel took the latter's place).
 */
export const PerformanceOverlay: React.FC = () => {
  const visible = useGameStore((s) => !!s.gameState.settings.showFps);
  const fps = useGameStore((s) => s.perfMetrics.fps);
  const updatePerfMetrics = useGameStore((s) => s.updatePerfMetrics);

  useEffect(() => {
    if (!visible) return;
    let frames = 0;
    let lastTime = performance.now();
    let animId = 0;
    const loop = () => {
      frames++;
      const now = performance.now();
      const elapsed = now - lastTime;
      if (elapsed >= 1000) {
        updatePerfMetrics({
          fps: Math.round((frames * 1000) / elapsed),
          activeVehicles: Object.keys(useGameStore.getState().gameState.vehicles).length
        });
        frames = 0;
        lastTime = now;
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [updatePerfMetrics, visible]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 select-none pointer-events-none" data-testid="fps-badge">
      <div className="bg-card border-2 border-ink shadow-k rounded-md px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] font-mono text-ink">
        <Activity className="w-3.5 h-3.5 text-kgrn" />
        <span className="font-bold">{fps} FPS</span>
      </div>
    </div>
  );
};
