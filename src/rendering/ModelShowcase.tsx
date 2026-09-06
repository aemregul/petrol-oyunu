import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, PerspectiveCamera } from '@react-three/drei';
import {
  PumpEntity,
  VehicleArchetype,
  VehicleModelVariant
} from '../domain/types/gameState';
import {
  PUMP_BAY_OFFSET,
  vehicleBodyHalfExtents
} from '../domain/services/simulationEngine';
import { ElectricVehicleModel } from './models/ElectricVehicleModel';
import { VehicleModel } from './models/VehicleModel';
import { PumpMesh } from './PumpMesh';

/**
 * A side-by-side lineup of candidate models, opened with ?showcase=1.
 * Development aid for choosing art assets, not part of the game itself.
 */

const CANDIDATES: Array<{ model: VehicleModelVariant; label: string }> = [
  { model: 'sedan', label: 'Sedan' },
  { model: 'hatchback', label: 'Hatchback' },
  { model: 'suv', label: 'SUV' },
  { model: 'taxi', label: 'Taksi' },
  { model: 'van', label: 'Van' },
  { model: 'pickup', label: 'Pickup' },
  { model: 'truck', label: 'Kamyon' },
  { model: 'truck-with-trailer', label: 'Dorseli Tır' },
  { model: 'sports', label: 'Spor' },
  { model: 'roadster', label: 'Roadster' },
  { model: 'muscle', label: 'Muscle' },
  { model: 'muscle-2', label: 'Muscle II' },
  { model: 'limousine', label: 'Limuzin' },
  { model: 'police-sedan', label: 'Polis Sedan' },
  { model: 'police-suv', label: 'Polis SUV' },
  { model: 'police-sports', label: 'Polis Spor' },
  { model: 'police-muscle', label: 'Polis Muscle' },
  { model: 'ambulance', label: 'Ambulans' },
  { model: 'firetruck', label: 'İtfaiye' },
  { model: 'bus', label: 'Otobüs' },
  { model: 'monster-truck', label: 'Monster Truck' }
];

export const ModelShowcase: React.FC = () => (
  <div className="w-screen h-screen bg-slate-900">
    <Canvas shadows dpr={[1, 2]}>
      <PerspectiveCamera
        makeDefault
        fov={38}
        position={[0, 27, 35]}
        onUpdate={(c) => c.lookAt(0, 0, 0)}
      />
      <ambientLight intensity={0.8} />
      <directionalLight position={[8, 14, 10]} intensity={2} castShadow />
      <hemisphereLight groundColor="#334155" intensity={0.5} />
      <color attach="background" args={['#1e293b']} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#39424f" roughness={0.8} />
      </mesh>

      <Suspense fallback={null}>
        {CANDIDATES.map((candidate, index) => {
          const col = index % 7;
          const row = Math.floor(index / 7);
          return (
            <group
              key={candidate.model}
              position={[col * 4.6 - 13.8, 0, row * 5.4 - 5.4]}
              rotation={[0, -0.28, 0]}
            >
              <VehicleModel
                archetype="commuter"
                vehicleId={`showcase_${index}`}
                modelVariant={candidate.model}
                speed={0}
              />
              <Html position={[0, 3.2, 0]} center distanceFactor={30}>
                <div className="text-[12px] font-bold text-white whitespace-nowrap bg-slate-950/85 px-2 py-1 rounded">
                  {candidate.label}
                </div>
              </Html>
            </group>
          );
        })}
      </Suspense>
    </Canvas>
  </div>
);

