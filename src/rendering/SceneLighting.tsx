import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { hourOfDay } from '../domain/services/simulationEngine';
import { ownedBounds } from '../domain/services/land';

/**
 * How far past the owned land the shadow box reaches, in world units: the
 * road and verge in front, the scenery behind, and the length of a tall
 * building's shadow at a low sun.
 */
const SHADOW_MARGIN = 40;

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

/** The slice of a light's shadow this file has to manage. */
export interface ResizableShadow {
  mapSize: { x: number; y: number; set(x: number, y: number): unknown };
  map: { width: number; height: number; dispose(): void } | null;
}

/**
 * Puts a live light's shadow map at `size`, dropping the old texture if it
 * was a different size. Returns true when a map was dropped.
 *
 * three.js only allocates a shadow map when there is none (WebGLShadowMap
 * checks `shadow.map === null` and nothing else); a changed mapSize on a
 * light that already has one leaves the texture as it was but still sets the
 * depth pass's viewport from the new size. So switching Orta → Yüksek in
 * play drew a 2048 depth image into a 1024 texture: only a quarter fitted,
 * and every shadow the lookup found was scaled two-fold away from the box's
 * corner — the road's hedge, the columns' heads and the cars landed as long
 * dark streaks and blobs far out on the grass (Emre, 2026-09-09: "yüksek
 * ayarda bu gölge bozulmalarına bak"). Dropping the map makes three build a
 * fresh one, at the right size, on the next frame.
 */
export function resizeShadowMap(shadow: ResizableShadow, size: number): boolean {
  shadow.mapSize.set(size, size);
  const stale = shadow.map !== null && (shadow.map.width !== size || shadow.map.height !== size);
  if (stale && shadow.map) {
    shadow.map.dispose();
    shadow.map = null;
  }
  return stale;
}

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
  const ownedParcels = useGameStore((s) => s.gameState.station.plots.ownedParcels);

  const { scene } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null);
  // Where the sun looks, and what its shadow box has to hold: the land the
  // player owns, centred. A box fixed round the world origin worked for the
  // starting plot and no further — as the sun swept round, buildings out at
  // the edge of a grown plot left the box, and the part of their shadow that
  // touched the ground was cut off, leaving a loose grey slab drifting beside
  // the building (Emre, 2026-09-07).
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const shadowFrame = useMemo(() => {
    const owned = ownedBounds(ownedParcels);
    const minX = owned.minX * 2;
    const maxX = owned.width * 2;
    const minZ = owned.minZ * 2;
    const maxZ = owned.height * 2;
    return {
      centre: new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
      half: Math.max(maxX - minX, maxZ - minZ) / 2 + SHADOW_MARGIN
    };
  }, [ownedParcels]);
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
      // Placed relative to the plot's centre, and looking at it, so the
      // shadow box below is always the box around the land.
      const daylight = THREE.MathUtils.clamp((hourOfDay(gameTime) - 6) / 15, 0, 1);
      const arc = Math.PI * daylight;
      const { centre, half } = shadowFrame;
      const reach = half * 1.6;
      sunRef.current.position.set(
        centre.x - Math.cos(arc) * reach,
        12 + Math.sin(arc) * reach * 0.9,
        centre.z - Math.cos(arc) * reach * 0.45
      );
      sunTarget.position.copy(centre);
      sunTarget.updateMatrixWorld();
      sunRef.current.target = sunTarget;

      // The box is square to the light and holds the whole plot whichever way
      // the sun stands; the far plane reaches past the land's far corner and
      // the near plane starts well before its near one.
      const camera = sunRef.current.shadow.camera;
      const distance = sunRef.current.position.distanceTo(centre);
      const wanted = { side: half, near: Math.max(1, distance - half * 1.5), far: distance + half * 1.5 };
      if (
        camera.right !== wanted.side ||
        camera.near !== wanted.near ||
        camera.far !== wanted.far
      ) {
        camera.left = -wanted.side;
        camera.right = wanted.side;
        camera.top = wanted.side;
        camera.bottom = -wanted.side;
        camera.near = wanted.near;
        camera.far = wanted.far;
        camera.updateProjectionMatrix();
      }
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

  // A quality change in play must rebuild the sun's shadow map at the new
  // size; the prop below only changes the number, not the texture.
  useEffect(() => {
    if (sunRef.current) resizeShadowMap(sunRef.current.shadow, shadowSize);
  }, [shadowSize]);

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.6} />
      <directionalLight
        ref={sunRef}
        position={[35, 45, 25]}
        intensity={1.8}
        castShadow={quality !== 'LOW'}
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-bias={-0.0008}
        shadow-normalBias={0.02}
      />
      <primitive object={sunTarget} />
      <hemisphereLight ref={hemiRef} groundColor="#3f4a2e" intensity={0.45} />
    </>
  );
};
