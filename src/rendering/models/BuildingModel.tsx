import React, { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { BUILDING_MODELS, BUILDING_MODEL_URLS } from './buildingModels';
import { FasciaSign } from '../FasciaSign';

export interface ModelSign {
  text: string;
  color: string;
  textColor: string;
}

interface BuildingModelProps {
  type: string;
  /** Catalogue footprint in grid cells; world units are twice this. */
  footprint: [number, number];
  /** Name board to hang on the building, positioned from its own geometry. */
  sign?: ModelSign;
}

/**
 * Renders a catalogue building from its Kenney model, sized to the footprint
 * the game reserved for it and resting on the ground.
 *
 * Both the scale and the ground offset are measured from the model rather
 * than hand-tuned, so swapping in a different model needs no new numbers. The
 * name board is placed from the same measurement: a model rarely fills the plot
 * it was given, so a board positioned from the footprint ends up hanging in the
 * air beside the building rather than fixed to it.
 */
export const BuildingModel: React.FC<BuildingModelProps> = ({ type, footprint, sign }) => {
  const config = BUILDING_MODELS[type];
  const { scene } = useGLTF(config.url);

  const { model, groundOffset, extent } = useMemo(() => {
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

    clone.scale.set(scale, scale * (config.heightScale || 1), scale);
    clone.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(clone);

    return {
      model: clone,
      groundOffset: -scaled.min.y,
      extent: scaled.getSize(new THREE.Vector3())
    };
  }, [scene, config, footprint]);

  const rotation = ((config.rotationOffset || 0) * Math.PI) / 180;
  const onWall = config.signAnchor != null;

  // The box is measured before the model is turned, so its axes are the
  // model's own: x across the facade, z through it. The board is hung in that
  // same frame and turned with the building, so it stays on the shop front
  // wherever the building ends up pointing.
  const signYaw = rotation + ((config.signYaw || 0) * Math.PI) / 180;

  return (
    <>
      <primitive object={model} position={[0, groundOffset, 0]} rotation={[0, rotation, 0]} />

      {sign && (
        <group rotation={[0, signYaw, 0]}>
          <FasciaSign
            text={sign.text}
            color={sign.color}
            textColor={sign.textColor}
            width={Math.max(2.2, extent.x * 0.72)}
            y={onWall ? extent.y * config.signAnchor! : extent.y}
            anchor={onWall ? 'center' : 'bottom'}
            wallOffset={onWall ? extent.z / 2 : 0}
          />
        </group>
      )}
    </>
  );
};

for (const url of BUILDING_MODEL_URLS) useGLTF.preload(url);
