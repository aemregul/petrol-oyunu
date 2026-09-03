import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { hourOfDay } from '../domain/services/simulationEngine';
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
  const hour = hourOfDay(gameTime);
  return hour < dawn || hour > dusk;
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
            emissiveIntensity={glow * 2}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* The pool, shaft and flare that make the lamp read as lit. The pool is
          widened on its own: the lit ground has to match how far the lamp
          actually throws, while the glare around the bulb stays a bulb. */}
      <LampGlow
        position={[1.15, 7.05, 0]}
        reach={5.4}
        spread={2.8}
        poolOpacity={0.06}
        lit={isDark}
      />

      {/* The actual light. A spot aimed at the apron rather than a bare point:
          a cone puts the light where the lamp is pointing and gives the pool an
          edge. The cone was narrow enough that a lamp lit little more than its
          own base — to see the forecourt the player had to line it with poles —
          so it opens wider now and its edge is softer, and the intensity goes
          up with it because the far side of a broader cone is that much further
          from the bulb.

          The point light beside it is the spill: the part of a lamp that lands
          on the side of a car or a pump rather than on the ground. Without it a
          widened cone is still a hard-edged disc of tarmac with darkness
          standing on it. Both are off in daylight, so they cost nothing then.

          Neither uses a physical falloff. Inverse-square is what a real lamp
          does, and it is exactly what put all the light in a puddle at the foot
          of the pole: by the edge of even a wide cone only a third of it was
          left. Easing the decay carries the light out to the rim instead, which
          is the whole reason to own a lamp — so the intensity comes down to
          match, or the middle blows out again. */}
      {/* Emre'nin 2026-09-03 notu: lamba tek noktayı yakıyordu — dibi göz
          alıyor, iki adım ötesi karanlık kalıyordu. Yumuşatmanın üç ayağı:
          spot daha sönük ve daha düz düşüşle yanar (decay 1.05 — merkezle
          kenar arasındaki fark ~4 kattan ~2 kata iner), tam dibe vuran spill
          ışığı yarıya iner, penumbra tam açılır ki havuzun kenarı çizgi gibi
          durmasın. Toplam ışık azalmadı sayılır; sadece dipten alınıp kenara
          dağıtıldı. */}
      {isDark && (
        <>
          <primitive object={target} position={[1.15, 0, 0]} />
          <spotLight
            position={[1.15, 7, 0]}
            target={target}
            angle={1.12}
            penumbra={1}
            intensity={48}
            distance={62}
            decay={1.05}
            color="#ffe0ae"
            castShadow={quality === 'HIGH'}
            shadow-mapSize={[512, 512]}
            shadow-bias={-0.002}
          />
          <pointLight
            position={[1.15, 6.4, 0]}
            intensity={14}
            distance={30}
            decay={1.2}
            color="#ffdba6"
          />
        </>
      )}
    </group>
  );
};
