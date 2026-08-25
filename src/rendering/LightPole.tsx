import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { LampGlow } from './LampGlow';

/** Full darkness before this hour and after DUSK; lamps burn between them. */
const DAWN = 7.5;
const DUSK = 18.5;

/**
 * The photocell every lamp in the game shares: overcast skies bring them on
 * early, as real ones do. Exported so the highway columns switch on at the
 * same moment as the forecourt lamps.
 */
export function lampsAreLit(
  gameTime: number,
  weather: 'SUNNY' | 'OVERCAST' | 'RAIN'
): boolean {
  const dawn = weather === 'SUNNY' ? DAWN : DAWN + 0.8;
  const dusk = weather === 'SUNNY' ? DUSK : DUSK - 0.8;
  return gameTime < dawn || gameTime > dusk;
}

/**
 * A forecourt lamp post. Hand-built rather than a kit model, and it casts a
 * real light onto the apron once the sun is low — the whole point of paying
 * for one.
 */
export const LightPole: React.FC = () => {
  const gameTime = useGameStore((s) => s.gameState.dayState.gameTime);
  const weather = useGameStore((s) => s.gameState.dayState.weather);
  const quality = useGameStore((s) => s.gameState.settings.graphicsQuality);

  const isDark = lampsAreLit(gameTime, weather);

  // The spot needs something in the scene graph to aim at; a bare Object3D
  // parented beside it keeps the aim in the pole's own space, so a rotated
  // pole still lights the ground under its own arm.
  const target = useMemo(() => new THREE.Object3D(), []);

  // Fade rather than snap, so switch-on reads as a dimming lamp warming up.
  const glow = isDark ? 1 : 0.08;

  return (
    <group>
      {/* Base plinth */}
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.34, 0.42, 0.36, 10]} />
        <meshStandardMaterial color="#475569" roughness={0.8} />
      </mesh>

      {/* Tapered column */}
      <mesh position={[0, 3.6, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.2, 6.8, 10]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.55} roughness={0.45} />
      </mesh>

      {/* Curved arm reaching out over the apron */}
      <mesh position={[0.5, 7.05, 0]} rotation={[0, 0, -Math.PI / 2.6]} castShadow>
        <cylinderGeometry args={[0.1, 0.12, 1.5, 10]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.55} roughness={0.45} />
      </mesh>

      {/* Lamp housing and lens */}
      <group position={[1.15, 7.25, 0]}>
        <mesh castShadow>
          <boxGeometry args={[1.15, 0.26, 0.55]} />
          <meshStandardMaterial color="#64748b" metalness={0.5} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.16, 0]}>
          <boxGeometry args={[0.95, 0.1, 0.42]} />
          <meshStandardMaterial
            color="#fff6d8"
            emissive="#ffe9a8"
            emissiveIntensity={glow * 3}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* The pool, shaft and flare that make the lamp read as lit. */}
      <LampGlow position={[1.15, 7.05, 0]} reach={5.4} lit={isDark} />

      {/* The actual light. A spot aimed at the apron rather than a bare point:
          hung this high a point light spreads its falloff over the whole
          forecourt and lands as a faint wash, while a cone puts the light
          where the lamp is pointing and gives the pool an edge. Kept off in
          daylight so it costs nothing then. */}
      {isDark && (
        <>
          <primitive object={target} position={[1.15, 0, 0]} />
          <spotLight
            position={[1.15, 7, 0]}
            target={target}
            angle={0.62}
            penumbra={0.55}
            intensity={520}
            distance={30}
            decay={2}
            color="#ffe0ae"
            castShadow={quality === 'HIGH'}
            shadow-mapSize={[512, 512]}
            shadow-bias={-0.002}
          />
        </>
      )}
    </group>
  );
};
