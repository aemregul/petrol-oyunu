import React, { useMemo } from 'react';
import * as THREE from 'three';
import { BuildingEntity } from '../domain/types/gameState';

/**
 * Hand-built facility geometry for the pieces no CC0 kit covers: wash tunnels,
 * service bays, charging units, parking areas and landscaping.
 *
 * Every component receives the entity so it can size itself to the footprint
 * the catalogue reserved, which keeps the visuals honest about how much space
 * the player actually bought.
 */

interface FacilityProps {
  building: BuildingEntity;
}

/** Grid footprint to world dimensions. */
function dims(building: BuildingEntity): { w: number; d: number } {
  return { w: building.size[0] * 2, d: building.size[1] * 2 };
}

/**
 * Bay markings sized to the vehicles that use them. A car needs about 2.7
 * world units of width, a lorry about 4.4, so the bay count follows from the
 * footprint rather than being a fixed number.
 */
const ParkingBays: React.FC<{
  w: number;
  d: number;
  bayWidth: number;
  color: string;
}> = ({ w, d, bayWidth, color }) => {
  const lines = useMemo(() => {
    const count = Math.max(1, Math.round(w / bayWidth));
    const step = w / count;
    return Array.from({ length: count + 1 }, (_, i) => -w / 2 + i * step);
  }, [w, bayWidth]);

  return (
    <group position={[0, 0.05, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#333c49" roughness={0.85} />
      </mesh>
      {lines.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.01, 0]}>
          <planeGeometry args={[0.2, d * 0.88]} />
          <meshBasicMaterial color={color} transparent opacity={0.8} />
        </mesh>
      ))}
      {/* Stop line across the head of the bays */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -d * 0.44]}>
        <planeGeometry args={[w, 0.2]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 0.12, -d / 2 + 0.18]} castShadow>
        <boxGeometry args={[w, 0.24, 0.36]} />
        <meshStandardMaterial color="#9aa6b5" roughness={0.85} />
      </mesh>
    </group>
  );
};

export const CarPark: React.FC<FacilityProps> = ({ building }) => {
  const { w, d } = dims(building);
  return <ParkingBays w={w} d={d} bayWidth={2.7} color="#e2e8f0" />;
};

