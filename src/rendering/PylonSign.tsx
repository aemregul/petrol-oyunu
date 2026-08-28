import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { hourOfDay } from '../domain/services/simulationEngine';

/**
 * The tall roadside pylon.
 *
 * Its job is nothing to do with prices — those are on the totem down by the
 * mouths, where a driver reads them once they are already slowing. This one is
 * read from a kilometre away at speed, so it carries two things only: whose
 * station it is, and whether it is open.
 */
const FONT = '"Chakra Petch", system-ui, sans-serif';

/** Mast height by level, and how big the board on top of it is. */
const MAST = 13;
const BOARD_W = 5.2;
const BOARD_H = 6.4;

function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number
): void {
  let px = size;
  ctx.font = `bold ${px}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && px > 8) {
    px -= 1;
    ctx.font = `bold ${px}px ${FONT}`;
  }
}

export const PylonSign: React.FC = () => {
  const name = useGameStore((s) => s.gameState.station.name);
  const isOpen = useGameStore((s) => s.gameState.station.open);
  const gameTime = useGameStore((s) => s.gameState.dayState.gameTime);

  const hour = hourOfDay(gameTime);
  const lit = hour < 7.5 || hour > 18.5;

  const texture = useMemo(() => {
    const scale = 96;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(BOARD_W * scale);
    canvas.height = Math.round(BOARD_H * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const W = canvas.width;
    const H = canvas.height;
    const pad = W * 0.08;

    // Brand field, then the status band along the bottom.
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    const bandH = H * 0.2;
    ctx.fillStyle = isOpen ? '#15803d' : '#b91c1c';
    ctx.fillRect(0, H - bandH, W, bandH);

    // A block of house colour behind the name so it reads against the sky.
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(0, 0, W, H * 0.3);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#ffffff';
    fit(ctx, 'AKARYAKIT', W - pad * 2, H * 0.16);
    ctx.fillText('AKARYAKIT', W / 2, H * 0.15);

    // The station's own name gets the largest share of the board.
    ctx.fillStyle = '#0f172a';
    const words = name.toUpperCase().split(' ');
    const lines = words.length > 2 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : words;
    const lineH = (H * 0.5) / lines.length;

    lines.forEach((line, i) => {
      fit(ctx, line, W - pad * 2, Math.min(lineH * 0.72, H * 0.16));
      ctx.fillText(line, W / 2, H * 0.34 + lineH * (i + 0.5));
    });

    ctx.fillStyle = '#ffffff';
    fit(ctx, isOpen ? 'AÇIK' : 'KAPALI', W - pad * 2, bandH * 0.6);
    ctx.fillText(isOpen ? 'AÇIK' : 'KAPALI', W / 2, H - bandH / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, [name, isOpen]);

  // Canvas textures hold a GPU allocation; release it when it is replaced.
  useEffect(() => () => texture?.dispose(), [texture]);

  const boardY = MAST + BOARD_H / 2 - 0.6;

  return (
    <group>
      {/* Foundation */}
      <mesh position={[0, 0.24, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.48, 2.4]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.9} />
      </mesh>

      {/* Mast */}
      <mesh position={[0, MAST / 2, 0]} castShadow>
        <cylinderGeometry args={[0.34, 0.44, MAST, 16]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.5} roughness={0.45} />
      </mesh>

      {/* Board, faced on both sides so it reads from either direction. */}
      <group position={[0, boardY, 0]}>
        <mesh castShadow>
          <boxGeometry args={[BOARD_W + 0.3, BOARD_H + 0.3, 0.5]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.7} />
        </mesh>
        {texture &&
          [1, -1].map((facing) => (
            <mesh
              key={facing}
              position={[0, 0, facing * 0.3]}
              rotation={[0, facing > 0 ? 0 : Math.PI, 0]}
            >
              <planeGeometry args={[BOARD_W, BOARD_H]} />
              <meshBasicMaterial
                map={texture}
                toneMapped={false}
                polygonOffset
                polygonOffsetFactor={-2}
                polygonOffsetUnits={-2}
              />
            </mesh>
          ))}
      </group>

      {/* Floodlights on the board after dark, so it still works at night. */}
      {lit && (
        <pointLight
          position={[0, boardY - BOARD_H / 2 - 0.4, 1.6]}
          intensity={30}
          distance={14}
          decay={2}
          color="#fff4d6"
        />
      )}
    </group>
  );
};