/** Focused development view for comparing the two procedural EV bodies. */
export const ElectricVehicleShowcase: React.FC = () => (
  <div className="w-screen h-screen bg-slate-900">
    <Canvas shadows dpr={[1, 2]}>
      <PerspectiveCamera
        makeDefault
        fov={35}
        position={[8, 7, 11]}
        onUpdate={(camera) => camera.lookAt(0, 0.7, 0)}
      />
      <ambientLight intensity={1.1} />
      <directionalLight position={[7, 11, 8]} intensity={2.4} castShadow />
      <hemisphereLight groundColor="#1e293b" intensity={0.7} />
      <color attach="background" args={['#172033']} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[30, 20]} />
        <meshStandardMaterial color="#344154" roughness={0.82} />
      </mesh>

      <group position={[-2.7, 0, 0]} rotation={[0, -0.28, 0]}>
        <ElectricVehicleModel vehicleId="veh_even" speed={0} />
        <Html position={[0, 2.7, 0]} center distanceFactor={16}>
          <div className="rounded-xl bg-slate-950/90 px-4 py-2 font-bold text-cyan-300 whitespace-nowrap">
            Modern EV Hatchback
          </div>
        </Html>
      </group>
      <group position={[2.7, 0, 0]} rotation={[0, -0.28, 0]}>
        <ElectricVehicleModel vehicleId="veh_odd" speed={0} />
        <Html position={[0, 2.7, 0]} center distanceFactor={16}>
          <div className="rounded-xl bg-slate-950/90 px-4 py-2 font-bold text-cyan-300 whitespace-nowrap">
            Kompakt Şehir EV
          </div>
        </Html>
      </group>
    </Canvas>
  </div>
);

interface DockingCandidate {
  model: VehicleModelVariant;
  archetype: VehicleArchetype;
  label: string;
}

const DOCKING_CANDIDATES: DockingCandidate[] = [
  { model: 'monster-truck', archetype: 'monster', label: 'Monster Truck' },
  { model: 'firetruck', archetype: 'firetruck', label: 'İtfaiye' },
  { model: 'limousine', archetype: 'luxury', label: 'Limuzin' },
  { model: 'truck-with-trailer', archetype: 'truck', label: 'Dorseli Tır' },
  { model: 'ambulance', archetype: 'ambulance', label: 'Ambulans' }
];

function showcasePump(id: string): PumpEntity {
  return {
    id,
    level: 3,
    position: [0, 0],
    rotation: 0,
    supportedFuels: ['gasoline', 'diesel', 'lpg'],
    state: 'FUELING',
    health: 100,
    employeeId: null,
    currentVehicleId: `vehicle_${id}`,
    flowRateLps: 13,
    hasCanopy: false
  };
}

/**
 * Large vehicles parked at the exact lateral offset used by the simulation.
 * Open with ?showcase=docking to review rare customers without waiting for
 * random traffic to send each one into the station.
 */
export const PumpDockingShowcase: React.FC = () => (
  <div className="w-screen h-screen bg-slate-900">
    <Canvas shadows dpr={[1, 2]}>
      <PerspectiveCamera
        makeDefault
        fov={37}
        position={[25, 28, 37]}
        onUpdate={(camera) => camera.lookAt(0, 0, 2)}
      />
      <ambientLight intensity={0.85} />
      <directionalLight position={[14, 24, 18]} intensity={2.2} castShadow />
      <hemisphereLight groundColor="#27313d" intensity={0.55} />
      <color attach="background" args={['#182230']} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 2]} receiveShadow>
        <planeGeometry args={[55, 42]} />
        <meshStandardMaterial color="#59616a" roughness={0.9} />
      </mesh>

      <Suspense fallback={null}>
        {DOCKING_CANDIDATES.map((candidate, index) => {
          const topRow = index < 3;
          const cellX = topRow ? (index - 1) * 15 : (index - 3.5) * 15;
          const cellZ = topRow ? -6 : 10;
          const body = vehicleBodyHalfExtents(candidate);
          const extraClearance = Math.max(0, body.width - 0.43);
          const vehicleX = (PUMP_BAY_OFFSET + extraClearance) * 2;
          const pump = showcasePump(`docking_pump_${index}`);

          return (
            <group key={candidate.model} position={[cellX, 0, cellZ]}>
              <PumpMesh pump={pump} />
              <group position={[vehicleX, 0, 0]}>
                <VehicleModel
                  archetype={candidate.archetype}
                  vehicleId={`docking_vehicle_${index}`}
                  modelVariant={candidate.model}
                  speed={0}
                />
              </group>
              <Html position={[vehicleX, 4.6, 0]} center distanceFactor={32}>
                <div className="rounded-lg border border-slate-600 bg-slate-950/90 px-3 py-1.5 text-[13px] font-bold text-white whitespace-nowrap">
                  {candidate.label}
                </div>
              </Html>
            </group>
          );
        })}
      </Suspense>
    </Canvas>
  </div>
);
