import React, { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { BUILDING_MODELS, BUILDING_MODEL_URLS } from './buildingModels';

interface BuildingModelProps {
  type: string;
  /** Catalogue footprint in grid cells; world units are twice this. */
  footprint: [number, number];
}

/**
 * Renders a catalogue building from its Kenney model, sized to the footprint
 * the game reserved for it and resting on the ground.
 *
 * Both the scale and the ground offset are measured from the model rather
 * than hand-tuned, so swapping in a different model needs no new numbers.
 */
export const BuildingModel: React.FC<BuildingModelProps> = ({ type, footprint }) => {
  const config = BUILDING_MODELS[type];
  const { scene } = useGLTF(config.url);

  const { model, groundOffset } = useMemo(() => {
    const clone = scene.clone(true);

    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;

      // Clone the material so a tint never leaks to other instances.
      const material = (child.material as THREE.MeshStandardMaterial).clone();
      if (config.tint) material.color = new THREE.Color(config.tint);
      material.roughness = 0.75;
      child.material = material;
    });

    clone.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(clone);
    const size = raw.getSize(new THREE.Vector3());

    let scale: number;
    if (config.fit === 'height') {
      scale = (config.targetHeight || 4) / Math.max(0.001, size.y);
    } else {
      // Fill the reserved plot without spilling over either edge.
      const targetWidth = footprint[0] * 2;
      const targetDepth = footprint[1] * 2;
      scale = Math.min(targetWidth / Math.max(0.001, size.x), targetDepth / Math.max(0.001, size.z));

      if (config.maxHeight) {
        scale = Math.min(scale, config.maxHeight / Math.max(0.001, size.y));
      }
    }

    clone.scale.setScalar(scale);
    clone.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(clone);

    return { model: clone, groundOffset: -scaled.min.y };
  }, [scene, config, footprint]);

  return (
    <primitive
      object={model}
      position={[0, groundOffset, 0]}
      rotation={[0, ((config.rotationOffset || 0) * Math.PI) / 180, 0]}
    />
  );
};

for (const url of BUILDING_MODEL_URLS) useGLTF.preload(url);
