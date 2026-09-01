import React from 'react';
import * as THREE from 'three';

/**
 * The visible half of a lamp: the pool it throws on the ground, the shaft of
 * light between the two, and the flare around the lens.
 *
 * A bare point light cannot do this job here. Hung seven metres up it spreads
 * its falloff over the whole forecourt, so at ground level it reads as a
 * slightly less dark patch rather than a lamp being on — which is exactly how
 * the old poles looked at night. Real lights still do the work of lighting the
 * cars and the pumps; these meshes are what makes the lamp legible.
 *
 * All of it is additive and writes no depth, so it layers over tarmac, grass
 * and paint without any sorting to get wrong, and costs no lights.
 */

/** Warm falloff shared by every pool and flare, built once. */
let cachedFalloff: THREE.CanvasTexture | null = null;

function falloffTexture(): THREE.CanvasTexture {
  if (cachedFalloff) return cachedFalloff;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // A hot core that falls away fast, then a long faint skirt: the shape a real
  // lamp throws, and the thing a linear gradient always gets wrong.
  gradient.addColorStop(0, 'rgba(255, 244, 214, 1)');
  gradient.addColorStop(0.18, 'rgba(255, 232, 186, 0.82)');
  gradient.addColorStop(0.42, 'rgba(255, 214, 150, 0.34)');
  gradient.addColorStop(0.7, 'rgba(255, 200, 130, 0.09)');
  gradient.addColorStop(1, 'rgba(255, 190, 120, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  cachedFalloff = new THREE.CanvasTexture(canvas);
  cachedFalloff.colorSpace = THREE.SRGBColorSpace;
  return cachedFalloff;
}

/** Every glow shares one texture and the same additive, depth-blind setup. */
const glowSettings = (color: string, opacity: number) => ({
  map: falloffTexture(),
  color: new THREE.Color(color),
  transparent: true,
  opacity,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false
});

/**
 * One material per layer for the whole scene rather than one per lamp: these
 * never vary, and sharing them keeps a row of columns from thrashing material
 * state — and from leaking a material every time a lamp is torn down.
 */
const materials = {
  shaft: null as THREE.MeshBasicMaterial | null,
  flare: null as THREE.SpriteMaterial | null
};

/**
 * Pools of a given strength, one material each and shared thereafter.
 *
 * A wide pool cannot carry the same opacity as a narrow one. These blend
 * additively, so spreading 0.85 over three times the ground saturates to flat
 * white and takes the concrete's own texture with it — the lamp stops looking
 * like light on a surface and starts looking like a hole cut in the scene.
 */
const poolMaterials = new Map<number, THREE.MeshBasicMaterial>();

function poolMaterial(opacity: number): THREE.MeshBasicMaterial {
  let material = poolMaterials.get(opacity);
  if (!material) {
    material = new THREE.MeshBasicMaterial(glowSettings('#ffd9a0', opacity));
    poolMaterials.set(opacity, material);
  }
  return material;
}

function shaftMaterial(): THREE.MeshBasicMaterial {
  return (materials.shaft ??= new THREE.MeshBasicMaterial({
    ...glowSettings('#ffe3b4', 0.13),
    side: THREE.DoubleSide
  }));
}

function flareMaterial(): THREE.SpriteMaterial {
  return (materials.flare ??= new THREE.SpriteMaterial(glowSettings('#fff3d2', 0.95)));
}

export interface LampGlowProps {
  /** Where the lens hangs, in the parent's space. */
  position: [number, number, number];
  /** Radius of the pool on the ground. */
  reach: number;
  /**
   * How far the pool is drawn out along world x — the road direction. A real
   * lamp throws an oval down the carriageway, never a circle.
   */
  stretch?: number;
  /**
   * Widens the pool on the ground without touching the lens flare or the
   * shaft, which are sized by `reach`. A lamp that throws further needs a
   * bigger pool, not a bigger glare around its own bulb.
   */
  spread?: number;
  /** How strongly the pool is laid on. Wider pools want less. */
  poolOpacity?: number;
  /**
   * The shaft between lens and pool. Worth its fill cost on the lamps the
   * player buys and stands next to; not on a row of motorway columns.
   */
  shaft?: boolean;
  lit: boolean;
}

/**
 * Pool, shaft and flare for one lamp. Renders nothing by day, so an unlit
 * station costs exactly what it did before.
 */
export const LampGlow: React.FC<LampGlowProps> = ({
  position,
  reach,
  stretch = 1.35,
  spread = 1,
  poolOpacity = 0.85,
  shaft = true,
  lit
}) => {
  if (!lit) return null;

  const [x, y, z] = position;

  return (
    <group>
      {/* Pool on the ground. Lifted clear of the tarmac and its markings so it
          never fights them for the same depth. */}
      <mesh
        position={[x, 0.06, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[stretch, 1, 1]}
        material={poolMaterial(poolOpacity)}
        renderOrder={2}
      >
        <planeGeometry args={[reach * 2 * spread, reach * 2 * spread]} />
      </mesh>

      {/* Shaft of light. Open-ended and faint: enough to tie the lens to the
          pool, not enough to look like fog. */}
      {shaft && (
        <mesh position={[x, y / 2, z]} material={shaftMaterial()} renderOrder={3}>
          <coneGeometry args={[reach * 0.62, y, 18, 1, true]} />
        </mesh>
      )}

      {/* Flare around the lens itself, always facing the camera. */}
      <sprite
        position={[x, y, z]}
        scale={[reach * 0.7, reach * 0.7, 1]}
        material={flareMaterial()}
        renderOrder={4}
      />
    </group>
  );
};
