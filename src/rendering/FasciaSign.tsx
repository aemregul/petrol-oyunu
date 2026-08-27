import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * The name board on a building.
 *
 * These used to be HTML overlays floating in front of the model, which read as
 * a hologram hanging in mid-air rather than as signage — they stayed the same
 * size however far away the camera was, and always faced it square on. Drawing
 * the text to a canvas and hanging it on a board puts the name where a real one
 * goes: part of the scene, at the building's own scale, lit by the same light
 * and hidden when something passes in front of it.
 *
 * A board is either fixed flat to a wall (`wallOffset`, the fascia over a shop
 * front) or laid across the roof. Neither may hover: a sign floating over a
 * building is the same hologram in a different costume.
 */
interface FasciaSignProps {
  text: string;
  /** Band colour and the colour of the lettering on it. */
  color: string;
  textColor: string;
  /** How wide the board is, in world units. */
  width: number;
  /** Where the board sits vertically, in world units. */
  y: number;
  /** Whether `y` is the middle of the board or the edge it rests on. */
  anchor?: 'center' | 'bottom';
  /**
   * Half-depth of the wall it is fixed to. The board is then fixed flat to the
   * front facade, the +z face of whatever frame it is given, the way a shop
   * fascia is. Zero lays a double-sided board across the roof instead.
   */
  wallOffset?: number;
}

const FONT = '"Chakra Petch", system-ui, sans-serif';
const THICKNESS = 0.14;

/** How deep a board of a given width is drawn. */
export function fasciaBoardHeight(width: number): number {
  return Math.min(1.1, Math.max(0.6, width * 0.2));
}

export const FasciaSign: React.FC<FasciaSignProps> = ({
  text,
  color,
  textColor,
  width,
  y,
  anchor = 'center',
  wallOffset = 0
}) => {
  const boardHeight = fasciaBoardHeight(width);
  const centreY = anchor === 'bottom' ? y + boardHeight / 2 : y;

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

  // Fixed flat to the front wall, read from outside it.
  if (wallOffset > 0) {
    return (
      <group position={[0, centreY, wallOffset + THICKNESS / 2]}>
        <mesh castShadow>
          <boxGeometry args={[width + 0.16, boardHeight + 0.16, THICKNESS]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0, THICKNESS / 2 + 0.01]}>
          <planeGeometry args={[width, boardHeight]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      </group>
    );
  }

  // Otherwise it lies across the roof, lettered on both faces.
  return (
    <group position={[0, centreY, 0]}>
      <mesh castShadow>
        <boxGeometry args={[width + 0.16, boardHeight + 0.16, THICKNESS]} />
        <meshStandardMaterial color="#1e293b" roughness={0.8} />
      </mesh>

      {[1, -1].map((facing) => (
        <mesh
          key={facing}
          position={[0, 0, facing * (THICKNESS / 2 + 0.01)]}
          rotation={[0, facing > 0 ? 0 : Math.PI, 0]}
        >
          <planeGeometry args={[width, boardHeight]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
};
