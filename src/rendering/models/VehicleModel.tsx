import React, { useMemo, useRef } from 'react';
import { useFBX, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VehicleArchetype, VehicleModelVariant } from '../../domain/types/gameState';
import {
  DEFAULT_VEHICLE_MODEL,
  VEHICLE_MODELS,
  VehicleModelConfig
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

/**
 * Only the Kenney kit's four road wheels turn. It names them
 * `wheel-{front,back}-{left,right}`, while the spare bolted to the SUV's
 * tailgate is a bare `wheel-back` — matching on the side suffix keeps that one
 * still instead of spinning a tyre attached to the bodywork. The RgsDev meshes
 * do not share one pivot convention, so rotating them generically makes some
 * tyres orbit the car or turn edge-on; those stay static.
 */
function isSpinningWheel(name: string, format: VehicleModelConfig['format']): boolean {
  return (
    format === 'glb' &&
    name.startsWith('wheel-') &&
    (name.endsWith('-left') || name.endsWith('-right'))
  );
}

/** How many times a second the beacon swaps sides. */
const BEACON_HZ = 5;

/**
 * A police light bar: a dark base with a red and a blue lamp that strobe in
 * alternation. The lamps are emissive and left out of tone mapping so they
 * read as lit from the isometric distance, on a black road, without a point
 * light per car.
 */
const PoliceBeacon: React.FC<{ roofY: number }> = ({ roofY }) => {
  const red = useRef<THREE.MeshStandardMaterial>(null);
  const blue = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    const phase = Math.floor(clock.elapsedTime * BEACON_HZ) % 2;
    if (red.current) red.current.emissiveIntensity = phase === 0 ? 4 : 0.3;
    if (blue.current) blue.current.emissiveIntensity = phase === 0 ? 0.3 : 4;
  });

  return (
    <group position={[0, roofY + 0.06, 0.1]}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.15, 0.1, 0.34]} />
        <meshStandardMaterial color="#0f172a" roughness={0.6} />
      </mesh>
      <mesh position={[-0.3, 0.12, 0]}>
        <boxGeometry args={[0.48, 0.16, 0.3]} />
        <meshStandardMaterial
          ref={red}
          color="#ef4444"
          emissive="#ff1a1a"
          emissiveIntensity={4}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0.3, 0.12, 0]}>
        <boxGeometry args={[0.48, 0.16, 0.3]} />
        <meshStandardMaterial
          ref={blue}
          color="#3b82f6"
          emissive="#1a5cff"
          emissiveIntensity={0.3}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
};

/**
 * One body from either pack. The loaded scene is shared between every car
 * using the same file, so it is cloned per instance and its materials cloned
 * alongside it — otherwise tinting one car would tint all of them. The clone
 * is measured rather than trusting a hand-tuned scale: nose to tail is brought
 * to the configured length and the lowest point sits exactly on the ground.
 */
const VehicleBody: React.FC<{
  source: THREE.Object3D;
  config: VehicleModelConfig;
  speed: number;
}> = ({ source, config, speed }) => {
  const wheelsRef = useRef<THREE.Object3D[]>([]);

  const { model, offset, height } = useMemo(() => {
    const clone = source.clone(true);
    const wheels: THREE.Object3D[] = [];
    clone.traverse((child) => {
      if (isSpinningWheel(child.name, config.format)) wheels.push(child);
      if (!(child instanceof THREE.Mesh)) return;

      if (isRoadWheel(child.name)) {
        child.scale.multiplyScalar(config.wheelScale ?? 1);
        child.position.x *= config.wheelTrackScale ?? 1;
      }

      child.castShadow = true;
      child.receiveShadow = true;
      const sources = Array.isArray(child.material) ? child.material : [child.material];
      const materials = sources.map((sourceMaterial) => {
        const material = sourceMaterial.clone();
        if ('roughness' in material) {
          const standard = material as THREE.MeshStandardMaterial;
          standard.roughness = config.format === 'glb' ? 0.55 : 0.48;
          if (config.tint && !child.name.startsWith('wheel')) {
            standard.color = new THREE.Color(config.tint);
          }
        }
        return material;
      });
      child.material = Array.isArray(child.material) ? materials : materials[0];
    });
    wheelsRef.current = wheels;

    clone.updateMatrixWorld(true);
    const rawBounds = new THREE.Box3().setFromObject(clone);
    const rawSize = rawBounds.getSize(new THREE.Vector3());
    const scale = config.targetLength / Math.max(rawSize.z, 0.001);
    clone.scale.multiplyScalar(scale);
    clone.scale.x *= config.widthScale ?? 1;
    clone.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(clone);
    const center = bounds.getCenter(new THREE.Vector3());
    return {
      model: clone,
      offset: new THREE.Vector3(-center.x, -bounds.min.y, -center.z),
      height: bounds.max.y - bounds.min.y
    };
  }, [source, config]);

  useFrame((_, delta) => {
    if (speed <= 0.01 || wheelsRef.current.length === 0) return;
    // Roughly one rotation per wheel circumference travelled.
    const spin = speed * delta * 4;
    for (const wheel of wheelsRef.current) wheel.rotation.x -= spin;
  });

  return (
    <group>
      <primitive object={model} position={offset} />
      {config.beacon && <PoliceBeacon roofY={height} />}
    </group>
  );
};

const RgsDevVehicleModel: React.FC<{ config: VehicleModelConfig; speed: number }> = ({
  config,
  speed
}) => {
  const source = useFBX(config.url);
  return <VehicleBody source={source} config={config} speed={speed} />;
};

const KenneyVehicleModel: React.FC<{ config: VehicleModelConfig; speed: number }> = ({
  config,
  speed
}) => {
  const { scene } = useGLTF(config.url);
  return <VehicleBody source={scene} config={config} speed={speed} />;
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

  // The welcome scene names a body ("sedan", "suv") where the game names a
  // customer; a name that is a variant rather than an archetype is honoured
  // as that variant, and anything unknown still gets a car rather than a crash.
  const selected = modelVariant ?? DEFAULT_VEHICLE_MODEL[archetype];
  const config =
    VEHICLE_MODELS[selected] ??
    VEHICLE_MODELS[archetype as unknown as VehicleModelVariant] ??
    VEHICLE_MODELS.sedan;
  return config.format === 'glb' ? (
    <KenneyVehicleModel config={config} speed={speed} />
  ) : (
    <RgsDevVehicleModel config={config} speed={speed} />
  );
};

for (const model of Object.values(VEHICLE_MODELS)) {
  if (model.format === 'glb') useGLTF.preload(model.url);
  else useFBX.preload(model.url);
}
