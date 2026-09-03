import React, { useRef, Suspense } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VehicleEntity } from '../domain/types/gameState';
import { useGameStore } from '../store/gameStore';
import { Html } from '@react-three/drei';
import { VehicleModel } from './models/VehicleModel';
import { ModelErrorBoundary } from './models/ModelErrorBoundary';

/** Shown for the frame or two before a vehicle's model finishes loading. */
const FallbackBody: React.FC<{ color: string }> = ({ color }) => (
  <mesh position={[0, 0.7, 0]} castShadow>
    <boxGeometry args={[1.7, 1.2, 3.6]} />
    <meshStandardMaterial color={color} roughness={0.5} />
  </mesh>
);

interface VehicleMeshProps {
  vehicle: VehicleEntity;
}

export const VehicleMesh: React.FC<VehicleMeshProps> = ({ vehicle }) => {
  const openFuelingPanel = useGameStore((s) => s.openFuelingPanelForVehicle);
  const gameState = useGameStore((s) => s.gameState);

  const targetPump = vehicle.targetPumpId ? gameState.pumps[vehicle.targetPumpId] : null;
  const pumpHasAttendant = targetPump
    ? Object.values(gameState.employees).some(
        (e) => e.assignedPumpId === targetPump.id && e.role === 'PUMP_ATTENDANT'
      )
    : false;
  const isAttendantServing = vehicle.assignedActor === 'EMPLOYEE' || pumpHasAttendant;

  // The parking offset lives in the route, so world position is used as-is.
  const posX = vehicle.worldPosition[0] * 2;
  const posZ = vehicle.worldPosition[2] * 2;

  const groupRef = useRef<THREE.Group>(null);
  const spawnedRef = useRef(false);

  /**
   * The simulation ticks at 20Hz, so reading its positions straight into the
   * scene makes cars stutter. Ease toward the simulated pose each frame
   * instead and they glide at the display's refresh rate.
   */
  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    if (!spawnedRef.current) {
      group.position.set(posX, 0, posZ);
      group.rotation.y = vehicle.heading;
      spawnedRef.current = true;
      return;
    }

    const ease = Math.min(1, delta * 9);
    group.position.x += (posX - group.position.x) * ease;
    group.position.z += (posZ - group.position.z) * ease;

    // Turn the short way round so a heading flip does not spin the car.
    const turn = ((vehicle.heading - group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    group.rotation.y += turn * Math.min(1, delta * 6);
  });

  // Only customers actually waiting for service get a label; highway traffic
  // would otherwise put a DOM node on screen for every passing car.
  const needsService = vehicle.state === 'AT_PUMP' || vehicle.state === 'REQUEST';
  const isMoving =
    vehicle.state === 'SPAWN' ||
    vehicle.state === 'PASSING' ||
    vehicle.state === 'ROAD_APPROACH' ||
    vehicle.state === 'QUEUE' ||
    vehicle.state === 'PUMP_RESERVED' ||
    vehicle.state === 'EXIT';
  const isFueling = vehicle.state === 'FUELING';
  const isElectric = vehicle.archetype === 'ev';
  const serviceUnit = isElectric ? 'kWh' : 'L';
  const unitPrice = gameState.pricing[vehicle.fuelType]?.playerPrice ?? 0;

  // Archetype color palettes
  const getCarColor = () => {
    switch (vehicle.archetype) {
      case 'taxi':
        return '#facc15'; // Sarı taksi
      case 'family':
        return '#3b82f6'; // Mavi SUV
      case 'courier':
        return '#ef4444'; // Kırmızı kurye vanı
      case 'commercial':
        return '#ffffff'; // Beyaz ticari
      case 'truck':
        return '#0284c7'; // Kamyon
      case 'luxury':
        return '#0f172a'; // Siyah lüks spor
      default:
        return '#10b981'; // Yeşil sedan
    }
  };

  const carColor = getCarColor();
  const patienceRatio = Math.max(0, vehicle.patience / vehicle.maxPatience);

  return (
    <group
      ref={groupRef}
      position={[posX, 0, posZ]}
      onClick={(e) => {
        e.stopPropagation();
        if (needsService && !isAttendantServing) openFuelingPanel(vehicle.id);
      }}
    >
      {/* Vehicle body: Kenney CC0 model, primitives kept as a fallback */}
      <ModelErrorBoundary fallback={<FallbackBody color={carColor} />}>
        <Suspense fallback={<FallbackBody color={carColor} />}>
          <VehicleModel
            archetype={vehicle.archetype}
            vehicleId={vehicle.id}
            speed={isMoving ? vehicle.speed : 0}
          />
        </Suspense>
      </ModelErrorBoundary>

      {/* Request bubble, only while the customer is waiting to be served */}
      {(needsService || isFueling) && (
        <Html
          position={[0, vehicle.archetype === 'truck' ? 3.8 : 2.5, 0]}
          center
          distanceFactor={20}
          zIndexRange={[5, 0]}
        >
          <div
            className={`flex flex-col items-center transition-transform transform ${
              needsService && !isAttendantServing ? 'cursor-pointer' : 'cursor-default'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              if (needsService && !isAttendantServing) openFuelingPanel(vehicle.id);
            }}
          >
            {/* Meter Badge (like beneloil.com: 18.9L • ₺170) */}
            <div className="bg-black/90 border border-slate-700/80 text-white text-xs px-3 py-1.5 rounded-xl shadow-2xl flex items-center gap-1.5 backdrop-blur font-mono whitespace-nowrap">
              {isFueling ? (
                <span className="font-extrabold tracking-wide text-white">
                  {vehicle.request.dispensedLiters.toFixed(1)}{serviceUnit} <span className="text-slate-500 font-normal">•</span> ₺{Math.round(vehicle.request.dispensedLiters * unitPrice)}
                </span>
              ) : (
                <span className="font-extrabold tracking-wide text-slate-200">
                  {vehicle.request.calculatedLiters.toFixed(0)}{serviceUnit} <span className="text-slate-500 font-normal">•</span> ₺{Math.round(vehicle.request.calculatedLiters * unitPrice)}
                </span>
              )}
            </div>

            {/* Patience Bar */}
            <div className="w-16 h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden border border-slate-700">
              <div
                className={`h-full transition-all duration-300 ${
                  patienceRatio > 0.5
                    ? 'bg-emerald-500'
                    : patienceRatio > 0.25
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                }`}
                style={{ width: `${patienceRatio * 100}%` }}
              />
            </div>
          </div>
        </Html>
      )}
    </group>
  );
};
