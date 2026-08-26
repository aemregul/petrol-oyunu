import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * The name board on top of a building.
 *
 * These used to be HTML overlays floating in front of the model, which read as
 * a hologram hanging in mid-air rather than as signage — they stayed the same
 * size however far away the camera was, and always faced it square on. Drawing
 * the text to a canvas and hanging it on a board puts the name where a real one
 * goes: part of the scene, at the building's own scale, lit by the same light
 * and hidden when something passes in front of it.
 *
 * It sits over the centre of the footprint rather than against a wall, because
 * the models do not all fill the plot they are given — a board pinned to where
 * the front wall ought to be ends up hanging in the air beside the building.
 */
interface FasciaSignProps {
  text: string;
  /** Band colour and the colour of the lettering on it. */
  color: string;
  textColor: string;
  /** Footprint of the building, in grid units. */
  size: [number, number];
  /** How high above the ground the board is mounted, in world units. */
  height: number;
}

const FONT = '"Chakra Petch", system-ui, sans-serif';

export const FasciaSign: React.FC<FasciaSignProps> = ({
  text,
  color,
  textColor,
  size,
  height
}) => {
  // Wide enough to read from the road, but never wider than the wall it is on.
  const width = Math.max(2.2, size[0] * 2 * 0.78);
  const boardHeight = Math.min(1.1, Math.max(0.6, width * 0.2));

  const texture = useMemo(() => {
    const scale = 128;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(boardHeight * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shrink to fit rather than overflow: some of these names are long.
    let px = H * 0.55;
    ctx.font = `bold ${px}px ${FONT}`;
    while (ctx.measureText(text).width > W * 0.9 && px > 6) {
      px -= 1;
      ctx.font = `bold ${px}px ${FONT}`;
    }
    ctx.fillText(text, W / 2, H / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, [text, color, textColor, width, boardHeight]);

  // Canvas textures hold a GPU allocation; release it when it is replaced.
  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) return null;

  return (
    <group position={[0, height, 0]}>
      <mesh castShadow>
        <boxGeometry args={[width + 0.16, boardHeight + 0.16, 0.14]} />
        <meshStandardMaterial color="#1e293b" roughness={0.8} />
      </mesh>

      {/* Lettered on both faces. The camera orbits to four fixed angles and a
          board readable from only one of them is a board the player spends
          half the game looking at the back of. */}
      {[1, -1].map((facing) => (
        <mesh key={facing} position={[0, 0, facing * 0.08]} rotation={[0, facing > 0 ? 0 : Math.PI, 0]}>
          <planeGeometry args={[width, boardHeight]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
};
