import React from 'react';
import { FuelOrderEntity } from '../domain/types/gameState';
import { Html } from '@react-three/drei';

interface TankerTruckMeshProps {
  order: FuelOrderEntity;
}

export const TankerTruckMesh: React.FC<TankerTruckMeshProps> = ({ order }) => {
  // Tanker delivery parking spot near underground tanks (x = 6, z = 18)
  return (
    <group position={[6, 0, 18]} rotation={[0, Math.PI / 2, 0]}>
      {/* Truck Cabin */}
      <mesh position={[0, 1.8, -3.2]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 2.6, 2.2]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.3} metalness={0.4} />
      </mesh>
      {/* Cabin Windshield */}
      <mesh position={[0, 2.2, -4.32]}>
        <boxGeometry args={[2.1, 1.1, 0.1]} />
        <meshStandardMaterial color="#0f172a" roughness={0.1} />
      </mesh>

      {/* Fuel Tanker Cylindrical Cistern */}
      <mesh position={[0, 2.1, 1.0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.3, 1.3, 5.8, 24]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Fuel Hose connected to ground underground fill hatch */}
      <mesh position={[1.4, 0.4, 2.0]}>
        <cylinderGeometry args={[0.08, 0.08, 2.5, 12]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>

      {/* Floating Status */}
      <Html position={[0, 4.2, 0]} center distanceFactor={25}>
        <div className="bg-red-700/90 text-white text-xs px-2.5 py-1 rounded-lg font-mono font-bold shadow-2xl flex items-center gap-1.5 animate-pulse">
          <span>🚛 TANKER BOŞALTIMI</span>
          <span>({order.liters} L {order.fuelType})</span>
        </div>
      </Html>
    </group>
  );
};
