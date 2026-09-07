import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VehicleEntity } from '../domain/types/gameState';

/**
 * A driver on foot: out of the car, across the forecourt and into a building.
 *
 * Built from the same blocks as the pump attendant so the two read as the
 * same kind of person, but in ordinary clothes — the colours are drawn from
 * the car, so the same driver keeps the same coat from door to door. While
 * they are inside nothing is drawn: the building has them.
 */

const COATS = ['#2563eb', '#dc2626', '#0f766e', '#7c3aed', '#ea580c', '#475569', '#be185d', '#65a30d'];
const TROUSERS = ['#1e293b', '#3f3f46', '#334155', '#1c1917'];
const SKINS = ['#fbb584', '#e0a370', '#c98a5c', '#f2c49b'];

/** How fast the legs swing while walking, in radians per second. */
const STRIDE = 9;

export const VisitorMesh: React.FC<{ vehicle: VehicleEntity }> = ({ vehicle }) => {
  const visitor = vehicle.visitor;
  const groupRef = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Mesh>(null);
  const rightLeg = useRef<THREE.Mesh>(null);
  const leftArm = useRef<THREE.Mesh>(null);
  const rightArm = useRef<THREE.Mesh>(null);
  const placed = useRef(false);
  const stride = useRef(0);

  // The walker moves at 20Hz in the simulation; eased here so they glide.
  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || !visitor) return;

    const x = visitor.worldPosition[0] * 2;
    const z = visitor.worldPosition[2] * 2;
    if (!placed.current) {
      group.position.set(x, 0, z);
      group.rotation.y = visitor.heading;
      placed.current = true;
    } else {
      const ease = Math.min(1, delta * 10);
      group.position.x += (x - group.position.x) * ease;
      group.position.z += (z - group.position.z) * ease;
      const turn = ((visitor.heading - group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      group.rotation.y += turn * Math.min(1, delta * 8);
    }

    const walking = visitor.phase !== 'INSIDE' && visitor.targetWaypoint !== null;
    stride.current = walking ? stride.current + delta * STRIDE : 0;
    const swing = walking ? Math.sin(stride.current) * 0.55 : 0;
    if (leftLeg.current) leftLeg.current.rotation.x = swing;
    if (rightLeg.current) rightLeg.current.rotation.x = -swing;
    if (leftArm.current) leftArm.current.rotation.x = -swing * 0.8;
    if (rightArm.current) rightArm.current.rotation.x = swing * 0.8;
  });

  if (!visitor || visitor.phase === 'INSIDE') return null;

  const coat = COATS[visitor.look % COATS.length];
  const trousers = TROUSERS[(visitor.look >> 3) % TROUSERS.length];
  const skin = SKINS[(visitor.look >> 6) % SKINS.length];
  const hair = (visitor.look >> 9) % 3 === 0 ? '#3f2a1d' : (visitor.look >> 9) % 3 === 1 ? '#0f172a' : '#a16207';

  return (
    <group ref={groupRef} scale={1.05}>
      {/* Legs, hinged at the hip so they can swing */}
      <group position={[-0.11, 0.7, 0]}>
        <mesh ref={leftLeg} castShadow>
          <boxGeometry args={[0.13, 0.66, 0.15]} />
          <meshStandardMaterial color={trousers} roughness={0.8} />
        </mesh>
      </group>
      <group position={[0.11, 0.7, 0]}>
        <mesh ref={rightLeg} castShadow>
          <boxGeometry args={[0.13, 0.66, 0.15]} />
          <meshStandardMaterial color={trousers} roughness={0.8} />
        </mesh>
      </group>
      {/* Shoes */}
      <mesh position={[-0.11, 0.04, 0.02]} castShadow>
        <boxGeometry args={[0.14, 0.08, 0.24]} />
        <meshStandardMaterial color="#1c1917" roughness={0.9} />
      </mesh>
      <mesh position={[0.11, 0.04, 0.02]} castShadow>
        <boxGeometry args={[0.14, 0.08, 0.24]} />
        <meshStandardMaterial color="#1c1917" roughness={0.9} />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.38, 0.5, 0.22]} />
        <meshStandardMaterial color={coat} roughness={0.6} />
      </mesh>

      {/* Arms, hinged at the shoulder */}
      <group position={[-0.24, 1.25, 0]}>
        <mesh ref={leftArm} position={[0, -0.22, 0]} castShadow>
          <boxGeometry args={[0.1, 0.46, 0.12]} />
          <meshStandardMaterial color={coat} roughness={0.6} />
        </mesh>
      </group>
      <group position={[0.24, 1.25, 0]}>
        <mesh ref={rightArm} position={[0, -0.22, 0]} castShadow>
          <boxGeometry args={[0.1, 0.46, 0.12]} />
          <meshStandardMaterial color={coat} roughness={0.6} />
        </mesh>
      </group>

      {/* Neck and head */}
      <mesh position={[0, 1.34, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.08, 0.1, 8]} />
        <meshStandardMaterial color={skin} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.48, 0]} castShadow>
        <boxGeometry args={[0.22, 0.22, 0.22]} />
        <meshStandardMaterial color={skin} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.56, -0.03]}>
        <boxGeometry args={[0.23, 0.1, 0.2]} />
        <meshStandardMaterial color={hair} roughness={0.9} />
      </mesh>
      <mesh position={[-0.055, 1.49, 0.113]}>
        <boxGeometry args={[0.03, 0.025, 0.01]} />
        <meshStandardMaterial color="#0f172a" roughness={0.3} />
      </mesh>
      <mesh position={[0.055, 1.49, 0.113]}>
        <boxGeometry args={[0.03, 0.025, 0.01]} />
        <meshStandardMaterial color="#0f172a" roughness={0.3} />
      </mesh>
    </group>
  );
};
