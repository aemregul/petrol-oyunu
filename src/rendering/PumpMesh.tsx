import React from 'react';
import { PumpEntity, FuelType } from '../domain/types/gameState';
import { useGameStore } from '../store/gameStore';
import { Html } from '@react-three/drei';
import { GAME_CONFIG } from '../config/gameConfig';
import { DECAL, decal } from './decal';

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
 *
 * Built as a filling-station dispenser is: a red cabinet in house colours with
 * a white skirt, a pitched cap over the top, and a till panel and holster on
 * each face — both sides of an island serve a car.
 */
/**
 * The roof over one island, carried on a single column bolted to it.
 *
 * Built the way a real forecourt canopy is: the column stands at the back of
 * the island where it is out of the way of both cars and the nozzle, and the
 * deck cantilevers forward over the bays on either side. One roof per pump,
 * so it turns with the island and can never drift off the thing it shelters —
 * which is what the old free-standing four-legged canopy could do.
 *
 * Nothing here takes pointer events. A roof is the nearest thing to the camera
 * over everything beneath it, and a clickable one swallows every attempt to
 * reach the pump under it or the building behind it — which is exactly the
 * bug the old free-standing canopy had.
 *
 * Silencing the group alone does nothing: three walks into the children and
 * asks each mesh to raycast itself, and a Group's own raycast is already a
 * no-op. So every descendant is told individually. Measured, not assumed —
 * with the prop on the group, a click 70px out on the overhang still landed
 * on the pump.
 */
const PumpCanopy: React.FC = () => {
  // Kept low and stocky on purpose: a tall deck on a slim post reads as a
  // slab hanging in the air rather than a roof something is holding up.
  const deckY = 4.85;
  const width = 6.4;
  const depth = 5.8;
  // Back of the island, clear of the bollard at z = -1.85.
  const columnZ = -1.95;

  return (
    <group
      ref={(g) => {
        g?.traverse((child) => {
          child.raycast = () => null;
        });
      }}
    >
      {/* Plinth tying the column to the island it stands on */}
      <mesh position={[0, 0.42, columnZ]} castShadow>
        <boxGeometry args={[1.36, 0.28, 1.16]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.9} />
      </mesh>
      {/* The column: a broad branded pylon, the way a forecourt does it */}
      <mesh position={[0, deckY / 2 + 0.3, columnZ]} castShadow>
        <boxGeometry args={[1.16, deckY - 0.6, 0.98]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.55} metalness={0.2} />
      </mesh>
      {/* House-colour panel on the column, as the brands do */}
      <mesh position={[0, 2.9, columnZ + 0.5]} castShadow>
        <boxGeometry args={[0.94, 2.4, 0.06]} />
        <meshStandardMaterial color="#0284c7" roughness={0.5} />
      </mesh>
      {/* Bracket where the column meets the deck, so the load reads */}
      <mesh position={[0, deckY - 0.14, columnZ]}>
        <boxGeometry args={[1.9, 0.4, 1.7]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.6} metalness={0.25} />
      </mesh>

      {/* Deck, with the coloured fascia wrapping its edge */}
      <mesh position={[0, deckY + 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.42, depth]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.65} metalness={0.15} />
      </mesh>
      <mesh position={[0, deckY + 0.08, 0]}>
        <boxGeometry args={[width + 0.22, 0.38, depth + 0.22]} />
        <meshStandardMaterial
          color="#0284c7"
          emissive="#0284c7"
          emissiveIntensity={0.45}
          toneMapped={false}
        />
      </mesh>

      {/* Recessed downlights, so the island reads as lit from above */}
      {[-1.5, 1.5].map((x) =>
        [-1.3, 1.3].map((z) => (
          <mesh key={`${x}_${z}`} position={[x, deckY - 0.12, z]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.38, 12]} />
            <meshBasicMaterial color="#fef9c3" toneMapped={false} />
          </mesh>
        ))
      )}
    </group>
  );
};

