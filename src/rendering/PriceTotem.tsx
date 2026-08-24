import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { GAME_CONFIG } from '../config/gameConfig';
import { FuelType } from '../domain/types/gameState';

interface PriceTotemProps {
  level: number;
}

/** Board proportions and lighting per sign level. */
const LEVELS = [
  { width: 2.6, height: 3.0, mast: 5.0, glow: 0 },
  { width: 3.4, height: 3.9, mast: 6.4, glow: 0.9 },
  { width: 4.4, height: 5.0, mast: 8.0, glow: 1.6 }
];

const ROWS: Array<{ fuel: FuelType; label: string }> = [
  { fuel: 'gasoline', label: 'BENZİN' },
  { fuel: 'diesel', label: 'DİZEL' },
  { fuel: 'lpg', label: 'LPG' }
];

/**
 * The forecourt price totem. The board is drawn to a canvas and used as a
 * texture, so the digits sit on the sign itself rather than floating in front
 * of it as an HTML overlay.
 */
export const PriceTotem: React.FC<PriceTotemProps> = ({ level }) => {
  const pricing = useGameStore((s) => s.gameState.pricing);
  const tanks = useGameStore((s) => s.gameState.tanks);

  const spec = LEVELS[Math.min(LEVELS.length, Math.max(1, level)) - 1];
  const lit = spec.glow > 0;

  // Prices only change when the player or the manager sets them, so the
  // canvas is redrawn on change rather than every frame.
  const priceKey = ROWS.map(
    (r) => `${r.label}:${tanks[r.fuel].capacity > 0 ? pricing[r.fuel].playerPrice : -1}`
  ).join('|');

  const texture = useMemo(() => {
    const scale = 128;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(spec.width * scale);
    canvas.height = Math.round(spec.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, W, H);

    // Header band
    const headerH = H * 0.2;
    ctx.fillStyle = lit ? '#0284c7' : '#1e293b';
    ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${headerH * 0.5}px "Chakra Petch", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AKARYAKIT', W / 2, headerH / 2);

    const rowH = (H - headerH) / ROWS.length;
    ROWS.forEach((row, i) => {
      const top = headerH + i * rowH;
      const midY = top + rowH / 2;

      if (i % 2 === 1) {
        ctx.fillStyle = '#0f1a2e';
        ctx.fillRect(0, top, W, rowH);
      }

      ctx.fillStyle = GAME_CONFIG.fuels[row.fuel].color;
      ctx.font = `bold ${rowH * 0.42}px "Chakra Petch", system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(row.label, W * 0.07, midY);

      const hasTank = tanks[row.fuel].capacity > 0;
      ctx.fillStyle = hasTank ? '#f8fafc' : '#475569';
      ctx.font = `bold ${rowH * 0.5}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(
        hasTank ? pricing[row.fuel].playerPrice.toFixed(2) : '--.--',
        W * 0.93,
        midY
      );
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, [priceKey, spec.width, spec.height, lit, pricing, tanks]);

  // Canvas textures hold a GPU allocation; release it when it is replaced.
  useEffect(() => () => texture?.dispose(), [texture]);

  const boardY = spec.mast + spec.height / 2 - 0.4;

  return (
    <group>
      {/* Mast */}
      <mesh position={[0, spec.mast / 2, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.28, spec.mast, 12]} />
        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Board housing */}
      <mesh position={[0, boardY, 0]} castShadow>
        <boxGeometry args={[spec.width + 0.3, spec.height + 0.3, 0.4]} />
        <meshStandardMaterial
          color={lit ? '#0f2a44' : '#111827'}
          emissive={lit ? '#0284c7' : '#000000'}
          emissiveIntensity={spec.glow}
          roughness={0.4}
          toneMapped={!lit}
        />
      </mesh>

      {/* The price face, shown on both sides of the board */}
      {texture &&
        [0.21, -0.21].map((z) => (
          <mesh key={z} position={[0, boardY, z]} rotation={[0, z > 0 ? 0 : Math.PI, 0]}>
            <planeGeometry args={[spec.width, spec.height]} />
            <meshBasicMaterial map={texture} toneMapped={false} />
          </mesh>
        ))}

      {/* Level 3 gets a lit crown strip */}
      {level >= 3 && (
        <mesh position={[0, boardY + spec.height / 2 + 0.35, 0]}>
          <boxGeometry args={[spec.width + 0.4, 0.3, 0.5]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#38bdf8"
            emissiveIntensity={2}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
};
