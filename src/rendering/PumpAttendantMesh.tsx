import React from 'react';
import { EmployeeEntity } from '../domain/types/gameState';

interface PumpAttendantMeshProps {
  attendant: EmployeeEntity;
  /** Offset on the island so the character stands beside the dispenser cabinet facing cars */
  position?: [number, number, number];
  rotation?: [number, number, number];
}

/**
 * 3D Pump Attendant (Pompacı) Character
 * A stylized, realistic low-poly attendant wearing the station's uniform:
 * - Peaked station cap (red with white badge)
 * - Uniform jacket/vest with high-vis reflective safety bands
 * - Utility belt & tool pouch
 * - Navy work pants with reflective ankle bands
 * - Work boots & gloves
 */
export const PumpAttendantMesh: React.FC<PumpAttendantMeshProps> = ({
  attendant: _attendant,
  position = [0.75, 0.30, -1.45],
  rotation = [0, Math.PI / 2 + 0.1, 0]
}) => {
  return (
    <group position={position} rotation={rotation} scale={1.15}>
      {/* --- Shoes / Boots (y: 0.04) --- */}
      <mesh position={[-0.12, 0.04, 0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.13, 0.08, 0.24]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>
      <mesh position={[0.12, 0.04, 0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.13, 0.08, 0.24]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>

      {/* Boot soles */}
      <mesh position={[-0.12, 0.01, 0.02]}>
        <boxGeometry args={[0.14, 0.02, 0.25]} />
        <meshStandardMaterial color="#475569" roughness={0.9} />
      </mesh>
      <mesh position={[0.12, 0.01, 0.02]}>
        <boxGeometry args={[0.14, 0.02, 0.25]} />
        <meshStandardMaterial color="#475569" roughness={0.9} />
      </mesh>

      {/* --- Legs / Navy Work Pants (y: 0.38) --- */}
      <mesh position={[-0.12, 0.38, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.13, 0.62, 0.15]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>
      <mesh position={[0.12, 0.38, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.13, 0.62, 0.15]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>

      {/* High-visibility reflective bands on lower legs */}
      <mesh position={[-0.12, 0.22, 0]}>
        <boxGeometry args={[0.14, 0.05, 0.16]} />
        <meshStandardMaterial
          color="#facc15"
          emissive="#eab308"
          emissiveIntensity={0.3}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0.12, 0.22, 0]}>
        <boxGeometry args={[0.14, 0.05, 0.16]} />
        <meshStandardMaterial
          color="#facc15"
          emissive="#eab308"
          emissiveIntensity={0.3}
          roughness={0.4}
        />
      </mesh>

      {/* --- Hips / Pelvis (y: 0.72) --- */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.36, 0.14, 0.18]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>

      {/* Utility Belt & Buckle */}
      <mesh position={[0, 0.77, 0]} castShadow>
        <boxGeometry args={[0.38, 0.06, 0.20]} />
        <meshStandardMaterial color="#090d16" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.77, 0.105]}>
        <boxGeometry args={[0.08, 0.06, 0.02]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Small tool pouch on right hip */}
      <mesh position={[0.20, 0.73, 0.02]} castShadow>
        <boxGeometry args={[0.06, 0.12, 0.10]} />
        <meshStandardMaterial color="#334155" roughness={0.9} />
      </mesh>

      {/* --- Torso / Station Jacket & Safety Vest (y: 1.05) --- */}
      <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.40, 0.50, 0.22]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.5} />
      </mesh>

      {/* High-visibility yellow safety vest overlay */}
      <mesh position={[0, 1.07, 0.005]} castShadow>
        <boxGeometry args={[0.41, 0.38, 0.23]} />
        <meshStandardMaterial
          color="#facc15"
          emissive="#ca8a04"
          emissiveIntensity={0.25}
          roughness={0.5}
        />
      </mesh>
      {/* Reflective silver chest stripes */}
      <mesh position={[0, 1.14, 0.122]}>
        <boxGeometry args={[0.36, 0.04, 0.01]} />
        <meshStandardMaterial color="#f1f5f9" emissive="#ffffff" emissiveIntensity={0.5} roughness={0.2} />
      </mesh>
      <mesh position={[0, 1.00, 0.122]}>
        <boxGeometry args={[0.36, 0.04, 0.01]} />
        <meshStandardMaterial color="#f1f5f9" emissive="#ffffff" emissiveIntensity={0.5} roughness={0.2} />
      </mesh>
      {/* Station employee badge on left chest */}
      <mesh position={[-0.11, 1.20, 0.123]}>
        <boxGeometry args={[0.07, 0.05, 0.01]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>

      {/* --- Arms & Hands --- */}
      {/* Left Arm */}
      <mesh position={[-0.25, 1.15, 0]} castShadow>
        <boxGeometry args={[0.11, 0.28, 0.13]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.5} />
      </mesh>
      <mesh position={[-0.25, 0.92, 0.04]} rotation={[0.2, 0, 0]} castShadow>
        <boxGeometry args={[0.10, 0.26, 0.11]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.5} />
      </mesh>
      {/* Left Glove */}
      <mesh position={[-0.25, 0.76, 0.08]} castShadow>
        <boxGeometry args={[0.09, 0.11, 0.10]} />
        <meshStandardMaterial color="#334155" roughness={0.8} />
      </mesh>

      {/* Right Arm (bent slightly holding position) */}
      <mesh position={[0.25, 1.15, 0]} castShadow>
        <boxGeometry args={[0.11, 0.28, 0.13]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.5} />
      </mesh>
      <mesh position={[0.25, 0.92, 0.06]} rotation={[0.35, 0, -0.05]} castShadow>
        <boxGeometry args={[0.10, 0.26, 0.11]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.5} />
      </mesh>
      {/* Right Glove */}
      <mesh position={[0.25, 0.77, 0.14]} castShadow>
        <boxGeometry args={[0.09, 0.11, 0.10]} />
        <meshStandardMaterial color="#334155" roughness={0.8} />
      </mesh>

      {/* --- Neck (y: 1.34) --- */}
      <mesh position={[0, 1.34, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.08, 0.10, 8]} />
        <meshStandardMaterial color="#fbb584" roughness={0.6} />
      </mesh>

      {/* --- Head (y: 1.48) --- */}
      <mesh position={[0, 1.48, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.22, 0.22, 0.22]} />
        <meshStandardMaterial color="#fbb584" roughness={0.6} />
      </mesh>
      {/* Dark stylized hair/sideburns */}
      <mesh position={[0, 1.54, -0.06]}>
        <boxGeometry args={[0.23, 0.12, 0.14]} />
        <meshStandardMaterial color="#1e293b" roughness={0.9} />
      </mesh>

      {/* Stylized face details */}
      {/* Eyes */}
      <mesh position={[-0.055, 1.49, 0.113]}>
        <boxGeometry args={[0.03, 0.025, 0.01]} />
        <meshStandardMaterial color="#0f172a" roughness={0.3} />
      </mesh>
      <mesh position={[0.055, 1.49, 0.113]}>
        <boxGeometry args={[0.03, 0.025, 0.01]} />
        <meshStandardMaterial color="#0f172a" roughness={0.3} />
      </mesh>

      {/* --- Peaked Station Uniform Cap (y: 1.62) --- */}
      {/* Cap crown */}
      <mesh position={[0, 1.61, 0.01]} castShadow>
        <boxGeometry args={[0.24, 0.09, 0.24]} />
        <meshStandardMaterial color="#dc2626" roughness={0.5} />
      </mesh>
      {/* Cap brim/visor pointing forward */}
      <mesh position={[0, 1.58, 0.16]} rotation={[0.12, 0, 0]} castShadow>
        <boxGeometry args={[0.22, 0.025, 0.12]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.6} />
      </mesh>
      {/* White logo emblem on front of cap */}
      <mesh position={[0, 1.62, 0.133]}>
        <boxGeometry args={[0.07, 0.05, 0.01]} />
        <meshStandardMaterial color="#ffffff" roughness={0.4} />
      </mesh>
    </group>
  );
};
