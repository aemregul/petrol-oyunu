import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGameStore } from '../store/gameStore';

/**
 * Reports the renderer's real draw-call count to the performance overlay.
 * Lives inside the Canvas because that is the only place `gl.info` exists.
 */
export const RenderStatsProbe: React.FC = () => {
  const { gl } = useThree();
  const updatePerfMetrics = useGameStore((s) => s.updatePerfMetrics);
  const sinceUpdate = useRef(0);

  useFrame((_, delta) => {
    sinceUpdate.current += delta;
    if (sinceUpdate.current < 1) return;

    sinceUpdate.current = 0;
    updatePerfMetrics({ drawCalls: gl.info.render.calls });
  });

  return null;
};
