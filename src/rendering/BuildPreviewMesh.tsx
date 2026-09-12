import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store/gameStore';
import { DECAL } from './decal';
import { GAME_CONFIG } from '../config/gameConfig';
import { BayPad } from './BayPad';
import { BuildingBody } from './BuildingMesh';
import { PumpMesh } from './PumpMesh';
import { BuildingEntity, PumpEntity } from '../domain/types/gameState';
import {
  isChargerType,
  pumpBayOffset,
  SERVICE_BAY_TYPES
} from '../domain/services/simulationEngine';

const GHOST_OPACITY = 0.6;
const VALID_TINT = new THREE.Color('#22c55e');
const INVALID_TINT = new THREE.Color('#ef4444');

/** An object that no raycast can hit, so the preview never steals the pointer. */
const noRaycast = () => undefined;

/**
 * Draws its children as a placement ghost: translucent, untouchable by the
 * pointer, and washed green or red with the placement's validity.
 *
 * The work is done by walking the subtree every frame rather than once,
 * because a model arrives through Suspense some frames after the ghost
 * mounts, and the fascia boards and bay pads add meshes of their own. Every
 * body draws its own cloned materials, so nothing here leaks onto the real
 * forecourt. The pointer has to be kept off the ghost: a pump body carries
 * click handlers that would swallow the click meant for the placement plane.
 */
const Ghost: React.FC<{ valid: boolean; children: React.ReactNode }> = ({ valid, children }) => {
  const ref = useRef<THREE.Group>(null);

  useFrame(() => {
    const root = ref.current;
    if (!root) return;
    root.traverse((object) => {
      object.raycast = noRaycast;
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        if (!material.userData.ghost) {
          material.userData.ghost = true;
          material.transparent = true;
          material.opacity = Math.min(material.opacity, GHOST_OPACITY);
          material.needsUpdate = true;
        }
        const standard = material as THREE.MeshStandardMaterial;
        if (standard.emissive) {
          standard.emissive.copy(valid ? VALID_TINT : INVALID_TINT);
          standard.emissiveIntensity = valid ? 0.12 : 0.4;
        }
      }
    });
  });

  return <group ref={ref}>{children}</group>;
};

/**
 * The placement preview: the actual structure being placed, as a ghost, on
 * a coloured footprint. A pump is drawn as the pump it will be, with its bay
 * pad; everything else as the body the forecourt will draw once it stands.
 */
export const BuildPreviewMesh: React.FC = () => {
  const buildMode = useGameStore((s) => s.buildMode);
  const relocating = useGameStore((s) => s.relocating);

  const catalog = buildMode.buildingType ? GAME_CONFIG.buildings[buildMode.buildingType] : null;
  const level = relocating?.level ?? 1;

  // A stand-in entity for the body to draw itself from. Placed at the origin
  // of the preview group, which carries the real position and rotation.
  const ghostBuilding = useMemo<BuildingEntity | null>(
    () =>
      catalog
        ? {
            id: 'preview',
            type: catalog.type,
            level,
            position: [0, 0],
            rotation: 0,
            size: catalog.size,
            health: 100,
            constructionState: 'ACTIVE',
            builtAtTimestamp: 0
          }
        : null,
    [catalog, level]
  );

  // The pump draws itself at its own position, so it gets the real one.
  const ghostPump = useMemo<PumpEntity | null>(
    () =>
      catalog?.category === 'pump'
        ? {
            id: 'preview',
            level,
            position: buildMode.position,
            rotation: buildMode.rotation,
            supportedFuels: relocating?.pump?.supportedFuels ?? ['gasoline', 'diesel'],
            state: 'IDLE',
            health: 100,
            employeeId: null,
            currentVehicleId: null,
            flowRateLps: relocating?.pump?.flowRateLps ?? 8,
            hasCanopy: relocating?.pump?.hasCanopy ?? false
          }
        : null,
    [catalog, level, buildMode.position, buildMode.rotation, relocating]
  );

  if (!buildMode.active || !catalog || !ghostBuilding) return null;

  const width = catalog.size[0] * 2;
  const depth = catalog.size[1] * 2;
  const posX = buildMode.position[0] * 2;
  const posZ = buildMode.position[1] * 2;

  const color = buildMode.isValid ? '#22c55e' : '#ef4444';

  // Emre'nin 2026-09-02 isteği: duruş alanı inşaat ÖNİZLEMESİNDE görünür ve
  // R ile yapıyla birlikte döner — oyuncu ön yüzü daha kurarken seçer. The
  // pump ghost brings its own pad, so only the service bays draw one here.
  const bayOffset =
    !ghostPump && buildMode.buildingType && SERVICE_BAY_TYPES.includes(buildMode.buildingType)
      ? pumpBayOffset({ rotation: buildMode.rotation, type: buildMode.buildingType })
      : null;
  const bayAlong: 'x' | 'z' = isChargerType(buildMode.buildingType ?? undefined)
    ? buildMode.rotation % 180 === 0 ? 'x' : 'z'
    : buildMode.rotation % 180 !== 0 ? 'x' : 'z';

  return (
    <>
      <group position={[posX, 0.05, posZ]} rotation={[0, (buildMode.rotation * Math.PI) / 180, 0]}>
        {/* Semi-transparent placement footprint */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[width, depth]} />
          <meshBasicMaterial color={color} opacity={0.5} transparent {...DECAL} />
        </mesh>

        {bayOffset && (
          <BayPad
            worldOffset={[bayOffset[0] * 2, bayOffset[1] * 2]}
            worldAlong={bayAlong}
            rotationDeg={buildMode.rotation}
            color={color}
          />
        )}

        {!ghostPump && (
          <Ghost valid={buildMode.isValid}>
            <BuildingBody building={ghostBuilding} />
          </Ghost>
        )}
      </group>

      {ghostPump && (
        <Ghost valid={buildMode.isValid}>
          <PumpMesh pump={ghostPump} neighbours={[]} />
        </Ghost>
      )}
    </>
  );
};
