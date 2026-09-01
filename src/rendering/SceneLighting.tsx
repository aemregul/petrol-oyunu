import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { hourOfDay } from '../domain/services/simulationEngine';

/**
 * Sun colour and intensity right round the clock.
 *
 * The day used to stop at ten in the evening, so there was never a night to
 * light. Now it runs to six the next morning, which means the small hours have
 * to look like the small hours — dark enough for the forecourt lamps to be
 * doing the work, and lifting again before the first commuters.
 *
 * The small hours used to sit near black: the concrete read as a void, and the
 * only way to see the forecourt at all was to stand a lamp on every square.
 * Night is a moonlit blue now rather than an absence of light — still plainly
 * night, still worth paying for lamps, but you can see what you own.
 */
const SUN_KEYFRAMES = [
  { hour: 0, color: '#6f7fb8', intensity: 0.62, ambient: 0.46, sky: '#26314e' },
  { hour: 4, color: '#7182bb', intensity: 0.66, ambient: 0.48, sky: '#2c3757' },
  { hour: 5.5, color: '#c98d78', intensity: 1.0, ambient: 0.56, sky: '#6b6f95' },
  { hour: 6.5, color: '#ffc590', intensity: 1.5, ambient: 0.62, sky: '#ffd4a8' },
  { hour: 8, color: '#ffe9cc', intensity: 1.9, ambient: 0.72, sky: '#d3eaff' },
  { hour: 12, color: '#fffdf8', intensity: 2.2, ambient: 0.82, sky: '#c6e7ff' },
  { hour: 17, color: '#ffe2bc', intensity: 2.0, ambient: 0.76, sky: '#d0e7fb' },
  { hour: 19.5, color: '#ffab70', intensity: 1.45, ambient: 0.6, sky: '#f7bb87' },
  { hour: 21, color: '#8d9cd4', intensity: 0.95, ambient: 0.52, sky: '#556289' },
  { hour: 22.5, color: '#7182bb', intensity: 0.68, ambient: 0.48, sky: '#2e3959' },
  { hour: 24, color: '#6f7fb8', intensity: 0.62, ambient: 0.46, sky: '#26314e' }
];

function sampleSun(hour: number) {
  const first = SUN_KEYFRAMES[0];
  const last = SUN_KEYFRAMES[SUN_KEYFRAMES.length - 1];
  if (hour <= first.hour) return { ...first };
  if (hour >= last.hour) return { ...last };

  for (let i = 0; i < SUN_KEYFRAMES.length - 1; i++) {
    const a = SUN_KEYFRAMES[i];
    const b = SUN_KEYFRAMES[i + 1];
    if (hour >= a.hour && hour <= b.hour) {
      const t = (hour - a.hour) / (b.hour - a.hour);
      return {
        hour,
        color: new THREE.Color(a.color).lerp(new THREE.Color(b.color), t).getStyle(),
        intensity: a.intensity + (b.intensity - a.intensity) * t,
        ambient: a.ambient + (b.ambient - a.ambient) * t,
        sky: new THREE.Color(a.sky).lerp(new THREE.Color(b.sky), t).getStyle()
      };
    }
  }
  return { ...last };
}

/**
 * Drives the sun, ambient fill and sky colour from the in-game clock and
 * weather, so the forecourt reads as morning, midday or dusk.
 */
export const SceneLighting: React.FC = () => {
  const gameTime = useGameStore((s) => s.gameState.dayState.gameTime);
  const weather = useGameStore((s) => s.gameState.dayState.weather);
  const quality = useGameStore((s) => s.gameState.settings.graphicsQuality);

  const { scene } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);

  const skyColor = useRef(new THREE.Color('#a8d8ff'));
  const sunColor = useRef(new THREE.Color('#fff6e0'));

  // Overcast flattens and cools the light; rain more so.
  const weatherDamping = weather === 'RAIN' ? 0.55 : weather === 'OVERCAST' ? 0.78 : 1;

  // Far enough out that it only softens the horizon, never the forecourt.
  const fog = useMemo(() => new THREE.Fog('#a8d8ff', 190, 460), []);

  useFrame((_, delta) => {
    const sample = sampleSun(hourOfDay(gameTime));
    const ease = Math.min(1, delta * 2);

    sunColor.current.lerp(new THREE.Color(sample.color), ease);
    skyColor.current.lerp(new THREE.Color(sample.sky), ease);

    if (sunRef.current) {
      sunRef.current.color.copy(sunColor.current);
      sunRef.current.intensity +=
        (sample.intensity * weatherDamping - sunRef.current.intensity) * ease;

      // Sweep the sun across the sky through the daylight hours, and leave it
      // below the horizon overnight so the lamps are what lights the place.
      const daylight = THREE.MathUtils.clamp((hourOfDay(gameTime) - 6) / 15, 0, 1);
      const arc = Math.PI * daylight;
      sunRef.current.position.set(
        32 - Math.cos(arc) * 55,
        12 + Math.sin(arc) * 48,
        18 - Math.cos(arc) * 25
      );
    }

    if (ambientRef.current) {
      ambientRef.current.intensity +=
        (sample.ambient * (weather === 'RAIN' ? 0.85 : 1) - ambientRef.current.intensity) * ease;
    }

    if (hemiRef.current) hemiRef.current.color.copy(skyColor.current);

    scene.background = skyColor.current;
    fog.color.copy(skyColor.current);
    scene.fog = fog;
  });

  const shadowSize = quality === 'HIGH' ? 2048 : 1024;

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.6} />
      <directionalLight
        ref={sunRef}
        position={[35, 45, 25]}
        intensity={1.8}
        castShadow={quality !== 'LOW'}
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-far={140}
        shadow-bias={-0.0008}
        shadow-normalBias={0.02}
      />
      <hemisphereLight ref={hemiRef} groundColor="#3f4a2e" intensity={0.45} />
    </>
  );
};
