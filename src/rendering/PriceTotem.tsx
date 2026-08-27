import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { hourOfDay } from '../domain/services/simulationEngine';
import { GAME_CONFIG } from '../config/gameConfig';
import { FuelType } from '../domain/types/gameState';

interface PriceTotemProps {
  level: number;
}

/**
 * The board, by level. It is a slab standing on the ground rather than a panel
 * on a mast — that is the shape a roadside price totem actually is, and the
 * one that reads as solid at this scale.
 */
const LEVELS = [
  { width: 2.6, height: 7.4, depth: 0.62 },
  { width: 3.2, height: 9.0, depth: 0.7 },
  { width: 3.8, height: 10.8, depth: 0.78 }
];

const FUEL_ROWS: Array<{ fuel: FuelType; label: string }> = [
  { fuel: 'gasoline', label: 'BENZİN' },
  { fuel: 'diesel', label: 'DİZEL' },
  { fuel: 'lpg', label: 'LPG' }
];

const DISPLAY = '"Chakra Petch", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Shrinks a string until it fits the space it has been given. */
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

/**
 * The forecourt price totem: the station's name across the top, the pump
 * prices down the face, and whether it is open along the bottom.
 *
 * It stands square across the carriageway rather than along it. A board turned
 * edge-on to the traffic is unreadable until the driver is already past the
 * entrance — the one moment the prices are no use to them — which is why every
 * real one faces the cars coming at it.
 *
 * The face is drawn to a canvas and used as a texture, so the digits sit on the
 * sign itself rather than floating in front of it as an overlay.
 */
export const PriceTotem: React.FC<PriceTotemProps> = ({ level }) => {
  const pricing = useGameStore((s) => s.gameState.pricing);
  const tanks = useGameStore((s) => s.gameState.tanks);
  const buildings = useGameStore((s) => s.gameState.buildings);
  const stationName = useGameStore((s) => s.gameState.station.name);
  const isOpen = useGameStore((s) => s.gameState.station.open);
  const gameTime = useGameStore((s) => s.gameState.dayState.gameTime);

  const spec = LEVELS[Math.min(LEVELS.length, Math.max(1, level)) - 1];
  const hour = hourOfDay(gameTime);
  const lit = hour < 7.5 || hour > 18.5;

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

  // Prices only change when the player or the manager sets them, so the canvas
  // is redrawn on change rather than every frame.
  const boardKey =
    rows.map((r) => `${r.label}:${r.value}`).join('|') + `|${stationName}|${isOpen}`;

  const texture = useMemo(() => {
    const scale = 128;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(spec.width * scale);
    canvas.height = Math.round(spec.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const W = canvas.width;
    const H = canvas.height;
    const pad = W * 0.07;

    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';

    // The station's name across the top, in house colours.
    const headerH = H * 0.17;
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    fitText(ctx, stationName.toUpperCase(), W - pad * 2, headerH * 0.42, DISPLAY);
    ctx.fillText(stationName.toUpperCase(), W / 2, headerH / 2);

    // Open or shut along the bottom, where the operator's name usually goes.
    const footerH = H * 0.11;
    ctx.fillStyle = isOpen ? '#15803d' : '#b91c1c';
    ctx.fillRect(0, H - footerH, W, footerH);
    ctx.fillStyle = '#ffffff';
    fitText(ctx, isOpen ? 'AÇIK' : 'KAPALI', W - pad * 2, footerH * 0.55, DISPLAY);
    ctx.fillText(isOpen ? 'AÇIK' : 'KAPALI', W / 2, H - footerH / 2);

    // Prices in between, each in its own cassette the way they are built.
    const bodyTop = headerH;
    const rowH = (H - headerH - footerH) / rows.length;

    rows.forEach((row, i) => {
      const top = bodyTop + i * rowH;
      const midY = top + rowH / 2;

      ctx.fillStyle = '#0b1220';
      ctx.fillRect(pad * 0.5, top + rowH * 0.08, W - pad, rowH * 0.84);

      // Fuel name on a coloured chip, price in big digits beside it.
      const chipX = pad * 0.5 + rowH * 0.12;
      const chipW = (W - pad) * 0.36;
      ctx.fillStyle = row.color;
      ctx.fillRect(chipX, top + rowH * 0.26, chipW, rowH * 0.48);

      ctx.fillStyle = '#0b1220';
      ctx.textAlign = 'center';
      fitText(ctx, row.label, chipW * 0.86, rowH * 0.28, DISPLAY);
      ctx.fillText(row.label, chipX + chipW / 2, midY);

      ctx.fillStyle = row.dim ? '#475569' : '#f8fafc';
      ctx.textAlign = 'right';
      fitText(ctx, row.value, (W - pad) * 0.52, rowH * 0.5, MONO);
      ctx.fillText(row.value, W - pad * 0.9, midY);
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, [boardKey, spec.width, spec.height, rows, stationName, isOpen]);

  // Canvas textures hold a GPU allocation; release it when it is replaced.
  useEffect(() => () => texture?.dispose(), [texture]);

  const { width, height, depth } = spec;
  const plinth = 0.44;
  const faceInset = 0.18;

  return (
    // Turned square across the road, so the face meets the traffic head on.
    <group rotation={[0, -Math.PI / 2, 0]}>
      {/* The brick base these stand on */}
      <mesh position={[0, plinth / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.7, plinth, depth + 0.7]} />
        <meshStandardMaterial color="#8b6f5e" roughness={0.95} />
      </mesh>

      {/* One slab, ground to top, in a pale surround. */}
      <mesh position={[0, plinth + height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.55} metalness={0.05} />
      </mesh>

      {/* The face, on both sides so it reads from either direction. */}
      {texture &&
        [1, -1].map((facing) => (
          <mesh
            key={facing}
            position={[0, plinth + height / 2, facing * (depth / 2 + 0.012)]}
            rotation={[0, facing > 0 ? 0 : Math.PI, 0]}
          >
            <planeGeometry args={[width - faceInset, height - faceInset]} />
            <meshBasicMaterial map={texture} toneMapped={false} />
          </mesh>
        ))}

      {/* Lit from within after dark, as these are. */}
      {lit && (
        <pointLight
          position={[0, plinth + height * 0.6, depth / 2 + 1.2]}
          intensity={26}
          distance={13}
          decay={2}
          color="#fff3d6"
        />
      )}
    </group>
  );
};
