import React, { useMemo } from 'react';
import { useFBX } from '@react-three/drei';
import * as THREE from 'three';
import { VehicleArchetype, VehicleModelVariant } from '../../domain/types/gameState';
import {
  DEFAULT_VEHICLE_MODEL,
  VEHICLE_MODELS,
  VEHICLE_MODEL_URLS
} from './vehicleModels';
import { ElectricVehicleModel } from './ElectricVehicleModel';

interface VehicleModelProps {
  archetype: VehicleArchetype;
  vehicleId: string;
  modelVariant?: VehicleModelVariant;
  /** Metres travelled this frame, used to roll the wheels realistically. */
  speed: number;
}

function isRoadWheel(name: string): boolean {
  return name.toLowerCase().includes('wheel');
}

const AssetVehicleModel: React.FC<Required<Pick<VehicleModelProps, 'modelVariant'>>> = ({
  modelVariant
}) => {
  const config = VEHICLE_MODELS[modelVariant];
  const source = useFBX(config.url);

  const { model, offset } = useMemo(() => {
    const clone = source.clone(true);
    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      if (isRoadWheel(child.name)) {
        // The FBX pack already contains the correct wheel pose. Its meshes do
        // not share one pivot convention, so rotating them generically makes
        // some tyres orbit the car or turn edge-on. Keep them static; at the
        // game's isometric scale this looks cleaner and preserves every model.
        child.scale.multiplyScalar(config.wheelScale ?? 1);
        child.position.x *= config.wheelTrackScale ?? 1;
      }

      child.castShadow = true;
      child.receiveShadow = true;
      const sources = Array.isArray(child.material) ? child.material : [child.material];
      const materials = sources.map((sourceMaterial) => {
        const material = sourceMaterial.clone();
        if ('roughness' in material) {
          (material as THREE.MeshStandardMaterial).roughness = 0.48;
        }
        return material;
      });
      child.material = Array.isArray(child.material) ? materials : materials[0];
    });

    clone.updateMatrixWorld(true);
    const rawBounds = new THREE.Box3().setFromObject(clone);
    const rawSize = rawBounds.getSize(new THREE.Vector3());
    const scale = config.targetLength / Math.max(rawSize.z, 0.001);
    clone.scale.multiplyScalar(scale);
    clone.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(clone);
    const center = bounds.getCenter(new THREE.Vector3());
    return {
      model: clone,
      offset: new THREE.Vector3(-center.x, -bounds.min.y, -center.z)
    };
  }, [source, config.targetLength, config.wheelScale, config.wheelTrackScale]);

  return <primitive object={model} position={offset} />;
};

export const VehicleModel: React.FC<VehicleModelProps> = ({
  archetype,
  vehicleId,
  modelVariant,
  speed
}) => {
  if (archetype === 'ev') {
    return <ElectricVehicleModel vehicleId={vehicleId} speed={speed} />;
  }

  const selected = modelVariant ?? DEFAULT_VEHICLE_MODEL[archetype];
  return <AssetVehicleModel modelVariant={selected} />;
};

for (const url of VEHICLE_MODEL_URLS) useFBX.preload(url);
