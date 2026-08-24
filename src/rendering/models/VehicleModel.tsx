import React, { useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VehicleArchetype } from '../../domain/types/gameState';
import { VEHICLE_MODELS, VEHICLE_MODEL_URLS } from './vehicleModels';

interface VehicleModelProps {
  archetype: VehicleArchetype;
  /** Metres travelled this frame, used to roll the wheels realistically. */
  speed: number;
}

/**
 * Only the four road wheels turn. The kit names them
 * `wheel-{front,back}-{left,right}`, while the spare bolted to the SUV's
 * tailgate is a bare `wheel-back` — matching on the side suffix keeps that one
 * still instead of spinning a tyre attached to the bodywork.
 */
function isRoadWheel(name: string): boolean {
  return name.startsWith('wheel-') && (name.endsWith('-left') || name.endsWith('-right'));
}

/**
 * Renders one Kenney vehicle. The loaded scene is shared between every car of
 * the same archetype, so it is cloned per instance and its material cloned
 * alongside it — otherwise tinting one car would tint all of them.
 */
export const VehicleModel: React.FC<VehicleModelProps> = ({ archetype, speed }) => {
  const config = VEHICLE_MODELS[archetype] || VEHICLE_MODELS.commuter;
  const { scene } = useGLTF(config.url);
  const wheelsRef = useRef<THREE.Object3D[]>([]);

  const { model, groundOffset } = useMemo(() => {
    const clone = scene.clone(true);
    const wheels: THREE.Object3D[] = [];

    clone.traverse((child) => {
      if (isRoadWheel(child.name)) wheels.push(child);

      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;

      // Clone the material so a tint stays local to this vehicle.
      const source = child.material as THREE.MeshStandardMaterial;
      const material = source.clone();
      if (config.tint && !child.name.startsWith('wheel')) {
        material.color = new THREE.Color(config.tint);
      }
      material.roughness = 0.55;
      material.metalness = archetype === 'luxury' ? 0.45 : 0.1;
      child.material = material;
    });

    wheelsRef.current = wheels;

    // Measure the model rather than trusting a hand-tuned offset: sit its
    // lowest point exactly on the ground, whatever the model's own origin is.
    clone.scale.setScalar(config.scale);
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);

    return { model: clone, groundOffset: -bounds.min.y };
  }, [scene, config.tint, config.scale, archetype]);

  useFrame((_, delta) => {
    if (speed <= 0.01) return;
    // Roughly one rotation per wheel circumference travelled.
    const spin = speed * delta * 4;
    for (const wheel of wheelsRef.current) wheel.rotation.x -= spin;
  });

  // Scale is baked into the clone above, so only the ground offset is applied.
  return <primitive object={model} position={[0, groundOffset, 0]} />;
};

for (const url of VEHICLE_MODEL_URLS) useGLTF.preload(url);
