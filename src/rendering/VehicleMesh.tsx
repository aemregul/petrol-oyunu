import React, { useRef, Suspense } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VehicleEntity } from '../domain/types/gameState';
import { useGameStore } from '../store/gameStore';
import { Html } from '@react-three/drei';
import { VehicleModel } from './models/VehicleModel';
import { ModelErrorBoundary } from './models/ModelErrorBoundary';
import { GAME_CONFIG } from '../config/gameConfig';

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

function getRequestHeight(modelVariant: VehicleEntity['modelVariant']): number {
  switch (modelVariant) {
    case 'firetruck':
      return 4.5;
    case 'bus':
    case 'truck-with-trailer':
      return 4.2;
    case 'truck':
      return 4;
    case 'ambulance':
    case 'monster-truck':
      return 3.7;
    case 'van':
      return 3.1;
    default:
      return 2.5;
  }
}

export const VehicleMesh: React.FC<VehicleMeshProps> = ({ vehicle }) => {
  const openFuelingPanel = useGameStore((s) => s.openFuelingPanelForVehicle);
  const gameState = useGameStore((s) => s.gameState);

  const startVehicleCharging = useGameStore((s) => s.startVehicleCharging);
  const targetPump = vehicle.targetPumpId ? gameState.pumps[vehicle.targetPumpId] : null;
  // A post is served like a pump: by the hand on it, or by the player.
  const servicePointId = targetPump?.id ?? vehicle.chargingBuildingId ?? null;
  const pumpHasAttendant = servicePointId
    ? Object.values(gameState.employees).some(
        (e) => e.assignedPumpId === servicePointId && e.role === 'PUMP_ATTENDANT'
      )
    : false;
  const isAttendantServing = vehicle.assignedActor === 'EMPLOYEE' || pumpHasAttendant;
  const atCharger = !!vehicle.chargingBuildingId;
  const serve = () => {
    if (atCharger) startVehicleCharging(vehicle.id);
    else openFuelingPanel(vehicle.id);
  };

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
    vehicle.state === 'TO_PARK' ||
    vehicle.state === 'EXIT';
  const isFueling = vehicle.state === 'FUELING';

  // A card over a car whose driver has gone in — and it is a warning when
  // the car is standing at a pump, because that pump is out of action until
  // they come back.
  const visitBuilding = vehicle.visitBuildingId ? gameState.buildings[vehicle.visitBuildingId] : null;
  const awayLabel =
    vehicle.state === 'VISITING' && visitBuilding
      ? vehicle.visitor?.phase === 'TO_CAR'
        ? 'Sürücü dönüyor'
        : GAME_CONFIG.facilities[visitBuilding.type]?.driverAway ?? 'Sürücü içeride'
      : vehicle.state === 'TO_PARK'
        ? 'Park ediyor'
        : null;
  const holdsPump = vehicle.state === 'VISITING' && vehicle.visitMode === 'PUMP';
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
      case 'police':
        return '#e2e8f0';
      case 'ambulance':
        return '#ffffff';
      case 'firetruck':
        return '#dc2626';
      case 'bus':
        return '#2563eb';
      case 'monster':
        return '#0ea5e9';
      case 'luxury':
        return '#0f172a'; // Siyah lüks spor
      default:
        return '#10b981'; // Yeşil sedan
    }
  };

  const carColor = getCarColor();
  const patienceRatio = Math.max(0, vehicle.patience / vehicle.maxPatience);
  const requestHeight = getRequestHeight(vehicle.modelVariant);

  return (
    <group
      ref={groupRef}
      position={[posX, 0, posZ]}
      onClick={(e) => {
        e.stopPropagation();
        if (needsService && !isAttendantServing) serve();
      }}
    >
      {/* Vehicle body: RgsDev CC0 model, primitives kept as a fallback. */}
      <ModelErrorBoundary fallback={<FallbackBody color={carColor} />}>
        <Suspense fallback={<FallbackBody color={carColor} />}>
          <VehicleModel
            archetype={vehicle.archetype}
            vehicleId={vehicle.id}
            modelVariant={vehicle.modelVariant}
            speed={isMoving ? vehicle.speed : 0}
          />
        </Suspense>
      </ModelErrorBoundary>

      {awayLabel && (
        <Html position={[0, requestHeight, 0]} center distanceFactor={20} zIndexRange={[5, 0]}>
          <div
            className={`text-[11px] px-2.5 py-1 rounded-xl shadow-xl backdrop-blur font-bold whitespace-nowrap border ${
              holdsPump
                ? 'bg-amber-500/95 border-amber-200 text-slate-950'
                : 'bg-black/80 border-slate-700/80 text-slate-200'
            }`}
          >
            {holdsPump ? `⚠ ${awayLabel} — pompa dolu` : awayLabel}
          </div>
        </Html>
      )}

      {/* Request bubble, only while the customer is waiting to be served */}
      {(needsService || isFueling) && (
        <Html
          position={[0, requestHeight, 0]}
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
              if (needsService && !isAttendantServing) serve();
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
                  {atCharger
                    ? <>⚡ {vehicle.request.calculatedLiters.toFixed(0)} kWh{!isAttendantServing && <span className="text-emerald-400"> · Şarjı Başlat</span>}</>
                    : vehicle.request.mode === 'MONEY'
                      ? `₺${vehicle.request.targetValue.toLocaleString('tr-TR')}`
                      : <>{vehicle.request.calculatedLiters.toFixed(0)}{serviceUnit} <span className="text-slate-500 font-normal">•</span> FULL</>}
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
