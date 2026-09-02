import React, { useMemo, useRef } from 'react';
import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type ElectricVehicleVariant = 'hatchback' | 'city';

/**
 * Keep the selected body stable across saves and renders without adding a new
 * persistence field to old vehicle records.
 */
export function electricVehicleVariant(vehicleId: string): ElectricVehicleVariant {
  let hash = 0;
  for (let i = 0; i < vehicleId.length; i += 1) {
    hash = (hash * 31 + vehicleId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2 === 0 ? 'hatchback' : 'city';
}

const bodyMaterial = (
  <meshStandardMaterial color="#eaf8ff" roughness={0.32} metalness={0.22} />
);
const cyanMaterial = (
  <meshStandardMaterial
    color="#14c8f4"
    emissive="#0284c7"
    emissiveIntensity={0.7}
    roughness={0.24}
    metalness={0.28}
  />
);
const glassMaterial = (
  <meshStandardMaterial color="#071827" roughness={0.16} metalness={0.48} />
);

const HatchbackCabin: React.FC = () => {
  const geometry = useMemo(() => {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          -0.79, 0, 0.95,
          0.79, 0, 0.95,
          -0.79, 0, -0.98,
          0.79, 0, -0.98,
          -0.62, 0.72, 0.53,
          0.62, 0.72, 0.53,
          -0.62, 0.72, -0.7,
          0.62, 0.72, -0.7
        ],
        3
      )
    );
    shape.setIndex([
      0, 1, 5, 0, 5, 4,
      2, 6, 7, 2, 7, 3,
      0, 4, 6, 0, 6, 2,
      1, 3, 7, 1, 7, 5,
      4, 5, 7, 4, 7, 6
    ]);
    shape.computeVertexNormals();
    return shape;
  }, []);

  return (
    <mesh geometry={geometry} position={[0, 0.93, -0.1]} castShadow>
      {glassMaterial}
    </mesh>
  );
};

const WheelSet: React.FC<{ speed: number; compact?: boolean }> = ({ speed, compact = false }) => {
  const wheels = useRef<Array<THREE.Group | null>>([]);
  const z = compact ? 0.92 : 1.18;
  const x = compact ? 0.86 : 0.94;
  const radius = compact ? 0.37 : 0.41;

  useFrame((_, delta) => {
    if (speed <= 0.01) return;
    const spin = speed * delta * 4;
    wheels.current.forEach((wheel) => {
      if (wheel) wheel.rotation.x -= spin;
    });
  });

  return (
    <>
      {[
        [-x, z],
        [x, z],
        [-x, -z],
        [x, -z]
      ].map(([wheelX, wheelZ], index) => (
        <group
          key={`${wheelX}-${wheelZ}`}
          ref={(node) => {
            wheels.current[index] = node;
          }}
          position={[wheelX, radius, wheelZ]}
        >
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[radius, radius, 0.24, 12]} />
            <meshStandardMaterial color="#07111e" roughness={0.74} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[radius * 0.63, radius * 0.63, 0.255, 10]} />
            <meshStandardMaterial color="#dff8ff" roughness={0.28} metalness={0.62} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[radius * 0.2, radius * 0.2, 0.27, 10]} />
            {cyanMaterial}
          </mesh>
        </group>
      ))}
    </>
  );
};

const EvDetails: React.FC<{ frontZ: number; sideX: number; portZ: number }> = ({
  frontZ,
  sideX,
  portZ
}) => (
  <>
    {/* A closed nose and uninterrupted light bar read as electric from afar. */}
    <mesh position={[0, 0.72, frontZ]}>
      <boxGeometry args={[1.42, 0.11, 0.055]} />
      {cyanMaterial}
    </mesh>

    {/* Charge ports on both sides keep the detail visible from either route. */}
    {[-1, 1].map((side) => (
      <group key={side} position={[side * sideX, 0.92, portZ]} rotation={[0, Math.PI / 2, 0]}>
        <mesh>
          <torusGeometry args={[0.14, 0.035, 6, 12]} />
          {cyanMaterial}
        </mesh>
        <mesh>
          <circleGeometry args={[0.095, 12]} />
          <meshStandardMaterial color="#071827" roughness={0.25} metalness={0.4} />
        </mesh>
      </group>
    ))}
  </>
);

const HatchbackEv: React.FC<{ speed: number }> = ({ speed }) => (
  <group>
    <WheelSet speed={speed} />

    <RoundedBox args={[1.82, 0.52, 3.42]} radius={0.18} smoothness={2} position={[0, 0.67, 0]} castShadow>
      {bodyMaterial}
    </RoundedBox>
    <HatchbackCabin />
    <RoundedBox args={[1.26, 0.12, 1.28]} radius={0.06} smoothness={2} position={[0, 1.68, -0.18]} castShadow>
      <meshStandardMaterial color="#020b14" roughness={0.12} metalness={0.55} />
    </RoundedBox>

    {/* White pillars divide the glass and make the cabin feel production-ready. */}
    {[-0.73, 0.73].map((x) => (
      <mesh key={x} position={[x, 1.27, -0.1]} castShadow>
        <boxGeometry args={[0.08, 0.7, 0.13]} />
        {bodyMaterial}
      </mesh>
    ))}
    <mesh position={[0, 0.54, -1.7]}>
      <boxGeometry args={[1.2, 0.09, 0.06]} />
      <meshStandardMaterial color="#ef4444" emissive="#b91c1c" emissiveIntensity={0.45} />
    </mesh>

    <EvDetails frontZ={1.73} sideX={0.92} portZ={0.72} />
  </group>
);

const CityEv: React.FC<{ speed: number }> = ({ speed }) => (
  <group>
    <WheelSet speed={speed} compact />

    <RoundedBox args={[1.72, 0.62, 2.72]} radius={0.22} smoothness={2} position={[0, 0.72, 0]} castShadow>
      <meshStandardMaterial color="#13bfea" roughness={0.3} metalness={0.2} />
    </RoundedBox>
    <RoundedBox args={[1.62, 1.08, 1.92]} radius={0.28} smoothness={2} position={[0, 1.35, -0.08]} castShadow>
      {glassMaterial}
    </RoundedBox>
    <RoundedBox args={[1.7, 0.2, 2.0]} radius={0.1} smoothness={2} position={[0, 1.95, -0.08]} castShadow>
      {bodyMaterial}
    </RoundedBox>

    {/* Chunky white pillars create the tall, retro-modern city-car silhouette. */}
    {[-0.75, 0.75].map((x) => (
      <mesh key={x} position={[x, 1.35, -0.05]} castShadow>
        <boxGeometry args={[0.14, 1.1, 0.15]} />
        {bodyMaterial}
      </mesh>
    ))}
    <mesh position={[0, 0.68, -1.38]}>
      <boxGeometry args={[1.18, 0.16, 0.06]} />
      <meshStandardMaterial color="#ef4444" emissive="#b91c1c" emissiveIntensity={0.5} />
    </mesh>

    <EvDetails frontZ={1.39} sideX={0.87} portZ={0.52} />
  </group>
);

interface ElectricVehicleModelProps {
  vehicleId: string;
  speed: number;
}

export const ElectricVehicleModel: React.FC<ElectricVehicleModelProps> = ({ vehicleId, speed }) => {
  const variant = useMemo(() => electricVehicleVariant(vehicleId), [vehicleId]);
  return variant === 'hatchback' ? <HatchbackEv speed={speed} /> : <CityEv speed={speed} />;
};
