import React from 'react';
import { useGameStore } from '../store/gameStore';
import { DECAL } from './decal';
import { GAME_CONFIG } from '../config/gameConfig';
import { BayPad } from './BayPad';
import {
  pumpBayOffset,
  SERVICE_BAY_TYPES
} from '../domain/services/simulationEngine';

export const BuildPreviewMesh: React.FC = () => {
  const buildMode = useGameStore((s) => s.buildMode);
  if (!buildMode.active || !buildMode.buildingType) return null;

  const catalog = GAME_CONFIG.buildings[buildMode.buildingType];
  if (!catalog) return null;

  const width = catalog.size[0] * 2;
  const depth = catalog.size[1] * 2;
  const posX = buildMode.position[0] * 2;
  const posZ = buildMode.position[1] * 2;

  const color = buildMode.isValid ? '#22c55e' : '#ef4444';

  // Emre'nin 2026-09-02 isteği: duruş alanı inşaat ÖNİZLEMESİNDE görünür ve
  // R ile yapıyla birlikte döner — oyuncu ön yüzü daha kurarken seçer.
  const bayOffset = SERVICE_BAY_TYPES.includes(buildMode.buildingType)
    ? pumpBayOffset({ rotation: buildMode.rotation })
    : null;

  return (
    <group position={[posX, 0.05, posZ]} rotation={[0, (buildMode.rotation * Math.PI) / 180, 0]}>
      {/* Semi-transparent placement footprint */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial color={color} opacity={0.5} transparent {...DECAL} />
      </mesh>

      {bayOffset && (
        <BayPad
          worldOffset={[bayOffset[0] * 2, bayOffset[1] * 2]}
          worldAlong={buildMode.rotation % 180 !== 0 ? 'x' : 'z'}
          rotationDeg={buildMode.rotation}
          color={buildMode.isValid ? '#22c55e' : '#ef4444'}
        />
      )}

      {/* Wireframe box preview */}
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[width, 2.4, depth]} />
        <meshStandardMaterial color={color} wireframe transparent opacity={0.8} />
      </mesh>
    </group>
  );
};