export const PumpMesh: React.FC<PumpMeshProps> = ({ pump }) => {
  const selectPump = useGameStore((s) => s.selectPump);
  const editMode = useGameStore((s) => s.editMode);
  const placing = useGameStore((s) => s.buildMode.active);
  const relocateStructure = useGameStore((s) => s.relocateStructure);
  const fittingCanopy = useGameStore((s) => s.fittingCanopy);
  const fitCanopy = useGameStore((s) => s.fitCanopy);

  // While a canopy is being fitted, the islands that can take one are the
  // only thing on the forecourt worth clicking.
  const awaitingCanopy = fittingCanopy && !pump.hasCanopy;

  // A bay is picked up the same way as anything else on the forecourt.
  const editable = editMode && !placing;

  const posX = pump.position[0] * 2;
  const posZ = pump.position[1] * 2;

  const statusColor = STATUS_COLORS[pump.state] || '#38bdf8';
  const isFueling = pump.state === 'FUELING';
  const isBroken = pump.state === 'BROKEN';

  // House red, deepening as the pump is upgraded.
  const bodyColor = pump.level >= 3 ? '#a4161a' : pump.level >= 2 ? '#c1121f' : '#d92b2b';
  const trimMetal = pump.level >= 3 ? 0.45 : pump.level >= 2 ? 0.3 : 0.18;
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
        if (awaitingCanopy) fitCanopy(pump.id);
        else if (editable) relocateStructure(pump.id);
        else selectPump(pump.id);
      }}
    >
      {/* Shown only while rearranging, so the forecourt is left alone
          otherwise — the same treatment every other structure gets. */}
      {editable && (
        <mesh position={[0, 0.32, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.4, 4.4]} />
          <meshBasicMaterial
            color="#38bdf8"
            opacity={0.28}
            transparent
            depthWrite={false}
            {...DECAL}
          />
        </mesh>
      )}

      {/* Concrete island, edged in painted yellow */}
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <boxGeometry args={[2.4, 0.3, 4.4]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.95} />
      </mesh>
      {[
        { pos: [1.14, 0.306, 0], size: [0.12, 0.02, 4.4] },
        { pos: [-1.14, 0.306, 0], size: [0.12, 0.02, 4.4] },
        { pos: [0, 0.306, 2.14], size: [2.4, 0.02, 0.12] },
        { pos: [0, 0.306, -2.14], size: [2.4, 0.02, 0.12] }
      ].map((strip, i) => (
        <mesh key={i} position={strip.pos as [number, number, number]}>
          <boxGeometry args={strip.size as [number, number, number]} />
          <meshStandardMaterial color="#eab308" roughness={0.8} />
        </mesh>
      ))}

      {/* Bollards guarding each end of the island */}
      {[-1.85, 1.85].map((z) => (
        <mesh key={z} position={[0, 0.75, z]} castShadow>
          <cylinderGeometry args={[0.16, 0.18, 1.1, 10]} />
          <meshStandardMaterial color="#eab308" roughness={0.6} />
        </mesh>
      ))}

      {/* White skirt the cabinet stands on */}
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.08, 0.24, 1.48]} />
        <meshStandardMaterial color="#e7ebf0" roughness={0.6} />
      </mesh>

      {/* Cabinet */}
      <mesh position={[0, 1.49, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.0, 1.9, 1.4]} />
        <meshStandardMaterial color={bodyColor} roughness={0.45} metalness={trimMetal} />
      </mesh>

      {/* White band around the waist */}
      <mesh position={[0, 0.86, 0]}>
        <boxGeometry args={[1.02, 0.2, 1.42]} />
        <meshStandardMaterial color="#e7ebf0" roughness={0.6} />
      </mesh>

      {/* Wear shows as grime around the base */}
      {grime > 0 && (
        <mesh position={[0, 0.62, 0]}>
          <boxGeometry args={[1.04, 0.36, 1.44]} />
          <meshStandardMaterial color="#3f3a33" roughness={1} transparent opacity={0.3 + grime * 0.4} />
        </mesh>
      )}

      {/* Overhanging cap, pitched the way these are roofed */}
      <mesh position={[0, 2.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.14, 1.7]} />
        <meshStandardMaterial color={bodyColor} roughness={0.45} metalness={trimMetal} />
      </mesh>
      <mesh
        position={[0, 2.71, 0]}
        rotation={[0, Math.PI / 4, 0]}
        scale={[0.92, 0.28, 1.2]}
        castShadow
      >
        <coneGeometry args={[1, 1, 4]} />
        <meshStandardMaterial color={bodyColor} roughness={0.45} metalness={trimMetal} />
      </mesh>

      {/* Status reads along the underside of the cap */}
      <mesh position={[0, 2.4, 0]}>
        <boxGeometry args={[1.02, 0.08, 1.42]} />
        <meshStandardMaterial
          color={statusColor}
          emissive={statusColor}
          emissiveIntensity={isFueling ? 1.4 : 0.55}
          toneMapped={false}
        />
      </mesh>

      {/* Both faces serve a car, so both carry a till panel and a holster */}
      {[1, -1].map((side) => (
        <group key={side} position={[side * 0.508, 0, 0]} rotation={[0, (side * Math.PI) / 2, 0]}>
          {/* Screen, in a dark surround */}
          <mesh position={[0, 1.94, 0]}>
            <planeGeometry args={[1.02, 0.78]} />
            <meshStandardMaterial color="#1c1f26" roughness={0.8} {...DECAL} />
          </mesh>
          <mesh position={[0, 1.96, 0.012]}>
            <planeGeometry args={[0.88, 0.6]} />
            <meshStandardMaterial
              color={isBroken ? '#3f1d1d' : '#eef2f6'}
              emissive={isBroken ? '#7f1d1d' : '#dbe6f0'}
              emissiveIntensity={isBroken ? 0.5 : 0.45}
              toneMapped={false}
              {...decal(2)}
            />
          </mesh>
        </group>
      ))}

      {/* Nozzles racked on both faces, one per fuel */}
      {[1, -1].map((side) =>
        nozzles.map((n) => {
          const z = (-0.42 + n.index * 0.42) * side;
          return (
            <group key={`${side}${n.fuel}`} position={[side * 0.56, 1.08, z]}>
              <mesh castShadow>
                <boxGeometry args={[0.18, 0.4, 0.18]} />
                <meshStandardMaterial color="#1c1f26" roughness={0.75} />
              </mesh>
              <mesh position={[side * 0.03, 0.25, 0]} castShadow>
                <boxGeometry args={[0.16, 0.14, 0.15]} />
                <meshStandardMaterial color={n.color} roughness={0.5} />
              </mesh>

              {/* The hose hangs in a loop from the holster, as they do */}
              <mesh position={[side * 0.05, -0.08, 0]} rotation={[0, Math.PI / 2, Math.PI]}>
                <torusGeometry args={[0.16, 0.038, 6, 12, Math.PI]} />
                <meshStandardMaterial color="#0f172a" roughness={0.9} />
              </mesh>
            </group>
          );
        })
      )}

      {/* Hose running out to the car while it is being served */}
      {isFueling && (
        <mesh position={[1.0, 0.95, 0.3]} rotation={[0, 0, Math.PI / 2.4]}>
          <cylinderGeometry args={[0.07, 0.07, 1.6, 8]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>
      )}

      {/* Marks out the islands a canopy can still go on */}
      {awaitingCanopy && (
        <mesh position={[0, 0.34, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[3.4, 5.4]} />
          <meshBasicMaterial
            color="#38bdf8"
            opacity={0.35}
            transparent
            depthWrite={false}
            {...DECAL}
          />
        </mesh>
      )}

      {pump.hasCanopy && <PumpCanopy />}

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
