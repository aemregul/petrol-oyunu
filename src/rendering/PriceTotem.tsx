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

const FUEL_ROWS: Array<{ fuel: FuelType; label: string }> = [
  { fuel: 'gasoline', label: 'BENZİN' },
  { fuel: 'diesel', label: 'DİZEL' },
  { fuel: 'lpg', label: 'LPG' }
];

/** Shrinks a string until it fits the column it has been given. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
  family: string
): void {
  let px = size;
  ctx.font = `bold ${px}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && px > 6) {
    px -= 1;
    ctx.font = `bold ${px}px ${family}`;
  }
}

const DISPLAY = '"Chakra Petch", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

/**
 * The forecourt price totem. The board is drawn to a canvas and used as a
 * texture, so the digits sit on the sign itself rather than floating in front
 * of it as an HTML overlay.
 *
 * The label and the price each get their own column and are shrunk to fit it.
 * Drawing both from the outside edges inwards, as this used to, works right up
 * until a long name meets a four-digit price and they overlap in the middle.
 */
export const PriceTotem: React.FC<PriceTotemProps> = ({ level }) => {
  const pricing = useGameStore((s) => s.gameState.pricing);
  const tanks = useGameStore((s) => s.gameState.tanks);
  const buildings = useGameStore((s) => s.gameState.buildings);
  const isOpen = useGameStore((s) => s.gameState.station.open);

  const spec = LEVELS[Math.min(LEVELS.length, Math.max(1, level)) - 1];
  const lit = spec.glow > 0;

  // Charging tariffs only appear once there is something to plug into.
  const chargers = useMemo(() => {
    const types = Object.values(buildings).map((b) => b.type);
    return {
      ac: types.includes('ev_charger_ac'),
      dc: types.includes('ev_charger_dc')
    };
  }, [buildings]);

  const rows = useMemo(() => {
    const out = FUEL_ROWS.map((row) => ({
      label: row.label,
      color: GAME_CONFIG.fuels[row.fuel].color,
      value: tanks[row.fuel].capacity > 0 ? pricing[row.fuel].playerPrice.toFixed(2) : '--.--',
      dim: tanks[row.fuel].capacity <= 0
    }));

    if (chargers.ac) {
      out.push({
        label: 'AC ŞARJ',
        color: '#38bdf8',
        value: GAME_CONFIG.ev.acPricePerKwh.toFixed(2),
        dim: false
      });
    }
    if (chargers.dc) {
      out.push({
        label: 'DC ŞARJ',
        color: '#a78bfa',
        value: GAME_CONFIG.ev.dcPricePerKwh.toFixed(2),
        dim: false
      });
    }
    return out;
  }, [pricing, tanks, chargers]);

  // Prices only change when the player or the manager sets them, so the
  // canvas is redrawn on change rather than every frame.
  const boardKey = rows.map((r) => `${r.label}:${r.value}`).join('|') + (isOpen ? '|open' : '|shut');

  const texture = useMemo(() => {
    const scale = 128;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(spec.width * scale);
    canvas.height = Math.round(spec.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const W = canvas.width;
    const H = canvas.height;
    const pad = W * 0.06;

    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, W, H);

    // Header band
    const headerH = H * 0.18;
    ctx.fillStyle = lit ? '#0284c7' : '#1e293b';
    ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'AKARYAKIT', W - pad * 2, headerH * 0.52, DISPLAY);
    ctx.fillText('AKARYAKIT', W / 2, headerH / 2);

    // A closed station says so, in the one place a driver on the road looks.
    const footerH = isOpen ? 0 : H * 0.16;
    if (!isOpen) {
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(0, H - footerH, W, footerH);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      fitText(ctx, 'KAPALI', W - pad * 2, footerH * 0.6, DISPLAY);
      ctx.fillText('KAPALI', W / 2, H - footerH / 2);
    }

    const bodyH = H - headerH - footerH;
    const rowH = bodyH / rows.length;
    // Two columns that never share space: name on the left, price on the right.
    const priceW = (W - pad * 2) * 0.42;
    const labelW = (W - pad * 2) * 0.52;

    rows.forEach((row, i) => {
      const top = headerH + i * rowH;
      const midY = top + rowH / 2;

      if (i % 2 === 1) {
        ctx.fillStyle = '#0f1a2e';
        ctx.fillRect(0, top, W, rowH);
      }

      ctx.fillStyle = row.color;
      ctx.textAlign = 'left';
      fitText(ctx, row.label, labelW, rowH * 0.42, DISPLAY);
      ctx.fillText(row.label, pad, midY);

      ctx.fillStyle = row.dim ? '#475569' : '#f8fafc';
      ctx.textAlign = 'right';
      fitText(ctx, row.value, priceW, rowH * 0.5, MONO);
      ctx.fillText(row.value, W - pad, midY);
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, [boardKey, spec.width, spec.height, lit, rows, isOpen]);

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
