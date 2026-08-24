import React, { useState } from 'react';
import { PumpEntity, FuelType } from '../domain/types/gameState';
import { useGameStore } from '../store/gameStore';
import { Html } from '@react-three/drei';
import { GAME_CONFIG } from '../config/gameConfig';

interface PumpMeshProps {
  pump: PumpEntity;
}

const STATUS_COLORS: Record<string, string> = {
  BROKEN: '#ef4444',
  MAINTENANCE: '#f59e0b',
  FUELING: '#22c55e',
  IDLE: '#f8fafc'
};

/**
 * The forecourt pump. Hand-built rather than a kit model: no CC0 pack ships a
 * fuel dispenser, and this is the object the player looks at most.
 */
export const PumpMesh: React.FC<PumpMeshProps> = ({ pump }) => {
  const [hovered, setHovered] = useState(false);
  const selectedPumpId = useGameStore((s) => s.selectedPumpId);
  const selectPump = useGameStore((s) => s.selectPump);
  const isSelected = selectedPumpId === pump.id;

  const posX = pump.position[0] * 2;
  const posZ = pump.position[1] * 2;

  const statusColor = STATUS_COLORS[pump.state] || '#38bdf8';
  const isFueling = pump.state === 'FUELING';
  const isBroken = pump.state === 'BROKEN';

  // Body darkens and gains trim as the pump is upgraded.
  const bodyColor = pump.level >= 3 ? '#161c2e' : pump.level >= 2 ? '#1e293b' : '#334155';
  const grime = Math.max(0, (70 - pump.health) / 70);

  // One coloured nozzle per fuel this pump can actually dispense.
  const nozzles = (['gasoline', 'diesel', 'lpg'] as FuelType[])
    .filter((f) => pump.supportedFuels.includes(f))
    .map((f, i) => ({ fuel: f, color: GAME_CONFIG.fuels[f].color, index: i }));

  return (
    <group
      position={[posX, 0, posZ]}
      rotation={[0, (pump.rotation * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        selectPump(pump.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Concrete island with a painted safety kerb */}
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <boxGeometry args={[2.4, 0.3, 4.4]} />
        <meshStandardMaterial color="#6b7688" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.31, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.5, 4.5]} />
        <meshBasicMaterial color="#eab308" transparent opacity={0.35} />
      </mesh>

      {/* Bollards guarding each end of the island */}
      {[-1.85, 1.85].map((z) => (
        <mesh key={z} position={[0, 0.75, z]} castShadow>
          <cylinderGeometry args={[0.16, 0.18, 1.1, 10]} />
          <meshStandardMaterial color="#eab308" roughness={0.6} />
        </mesh>
      ))}

      {/* Dispenser body */}
      <mesh position={[0, 1.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.0, 2.3, 1.5]} />
        <meshStandardMaterial color={bodyColor} roughness={0.45} metalness={0.35} />
      </mesh>

      {/* Wear shows as grime around the base */}
      {grime > 0 && (
        <mesh position={[0, 0.6, 0]}>
          <boxGeometry args={[1.04, 0.5, 1.54]} />
          <meshStandardMaterial color="#3f3a33" roughness={1} transparent opacity={0.3 + grime * 0.4} />
        </mesh>
      )}

      {/* Brand band in the fuel colours it serves */}
      {nozzles.map((n, i) => (
        <mesh key={n.fuel} position={[0, 2.35 - i * 0.16, 0]}>
          <boxGeometry args={[1.03, 0.13, 1.53]} />
          <meshStandardMaterial
            color={n.color}
            emissive={n.color}
            emissiveIntensity={0.35}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Metering screens on both faces */}
      {[0.52, -0.52].map((x) => (
        <mesh key={x} position={[x, 1.62, 0]} rotation={[0, x > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
          <planeGeometry args={[1.0, 0.62]} />
          <meshStandardMaterial
            color={isBroken ? '#3f1d1d' : '#082f49'}
            emissive={isBroken ? '#7f1d1d' : '#0ea5e9'}
            emissiveIntensity={isBroken ? 0.4 : 0.8}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Nozzles in their holsters, one per supported fuel */}
      {nozzles.map((n) => {
        const z = -0.45 + n.index * 0.45;
        return (
          <group key={n.fuel} position={[0.58, 1.15, z]}>
            <mesh castShadow>
              <boxGeometry args={[0.2, 0.42, 0.16]} />
              <meshStandardMaterial color="#111827" roughness={0.7} />
            </mesh>
            <mesh position={[0.02, 0.26, 0]}>
              <boxGeometry args={[0.16, 0.12, 0.14]} />
              <meshStandardMaterial color={n.color} roughness={0.5} />
            </mesh>
          </group>
        );
      })}

      {/* Hose running out to the car while it is being served */}
      {isFueling && (
        <mesh position={[1.0, 0.95, 0.3]} rotation={[0, 0, Math.PI / 2.4]}>
          <cylinderGeometry args={[0.07, 0.07, 1.6, 8]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>
      )}

      {/* Status beacon on top */}
      <mesh position={[0, 2.68, 0]}>
        <boxGeometry args={[0.8, 0.14, 1.2]} />
        <meshStandardMaterial
          color={statusColor}
          emissive={statusColor}
          emissiveIntensity={isFueling ? 1.5 : 0.6}
          toneMapped={false}
        />
      </mesh>

      {(hovered || isSelected) && (
        <mesh position={[0, 0.33, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.6, 1.85, 32]} />
          <meshBasicMaterial color={isSelected ? '#38bdf8' : '#e2e8f0'} opacity={0.8} transparent />
        </mesh>
      )}

      {pump.health < 40 && (
        <Html position={[0, 3.3, 0]} center distanceFactor={25} zIndexRange={[5, 0]}>
          <div className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-bold shadow-lg animate-bounce whitespace-nowrap">
            ⚠️ {isBroken ? 'Arızalı' : 'Bakım Gerekli'}
          </div>
        </Html>
      )}
    </group>
  );
};
