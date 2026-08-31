import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FuelOrderEntity } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import { Html } from '@react-three/drei';

interface TankerTruckMeshProps {
  order: FuelOrderEntity;
}

/**
 * The delivery lorry: a proper articulated tanker, not a parked prop.
 *
 * It drives the route the simulation gives it — in off the highway, through
 * the entry, to its own fuel's tank — so the mesh only has to follow the
 * simulated pose the way customer cars do: eased per frame, so the 20Hz
 * simulation reads as motion rather than stutter. The cistern wears the
 * fuel's colour, which is how you can tell from across the plot that the
 * diesel lorry really has gone to the diesel tank.
 */
export const TankerTruckMesh: React.FC<TankerTruckMeshProps> = ({ order }) => {
  const groupRef = useRef<THREE.Group>(null);
  const spawnedRef = useRef(false);
  const truck = order.truck;

  const posX = (truck?.worldPosition[0] ?? 0) * 2;
  const posZ = (truck?.worldPosition[2] ?? 0) * 2;
  const heading = truck?.heading ?? 0;

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || !truck) return;

    if (!spawnedRef.current) {
      group.position.set(posX, 0, posZ);
      group.rotation.y = heading;
      spawnedRef.current = true;
      return;
    }

    const ease = Math.min(1, delta * 7);
    group.position.x += (posX - group.position.x) * ease;
    group.position.z += (posZ - group.position.z) * ease;

    // Turn the short way round so a heading flip does not spin the trailer.
    const turn = ((heading - group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    group.rotation.y += turn * Math.min(1, delta * 4);
  });

  if (!truck) return null;

  const fuelColor = GAME_CONFIG.fuels[order.fuelType]?.color ?? '#e2e8f0';
  const unloading = truck.phase === 'UNLOADING';
  const progress =
    unloading && order.liters > 0
      ? 1 - order.remainingSeconds / (order.liters / GAME_CONFIG.economy.tankerUnloadSpeedLps)
      : 0;

  return (
    <group ref={groupRef}>
      {/* Cab — forward along +z, matching how heading is derived */}
      <group position={[0, 0, 2.9]}>
        <mesh position={[0, 1.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.2, 2.2, 2.0]} />
          <meshStandardMaterial color="#b91c1c" roughness={0.35} metalness={0.35} />
        </mesh>
        <mesh position={[0, 2.05, 0.9]}>
          <boxGeometry args={[1.9, 0.9, 0.24]} />
          <meshStandardMaterial color="#0f172a" roughness={0.15} metalness={0.4} />
        </mesh>
        {/* Bumper and grille */}
        <mesh position={[0, 0.55, 1.05]} castShadow>
          <boxGeometry args={[2.2, 0.5, 0.2]} />
          <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>

      {/* Chassis */}
      <mesh position={[0, 0.72, -0.6]} castShadow>
        <boxGeometry args={[1.9, 0.35, 7.6]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>

      {/* Cistern, in the fuel's colour with steel end caps */}
      <mesh position={[0, 2.0, -1.1]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.15, 1.15, 5.6, 20]} />
        <meshStandardMaterial color={fuelColor} metalness={0.45} roughness={0.35} />
      </mesh>
      {[1.7, -3.9].map((z) => (
        <mesh key={z} position={[0, 2.0, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.16, 1.16, 0.18, 20]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.25} />
        </mesh>
      ))}
      {/* Hatch domes along the top */}
      {[-2.6, -1.1, 0.4].map((z) => (
        <mesh key={z} position={[0, 3.12, z]} castShadow>
          <cylinderGeometry args={[0.28, 0.32, 0.22, 12]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      {/* Wheels — three axles */}
      {[3.1, -2.2, -3.6].map((z) =>
        [-1.05, 1.05].map((x) => (
          <mesh key={`${x}_${z}`} position={[x, 0.55, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.55, 0.55, 0.4, 14]} />
            <meshStandardMaterial color="#111827" roughness={0.9} />
          </mesh>
        ))
      )}

      {/* Hose out to the filler caps while the tank is being filled */}
      {unloading && (
        <mesh position={[1.35, 0.5, -1.1]} rotation={[0, 0, Math.PI / 2.6]}>
          <cylinderGeometry args={[0.08, 0.08, 2.4, 10]} />
          <meshStandardMaterial color="#1e293b" roughness={0.9} />
        </mesh>
      )}

      {unloading && (
        <Html position={[0, 4.1, -1]} center distanceFactor={26} zIndexRange={[5, 0]}>
          <div className="bg-slate-900/95 border border-slate-600 text-white text-xs px-2.5 py-1 rounded-xl font-mono font-bold shadow-2xl flex items-center gap-2 whitespace-nowrap">
            <span>⛽ {GAME_CONFIG.fuels[order.fuelType]?.shortName ?? order.fuelType}</span>
            <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
              />
            </div>
          </div>
        </Html>
      )}
    </group>
  );
};