export const TruckPark: React.FC<FacilityProps> = ({ building }) => {
  const { w, d } = dims(building);
  return (
    <group>
      <ParkingBays w={w} d={d} bayWidth={4.4} color="#fbbf24" />
      {[-w / 2 + 0.5, w / 2 - 0.5].map((x) => (
        <mesh key={x} position={[x, 1.2, -d / 2 + 0.5]} castShadow>
          <cylinderGeometry args={[0.14, 0.18, 2.4, 8]} />
          <meshStandardMaterial color="#fbbf24" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
};

/** Drive-through wash tunnel: open at both ends, gantry inside. */
/**
 * A drive-through wash tunnel: long, narrow and low.
 *
 * It used to be built to the same height as a two-storey building, which made
 * a single wash bay the bulkiest thing on the forecourt — taller than the
 * office it stood next to. A tunnel is barely higher than the vehicles that go
 * through it, and reads as one only if it is longer than it is wide.
 */
export const CarWash: React.FC<FacilityProps> = ({ building }) => {
  const { w, d } = dims(building);
  const height = 2.7;
  const wall = 0.4;

  return (
    <group>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[w, 0.12, d]} />
        <meshStandardMaterial color="#4b5563" roughness={0.7} />
      </mesh>

      {/* Side walls, leaving the drive-through axis clear */}
      {[-w / 2 + wall / 2, w / 2 - wall / 2].map((x) => (
        <mesh key={x} position={[x, height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[wall, height, d]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.6} />
        </mesh>
      ))}

      {/* Roof and brand band */}
      <mesh position={[0, height + 0.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.3, d]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.6} metalness={0.15} />
      </mesh>
      <mesh position={[0, height - 0.05, d / 2 + 0.05]}>
        <boxGeometry args={[w, 0.45, 0.2]} />
        <meshStandardMaterial
          color="#0ea5e9"
          emissive="#0ea5e9"
          emissiveIntensity={0.5}
          toneMapped={false}
        />
      </mesh>

      {/* Brush gantry spanning the tunnel */}
      <mesh position={[0, height - 0.75, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, w - wall * 2, 10]} />
        <meshStandardMaterial color="#38bdf8" roughness={0.5} />
      </mesh>
    </group>
  );
};

/** Two-bay workshop shared by the oil and tyre services. */
const ServiceBays: React.FC<FacilityProps & { accent: string }> = ({
  building,
  accent
}) => {
  const { w, d } = dims(building);
  const height = 4.4;

  return (
    <group>
      {/* Shell */}
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, height, d]} />
        <meshStandardMaterial color="#dfe5ec" roughness={0.7} />
      </mesh>

      {/* Roof cap */}
      <mesh position={[0, height + 0.25, 0]} castShadow>
        <boxGeometry args={[w + 0.4, 0.5, d + 0.4]} />
        <meshStandardMaterial color="#64748b" roughness={0.7} />
      </mesh>

      {/* Two roller doors on the front face */}
      {[-w / 4, w / 4].map((x) => (
        <group key={x} position={[x, 0, d / 2 + 0.02]}>
          <mesh position={[0, height * 0.42, 0]}>
            <planeGeometry args={[w * 0.36, height * 0.72]} />
            <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh position={[0, height * 0.8, 0.03]}>
            <planeGeometry args={[w * 0.36, 0.3]} />
            <meshStandardMaterial
              color={accent}
              emissive={accent}
              emissiveIntensity={0.5}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
};

export const OilChange: React.FC<FacilityProps> = ({ building }) => {
  const { w, d } = dims(building);
  return (
    <group>
      <ServiceBays building={building} accent="#f59e0b" />
      {/* Oil drums stacked beside the forecourt door */}
      {[
        [-w / 2 - 0.7, d / 2 - 0.8],
        [-w / 2 - 0.7, d / 2 - 1.9],
        [-w / 2 - 1.6, d / 2 - 1.35]
      ].map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, 0.5, z]} castShadow>
          <cylinderGeometry args={[0.36, 0.36, 1, 12]} />
          <meshStandardMaterial color="#c2410c" roughness={0.6} metalness={0.2} />
        </mesh>
      ))}
      {/* Funnel and oil can on a small bench */}
      <mesh position={[w / 2 + 0.9, 0.35, d / 2 - 1.2]} castShadow>
        <boxGeometry args={[1.1, 0.7, 0.6]} />
        <meshStandardMaterial color="#475569" roughness={0.8} />
      </mesh>
      <mesh position={[w / 2 + 0.9, 0.92, d / 2 - 1.2]} castShadow>
        <cylinderGeometry args={[0.18, 0.22, 0.45, 10]} />
        <meshStandardMaterial color="#facc15" roughness={0.5} />
      </mesh>
    </group>
  );
};

export const TyreService: React.FC<FacilityProps> = ({ building }) => {
  const { w, d } = dims(building);
  return (
    <group>
      <ServiceBays building={building} accent="#0ea5e9" />

      {/* Tyre stacks flanking the doors */}
      {[-w / 2 - 0.8, w / 2 + 0.8].map((x) =>
        [0, 1, 2, 3].map((i) => (
          <mesh
            key={`${x}_${i}`}
            position={[x, 0.2 + i * 0.34, d / 2 - 1]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <torusGeometry args={[0.42, 0.17, 8, 14]} />
            <meshStandardMaterial color="#1f2937" roughness={0.95} />
          </mesh>
        ))
      )}

      {/* Display rack of tyres standing on edge out front */}
      {[-0.9, 0, 0.9].map((x) => (
        <mesh key={x} position={[x, 0.55, d / 2 + 1.1]} castShadow>
          <torusGeometry args={[0.5, 0.18, 8, 16]} />
          <meshStandardMaterial color="#111827" roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[0, 0.06, d / 2 + 1.1]} receiveShadow>
        <boxGeometry args={[3, 0.12, 1.2]} />
        <meshStandardMaterial color="#64748b" roughness={0.9} />
      </mesh>
    </group>
  );
};

/**
 * Air and water point: a slim stainless column with a pressure gauge, a hose
 * on a reel and a water tap at the base. Deliberately unlike a fuel pump so
 * the two are never confused on the forecourt.
 */
export const AirWater: React.FC<FacilityProps> = ({ building }) => {
  const { w, d } = dims(building);

  return (
    <group>
      {/* Small kerbed pad */}
      <mesh position={[0, 0.09, 0]} receiveShadow castShadow>
        <boxGeometry args={[w * 0.85, 0.18, d * 0.7]} />
        <meshStandardMaterial color="#6b7688" roughness={0.9} />
      </mesh>

      {/* Stainless column */}
      <mesh position={[0, 1.15, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.3, 2.1, 12]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Head with the pressure gauge */}
      <mesh position={[0, 2.32, 0]} castShadow>
        <boxGeometry args={[0.62, 0.5, 0.5]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.45} metalness={0.3} />
      </mesh>
      <mesh position={[0, 2.32, 0.26]}>
        <circleGeometry args={[0.16, 16]} />
        <meshStandardMaterial
          color="#e2e8f0"
          emissive="#94a3b8"
          emissiveIntensity={0.4}
          toneMapped={false}
        />
      </mesh>

      {/* Coiled hose on its reel */}
      <mesh position={[0.32, 1.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <torusGeometry args={[0.24, 0.09, 8, 14]} />
        <meshStandardMaterial color="#1f2937" roughness={0.9} />
      </mesh>

      {/* Water tap and drain grate */}
      <mesh position={[-0.3, 0.5, 0.12]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.35, 8]} />
        <meshStandardMaterial color="#64748b" metalness={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.19, d * 0.26]}>
        <planeGeometry args={[0.7, 0.3]} />
        <meshStandardMaterial color="#475569" roughness={0.9} />
      </mesh>
    </group>
  );
};

/** Pole-mounted transformer feeding the charging units. */
export const EvSubstation: React.FC<FacilityProps> = () => (
  <group>
    <mesh position={[0, 0.2, 0]} receiveShadow castShadow>
      <boxGeometry args={[1.5, 0.4, 1.5]} />
      <meshStandardMaterial color="#6b7688" roughness={0.9} />
    </mesh>

    {/* Timber pole */}
    <mesh position={[0, 4.2, 0]} castShadow>
      <cylinderGeometry args={[0.18, 0.24, 8, 10]} />
      <meshStandardMaterial color="#7a6248" roughness={0.95} />
    </mesh>

    {/* Cross-arm with insulators */}
    <mesh position={[0, 7.4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <boxGeometry args={[0.16, 3.4, 0.22]} />
      <meshStandardMaterial color="#8a7359" roughness={0.95} />
    </mesh>
    {[-1.4, 0, 1.4].map((x) => (
      <mesh key={x} position={[x, 7.62, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.13, 0.34, 8]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.4} />
      </mesh>
    ))}

    {/* Transformer drum strapped to the pole */}
    <mesh position={[0.45, 5.4, 0]} castShadow>
      <cylinderGeometry args={[0.42, 0.42, 1.1, 14]} />
      <meshStandardMaterial color="#475569" metalness={0.45} roughness={0.55} />
    </mesh>
    <mesh position={[0.45, 6.05, 0]}>
      <cylinderGeometry args={[0.16, 0.16, 0.3, 10]} />
      <meshStandardMaterial
        color="#facc15"
        emissive="#facc15"
        emissiveIntensity={0.7}
        toneMapped={false}
      />
    </mesh>

    {/* Warning plate at eye level */}
    <mesh position={[0, 2.4, 0.26]}>
      <planeGeometry args={[0.5, 0.5]} />
      <meshStandardMaterial
        color="#facc15"
        emissive="#facc15"
        emissiveIntensity={0.35}
        toneMapped={false}
      />
    </mesh>
  </group>
);

/** A lightning bolt, drawn once and shared by every battery cabinet. */
const BOLT_SHAPE = (() => {
  const bolt = new THREE.Shape();
  bolt.moveTo(0.05, 0.5);
  bolt.lineTo(-0.24, -0.04);
  bolt.lineTo(-0.04, -0.04);
  bolt.lineTo(-0.14, -0.5);
  bolt.lineTo(0.24, 0.06);
  bolt.lineTo(0.03, 0.06);
  bolt.closePath();
  return bolt;
})();

/**
 * Battery bank: a row of cabinets on a plinth.
 *
 * It carries no name board. What it is has to be legible from the cabinets
 * themselves, so each one is framed in the green these units are marked in and
 * struck with a bolt — the two things every battery enclosure on a forecourt
 * actually wears.
 */
export const EnergyStorage: React.FC<FacilityProps> = ({ building }) => {
  const { w, d } = dims(building);
  const cabinets = [-w * 0.28, 0, w * 0.28];
  const face = d * 0.25;
  const panelW = w * 0.2;

  return (
    <group>
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <boxGeometry args={[w * 0.92, 0.3, d * 0.7]} />
        <meshStandardMaterial color="#6b7688" roughness={0.9} />
      </mesh>
      {cabinets.map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 1.35, 0]} castShadow receiveShadow>
            <boxGeometry args={[w * 0.24, 2.1, d * 0.5]} />
            <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.35} />
          </mesh>

          {/* Green surround on both faces, with the door recessed inside it */}
          {[1, -1].map((facing) => (
            <group
              key={facing}
              position={[0, 1.35, facing * (face + 0.03)]}
              rotation={[0, facing > 0 ? 0 : Math.PI, 0]}
            >
              <mesh>
                <planeGeometry args={[panelW, 1.72]} />
                <meshStandardMaterial
                  color="#22c55e"
                  emissive="#22c55e"
                  emissiveIntensity={0.75}
                  toneMapped={false}
                />
              </mesh>
              <mesh position={[0, 0, 0.012]}>
                <planeGeometry args={[panelW - 0.18, 1.54]} />
                <meshStandardMaterial color="#1e293b" roughness={0.6} />
              </mesh>
              <mesh position={[0, 0, 0.024]} scale={[panelW * 1.15, panelW * 1.15, 1]}>
                <shapeGeometry args={[BOLT_SHAPE]} />
                <meshStandardMaterial
                  color="#22c55e"
                  emissive="#22c55e"
                  emissiveIntensity={1.1}
                  toneMapped={false}
                />
              </mesh>
            </group>
          ))}

          {/* Charge indicator across the top of the cabinet */}
          <mesh position={[0, 2.46, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[w * 0.16, d * 0.3]} />
            <meshStandardMaterial
              color="#22c55e"
              emissive="#22c55e"
              emissiveIntensity={1.2}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
};

/** Charging pillar. DC units are taller, heavier and marked in orange. */
export const EvCharger: React.FC<FacilityProps & { fast?: boolean }> = ({
  building,
  fast = false
}) => {
  const { w, d } = dims(building);
  const accent = fast ? '#f97316' : '#22c55e';
  const height = fast ? 2.4 : 1.9;

  return (
    <group>
      {/* Island pad and kerb, same language as the fuel pump */}
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <boxGeometry args={[w * 0.9, 0.3, d * 0.9]} />
        <meshStandardMaterial color="#6b7688" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.31, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w * 0.92, d * 0.92]} />
        <meshBasicMaterial color={accent} transparent opacity={0.25} />
      </mesh>

      <mesh position={[0, 0.3 + height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[fast ? 1.1 : 0.8, height, fast ? 0.85 : 0.6]} />
        <meshStandardMaterial color="#111827" roughness={0.45} metalness={0.4} />
      </mesh>

      {/* Screen */}
      <mesh position={[0, 0.3 + height * 0.72, (fast ? 0.43 : 0.31)]}>
        <planeGeometry args={[fast ? 0.7 : 0.5, 0.42]} />
        <meshStandardMaterial
          color="#082f49"
          emissive="#0ea5e9"
          emissiveIntensity={0.9}
          toneMapped={false}
        />
      </mesh>

      {/* Accent band and cable */}
      <mesh position={[0, 0.3 + height - 0.12, 0]}>
        <boxGeometry args={[fast ? 1.13 : 0.83, 0.2, fast ? 0.88 : 0.63]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.8}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[fast ? 0.62 : 0.46, 0.3 + height * 0.45, 0]} rotation={[0, 0, 0.5]}>
        <cylinderGeometry args={[0.06, 0.06, 1.1, 8]} />
        <meshStandardMaterial color="#0f172a" roughness={0.9} />
      </mesh>
    </group>
  );
};

/** Landscaping: planter beds, shrubs and a bench. */
export const Decoration: React.FC<FacilityProps> = ({ building }) => {
  const { w, d } = dims(building);
  return (
    <group>
      {/* Raised planter */}
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.9, 0.5, d * 0.9]} />
        <meshStandardMaterial color="#9aa6b5" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.52, 0]} receiveShadow>
        <boxGeometry args={[w * 0.78, 0.1, d * 0.78]} />
        <meshStandardMaterial color="#4a3a2a" roughness={1} />
      </mesh>

      {/* Shrubs */}
      {[
        [-w * 0.22, -d * 0.18, 0.62],
        [w * 0.2, d * 0.16, 0.78],
        [0, -d * 0.02, 0.5]
      ].map(([x, z, scale]) => (
        <mesh key={`${x},${z}`} position={[x, 0.62 + scale * 0.5, z]} scale={scale} castShadow>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#4d8f3c" roughness={1} flatShading />
        </mesh>
      ))}

      {/* Bench alongside */}
      <group position={[0, 0, d * 0.62]}>
        <mesh position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[w * 0.7, 0.12, 0.5]} />
          <meshStandardMaterial color="#8b5a2b" roughness={0.9} />
        </mesh>
        {[-w * 0.28, w * 0.28].map((x) => (
          <mesh key={x} position={[x, 0.22, 0]} castShadow>
            <boxGeometry args={[0.12, 0.44, 0.44]} />
            <meshStandardMaterial color="#4b5563" roughness={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  );
};

/**
 * A one-way ramp. The highway runs in a single direction, so entry and exit
 * are separate structures rather than two lanes of one gate.
 *
 * Which way the paint points depends on the block the ramp serves — traffic on
 * the far side of the highway runs the other way — but the colour follows the
 * job it does, so an entrance is green on both sides of the road.
 */
const OneWayRamp: React.FC<FacilityProps & { role: 'entry' | 'exit' }> = ({
  building,
  role
}) => {
  const { w, d } = dims(building);
  const accent = role === 'entry' ? '#22c55e' : '#ef4444';

  const onNearSide = building.position[1] >= 0;
  const towardPositiveZ = role === 'entry' ? onNearSide : !onNearSide;

  return (
    <group position={[0, 0.05, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#2f3844" roughness={0.8} />
      </mesh>

      {/* Two lanes running the same way, split by a dashed centre line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[0.22, d * 0.9]} />
        <meshBasicMaterial color="#fbbf24" />
      </mesh>
      {[-w / 2 + 0.35, w / 2 - 0.35].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.01, 0]}>
          <planeGeometry args={[0.22, d * 0.9]} />
          <meshBasicMaterial color="#e2e8f0" />
        </mesh>
      ))}

      {/* Both lanes point the same way, painted the same as the mouth this
          ramp replaces. Laid flat, the group's local +y points to world -z, so
          traffic heading onto the forecourt needs the extra half turn. */}
      {[-w / 4, w / 4].map((x) => {
        const total = Math.min(d * 0.72, w * 0.3);
        // An equilateral triangle of circumradius r spans 1.5r along its axis.
        const r = Math.min((total * 0.45) / 1.5, (w * 0.2) / 1.73);
        const shaftLength = Math.max(0.1, total - 1.5 * r);

        return (
          <group
            key={x}
            position={[x, 0.02, 0]}
            rotation={[-Math.PI / 2, 0, towardPositiveZ ? Math.PI : 0]}
          >
            <mesh position={[0, -0.75 * r, 0]}>
              <planeGeometry args={[r * 0.62, shaftLength]} />
              <meshBasicMaterial color={accent} />
            </mesh>
            <mesh position={[0, total / 2 - r, 0]} rotation={[0, 0, Math.PI / 2]}>
              <circleGeometry args={[r, 3]} />
              <meshBasicMaterial color={accent} />
            </mesh>
          </group>
        );
      })}

      {/* Gate posts with a direction plate */}
      {[-w / 2 + 0.4, w / 2 - 0.4].map((x) => (
        <group key={x} position={[x, 0, towardPositiveZ ? -d / 2 + 0.4 : d / 2 - 0.4]}>
          <mesh position={[0, 1.3, 0]} castShadow>
            <cylinderGeometry args={[0.13, 0.16, 2.6, 8]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh position={[0, 2.6, 0]}>
            <boxGeometry args={[0.7, 0.5, 0.12]} />
            <meshStandardMaterial
              color={accent}
              emissive={accent}
              emissiveIntensity={0.6}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
};

export const WideEntry: React.FC<FacilityProps> = ({ building }) => (
  <OneWayRamp building={building} role="entry" />
);

export const WideExit: React.FC<FacilityProps> = ({ building }) => (
  <OneWayRamp building={building} role="exit" />
);

/** Two-storey roadside restaurant with a terrace of outdoor tables. */
export const Restaurant: React.FC<FacilityProps> = ({ building }) => {
  const { w, d } = dims(building);
  const bodyW = w * 0.72;
  const bodyD = d * 0.66;
  const floor = 3.2;

  return (
    <group>
      {/* Ground floor with a glazed frontage */}
      <mesh position={[0, floor / 2, -d * 0.14]} castShadow receiveShadow>
        <boxGeometry args={[bodyW, floor, bodyD]} />
        <meshStandardMaterial color="#f1e4d0" roughness={0.75} />
      </mesh>
      <mesh position={[0, floor * 0.5, -d * 0.14 + bodyD / 2 + 0.02]}>
        <planeGeometry args={[bodyW * 0.85, floor * 0.55]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.15} transparent opacity={0.75} />
      </mesh>

      {/* Upper floor, set back slightly */}
      <mesh position={[0, floor + floor * 0.45, -d * 0.18]} castShadow receiveShadow>
        <boxGeometry args={[bodyW * 0.88, floor * 0.9, bodyD * 0.85]} />
        <meshStandardMaterial color="#e7d6bd" roughness={0.75} />
      </mesh>
      <mesh position={[0, floor + floor * 0.45, -d * 0.18 + (bodyD * 0.85) / 2 + 0.02]}>
        <planeGeometry args={[bodyW * 0.7, floor * 0.4]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.15} transparent opacity={0.7} />
      </mesh>

      {/* Roof trim */}
      <mesh position={[0, floor * 2.02, -d * 0.18]} castShadow>
        <boxGeometry args={[bodyW * 0.94, 0.34, bodyD * 0.9]} />
        <meshStandardMaterial color="#8b5a2b" roughness={0.8} />
      </mesh>

      {/* Entrance doors */}
      <mesh position={[0, floor * 0.34, -d * 0.14 + bodyD / 2 + 0.04]}>
        <planeGeometry args={[bodyW * 0.2, floor * 0.66]} />
        <meshStandardMaterial color="#3b2413" roughness={0.5} />
      </mesh>

      {/* Striped awning over the terrace */}
      <mesh position={[0, floor * 0.95, -d * 0.14 + bodyD / 2 + 0.9]} rotation={[0.28, 0, 0]} castShadow>
        <boxGeometry args={[bodyW, 0.14, 2.2]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.8} />
      </mesh>

      {/* Timber terrace deck the tables stand on */}
      <mesh position={[0, 0.07, d * 0.28]} receiveShadow>
        <boxGeometry args={[bodyW * 1.05, 0.14, d * 0.4]} />
        <meshStandardMaterial color="#a97c50" roughness={0.9} />
      </mesh>

      {/* Outdoor tables with parasols */}
      {[-bodyW * 0.3, 0, bodyW * 0.3].map((x) => (
        <group key={x} position={[x, 0, d * 0.28]}>
          <mesh position={[0, 0.36, 0]} castShadow>
            <cylinderGeometry args={[0.62, 0.62, 0.1, 14]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.18, 0]}>
            <cylinderGeometry args={[0.08, 0.1, 0.36, 8]} />
            <meshStandardMaterial color="#64748b" metalness={0.4} />
          </mesh>
          {/* Parasol */}
          <mesh position={[0, 1.15, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 1.6, 6]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.4} />
          </mesh>
          <mesh position={[0, 1.95, 0]} castShadow>
            <coneGeometry args={[1.1, 0.5, 8]} />
            <meshStandardMaterial color="#dc2626" roughness={0.85} />
          </mesh>
          {/* Two chairs */}
          {[-0.85, 0.85].map((cx) => (
            <mesh key={cx} position={[cx, 0.28, 0]} castShadow>
              <boxGeometry args={[0.42, 0.55, 0.42]} />
              <meshStandardMaterial color="#7c8798" roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
};

/**
 * The combined rest stop: a long two-storey block, wider than it is tall, with
 * a colonnade running along the front rather than another office tower.
 */
export const RestComplex: React.FC<FacilityProps> = ({ building }) => {
  const { w, d } = dims(building);
  const floor = 3.4;
  const bodyD = d * 0.6;

  return (
    <group>
      {/* Long ground floor */}
      <mesh position={[0, floor / 2, -d * 0.1]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.94, floor, bodyD]} />
        <meshStandardMaterial color="#eef2f7" roughness={0.75} />
      </mesh>
      {/* Continuous shopfront glazing */}
      <mesh position={[0, floor * 0.48, -d * 0.1 + bodyD / 2 + 0.02]}>
        <planeGeometry args={[w * 0.86, floor * 0.5]} />
        <meshStandardMaterial color="#0ea5e9" roughness={0.15} transparent opacity={0.7} />
      </mesh>

      {/* Shorter upper floor */}
      <mesh position={[0, floor + floor * 0.4, -d * 0.14]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.8, floor * 0.8, bodyD * 0.82]} />
        <meshStandardMaterial color="#d7dfe9" roughness={0.75} />
      </mesh>

      {/* Upper-floor window bank */}
      {Array.from({ length: 9 }, (_, i) => -w * 0.34 + (i * w * 0.68) / 8).map((x) => (
        <mesh
          key={`win${x}`}
          position={[x, floor + floor * 0.42, -d * 0.14 + (bodyD * 0.82) / 2 + 0.02]}
        >
          <planeGeometry args={[w * 0.05, floor * 0.4]} />
          <meshStandardMaterial color="#1e3a5f" roughness={0.2} metalness={0.3} />
        </mesh>
      ))}

      {/* Central entrance */}
      <mesh position={[0, floor * 0.36, -d * 0.1 + bodyD / 2 + 0.03]}>
        <planeGeometry args={[w * 0.12, floor * 0.7]} />
        <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.35} />
      </mesh>

      {/* Roof plant */}
      {[-w * 0.25, w * 0.2].map((x) => (
        <mesh key={`plant${x}`} position={[x, floor * 2.05, -d * 0.14]} castShadow>
          <boxGeometry args={[w * 0.1, 0.7, bodyD * 0.3]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.8} />
        </mesh>
      ))}

      {/* Brand band along the roof line */}
      <mesh position={[0, floor * 1.86, -d * 0.14]}>
        <boxGeometry args={[w * 0.83, 0.5, bodyD * 0.86]} />
        <meshStandardMaterial
          color="#0284c7"
          emissive="#0284c7"
          emissiveIntensity={0.5}
          toneMapped={false}
        />
      </mesh>

      {/* Colonnade and its canopy over the walkway */}
      <mesh position={[0, floor * 0.92, -d * 0.1 + bodyD / 2 + 1.5]} castShadow>
        <boxGeometry args={[w * 0.94, 0.3, 3]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.7} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => -w * 0.4 + (i * w * 0.8) / 5).map((x) => (
        <mesh key={x} position={[x, floor * 0.45, -d * 0.1 + bodyD / 2 + 2.8]} castShadow>
          <cylinderGeometry args={[0.16, 0.18, floor * 0.9, 10]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
};
