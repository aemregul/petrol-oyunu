import React, { useState, useMemo, Suspense } from 'react';
import { BuildingEntity } from '../domain/types/gameState';
import { useGameStore } from '../store/gameStore';
import { BuildingModel } from './models/BuildingModel';
import { hasBuildingModel } from './models/buildingModels';
import { ModelErrorBoundary } from './models/ModelErrorBoundary';
import { PriceTotem } from './PriceTotem';
import { LightPole } from './LightPole';
import { FasciaSign } from './FasciaSign';
import { DECAL } from './decal';
import { PylonSign } from './PylonSign';
import { priceSignPosition } from '../domain/services/simulationEngine';
import {
  CarPark,
  TruckPark,
  CarWash,
  OilChange,
  TyreService,
  AirWater,
  EnergyStorage,
  EvCharger,
  Decoration,
  WideEntry,
  WideExit,
  EvSubstation,
  Restaurant,
  RestComplex
} from './FacilityMeshes';

/** Facilities drawn by hand rather than loaded from an asset kit. */
const CUSTOM_FACILITIES: Record<string, React.FC<{ building: BuildingEntity }>> = {
  car_park: CarPark,
  truck_park: TruckPark,
  car_wash: CarWash,
  oil_change: OilChange,
  tyre_service: TyreService,
  air_water: AirWater,
  ev_storage: EnergyStorage,
  ev_charger_ac: (props) => <EvCharger {...props} />,
  ev_charger_dc: (props) => <EvCharger {...props} fast />,
  decoration: Decoration,
  wide_entry: WideEntry,
  wide_exit: WideExit,
  ev_substation: EvSubstation,
  restaurant: Restaurant,
  rest_complex: RestComplex
};

interface BuildingMeshProps {
  building: BuildingEntity;
}

/**
 * Blocky stand-in used while a model loads, if one fails to load, and for the
 * pieces the asset kits do not cover.
 */
const FallbackGeometry: React.FC<{ building: BuildingEntity }> = ({ building }) => {
  const [width, depth] = building.size;
  const w = width * 2;
  const d = depth * 2;

  switch (building.type) {
    case 'light_pole':
      return (
        <mesh position={[0, 3.5, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.12, 7, 10]} />
          <meshStandardMaterial color="#64748b" metalness={0.4} />
        </mesh>
      );
    case 'trash_can':
      return (
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.25, 1, 12]} />
          <meshStandardMaterial color="#059669" />
        </mesh>
      );
    default:
      return (
        <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[w * 0.8, 3.2, d * 0.8]} />
          <meshStandardMaterial color="#334155" roughness={0.7} />
        </mesh>
      );
  }
};

/**
 * The station's storage, drawn as what it is.
 *
 * The tank farm is three above-ground silos on one pad — petrol, diesel and
 * LPG side by side, each in its fuel's colour, all three growing together
 * when the farm is upgraded. The expansion is the big horizontal cistern
 * that doubles the lot. Both are readable from across the plot, which the
 * old buried-lid version never was.
 */
const TankFixtures: React.FC<{ building: BuildingEntity }> = ({ building }) => {
  const w = building.size[0] * 2;
  const d = building.size[1] * 2;
  const level = Math.min(3, Math.max(1, building.level));

  if (building.type === 'tank_expansion') {
    return (
      <group>
        <mesh position={[0, 0.06, 0]} receiveShadow>
          <boxGeometry args={[w * 0.9, 0.12, d * 0.85]} />
          <meshStandardMaterial color="#7c8798" roughness={0.9} />
        </mesh>

        {/* Saddles carrying the cistern */}
        {[-w * 0.28, w * 0.28].map((x) => (
          <mesh key={x} position={[x, 0.5, 0]} castShadow>
            <boxGeometry args={[0.5, 0.9, d * 0.5]} />
            <meshStandardMaterial color="#475569" roughness={0.7} metalness={0.3} />
          </mesh>
        ))}

        {/* The cistern itself, steel with three fuel-coloured hoops */}
        <mesh position={[0, 1.9, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[1.35, 1.35, w * 0.82, 20]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.3} />
        </mesh>
        {[
          [-w * 0.24, '#22c55e'],
          [0, '#f97316'],
          [w * 0.24, '#3b82f6']
        ].map(([x, color]) => (
          <mesh
            key={String(x)}
            position={[x as number, 1.9, 0]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[1.39, 1.39, 0.3, 20]} />
            <meshStandardMaterial color={color as string} roughness={0.45} metalness={0.25} />
          </mesh>
        ))}

        {/* Top walkway and hatch */}
        <mesh position={[0, 3.35, 0]} castShadow>
          <boxGeometry args={[w * 0.6, 0.08, 0.7]} />
          <meshStandardMaterial color="#64748b" metalness={0.5} roughness={0.5} />
        </mesh>
        <mesh position={[w * 0.1, 3.5, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.28, 0.24, 12]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
    );
  }

  // The farm: one silo per fuel, abreast, facing the road — the same order
  // the tanker berths use, so each lorry stops in front of its own silo.
  const SILOS: Array<{ x: number; color: string }> = [
    { x: -w * 0.28, color: '#22c55e' },
    { x: 0, color: '#f97316' },
    { x: w * 0.28, color: '#3b82f6' }
  ];
  const radius = [0.75, 0.85, 0.95][level - 1];
  const height = [2.2, 2.9, 3.6][level - 1];

  return (
    <group>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[w * 0.9, 0.12, d * 0.85]} />
        <meshStandardMaterial color="#7c8798" roughness={0.9} />
      </mesh>

      {SILOS.map(({ x, color }) => (
        <group key={x} position={[x, 0, -d * 0.1]}>
          <mesh position={[0, 0.12 + height / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[radius, radius, height, 18]} />
            <meshStandardMaterial color={color} roughness={0.45} metalness={0.25} />
          </mesh>
          {[0.4, height - 0.3].map((y) => (
            <mesh key={y} position={[0, 0.12 + y, 0]}>
              <cylinderGeometry args={[radius + 0.03, radius + 0.03, 0.14, 18]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.3} />
            </mesh>
          ))}
          <mesh position={[0, 0.12 + height, 0]} castShadow>
            <sphereGeometry args={[radius, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.12 + height + radius * 0.55 + 0.35, 0]} castShadow>
            <cylinderGeometry args={[0.04, 0.05, 0.8, 8]} />
            <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.4} />
          </mesh>

          {/* Filler cap at the silo's own berth, where its lorry hoses in */}
          <group position={[0, 0.12, d * 0.38]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.26, 0.3, 0.2, 14]} />
              <meshStandardMaterial color="#4b5563" metalness={0.7} roughness={0.4} />
            </mesh>
            <mesh position={[0, 0.11, 0]}>
              <cylinderGeometry args={[0.18, 0.18, 0.05, 14]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={0.25}
                toneMapped={false}
              />
            </mesh>
          </group>

          {/* Feed pipe from silo down toward its cap */}
          <mesh position={[0, 0.5, d * 0.16]} rotation={[Math.PI / 4, 0, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.07, 1.1, 8]} />
            <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      ))}

      {/* At Sv3: the level-gauge cabinet keeping watch over all three */}
      {level >= 3 && (
        <group position={[w * 0.42, 0, -d * 0.3]}>
          <mesh position={[0, 0.7, 0]} castShadow>
            <boxGeometry args={[0.5, 1.4, 0.35]} />
            <meshStandardMaterial color="#334155" roughness={0.55} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.98, 0.19]}>
            <planeGeometry args={[0.36, 0.36]} />
            <meshStandardMaterial
              color="#22d3ee"
              emissive="#22d3ee"
              emissiveIntensity={0.8}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
};

/**
 * `height` is where the board hangs, in world units — only for the hand-built
 * meshes, whose height is known here. A type with a model measures its own.
 *
 * Not everything gets a board. A bay of batteries, a substation, a marked-out
 * lorry park: these read as what they are from their own shape, and a name
 * plate over each one turns the forecourt into a wall of labels.
 */
const SIGNAGE: Record<
  string,
  { text: string; height?: number; color: string; textColor: string }
> = {
  office: { text: 'YÖNETİM OFİSİ', color: '#0f172a', textColor: '#ffffff' },
  mini_market: { text: 'MİNİ MARKET', color: '#d97706', textColor: '#ffffff' },
  toilet: { text: 'WC 🚻', color: '#0f172a', textColor: '#ffffff' },
  restaurant: { text: 'RESTORAN', height: 7.4, color: '#dc2626', textColor: '#ffffff' },
  cafe: { text: 'KAHVE', color: '#b45309', textColor: '#ffffff' },
  rest_complex: { text: 'DİNLENME TESİSİ', height: 8.2, color: '#0284c7', textColor: '#ffffff' },
  car_wash: { text: 'OTO YIKAMA', height: 3.5, color: '#0284c7', textColor: '#ffffff' },
  oil_change: { text: 'YAĞ DEĞİŞİMİ', height: 5.4, color: '#d97706', textColor: '#ffffff' },
  tyre_service: { text: 'LASTİK SERVİSİ', height: 5.4, color: '#0369a1', textColor: '#ffffff' },
  air_water: { text: 'HAVA & SU', height: 3.4, color: '#0f172a', textColor: '#ffffff' },
  hotel: { text: 'OTEL', color: '#4f46e5', textColor: '#ffffff' },
  ev_charger_ac: { text: 'AC ŞARJ', height: 3, color: '#059669', textColor: '#ffffff' },
  ev_charger_dc: { text: 'DC HIZLI ŞARJ', height: 3.4, color: '#ea580c', textColor: '#ffffff' }
};

export const BuildingMesh: React.FC<BuildingMeshProps> = ({ building }) => {
  const [hovered, setHovered] = useState(false);
  const selectedBuildingId = useGameStore((s) => s.selectedBuildingId);
  const selectBuilding = useGameStore((s) => s.selectBuilding);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const editMode = useGameStore((s) => s.editMode);
  const placing = useGameStore((s) => s.buildMode.active);
  const relocateStructure = useGameStore((s) => s.relocateStructure);

  const isSelected = selectedBuildingId === building.id;
  // Only while rearranging is a structure something to pick up.
  const editable = editMode && !placing;

  // The price board's place is decided by the layout, not by where it happens
  // to be stored — so it is read straight from there and can never be seen
  // lagging behind a mouth that has just moved.
  const plots = useGameStore((s) => s.gameState.station.plots);
  const roadLevel = useGameStore((s) => s.gameState.station.roadLevel);
  const allBuildings = useGameStore((s) => s.gameState.buildings);

  const anchored = useMemo(
    () =>
      building.type === 'price_sign' && !building.movedByPlayer
        ? priceSignPosition({ station: { plots, roadLevel }, buildings: allBuildings })
        : building.position,
    [building.type, building.position, building.movedByPlayer, plots, roadLevel, allBuildings]
  );

  const posX = anchored[0] * 2;
  const posZ = anchored[1] * 2;

  const handleClick = (e: any) => {
    e.stopPropagation();

    // In edit mode a click lifts the structure straight into placement rather
    // than opening whatever panel it owns.
    if (editable) {
      relocateStructure(building.id);
      return;
    }

    selectBuilding(building.id);
    if (building.type === 'office') setActiveModal('OFFICE');
    else if (building.type === 'price_sign') setActiveModal('PRICING');
    else if (building.type === 'pylon_sign') setActiveModal('SETTINGS');
  };

  const signage = SIGNAGE[building.type];
  const ringRadius = Math.max(building.size[0], building.size[1]) + 0.4;

  const CustomFacility = CUSTOM_FACILITIES[building.type];

  const body = CustomFacility ? (
    <CustomFacility building={building} />
  ) : hasBuildingModel(building.type) ? (
    <ModelErrorBoundary fallback={<FallbackGeometry building={building} />}>
      <Suspense fallback={<FallbackGeometry building={building} />}>
        <BuildingModel type={building.type} footprint={building.size} sign={signage} />
      </Suspense>
    </ModelErrorBoundary>
  ) : building.type === 'pylon_sign' ? (
    <PylonSign />
  ) : building.type === 'price_sign' ? (
    <PriceTotem level={building.level} />
  ) : building.type === 'light_pole' ? (
    <LightPole />
  ) : building.type.startsWith('tank_') ? (
    <TankFixtures building={building} />
  ) : (
    <FallbackGeometry building={building} />
  );

  return (
    <group
      position={[posX, 0, posZ]}
      rotation={[0, (building.rotation * Math.PI) / 180, 0]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {body}

      {/* Models carry their own board, hung from the geometry they actually
          have. Everything else is hand-built to a known height, so the board
          goes straight on top of it. */}
      {signage?.height !== undefined && (
        <FasciaSign
          text={signage.text}
          color={signage.color}
          textColor={signage.textColor}
          width={Math.max(2.2, building.size[0] * 2 * 0.78)}
          y={signage.height}
        />
      )}

      {/* Only while rearranging does a structure show that it can be picked
          up, and it shows it as the ground it stands on rather than as a ring
          floating around it. Outside that mode the forecourt is left alone. */}
      {editable && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[building.size[0] * 2, building.size[1] * 2]} />
          <meshBasicMaterial
            color={hovered ? '#38bdf8' : '#e2e8f0'}
            opacity={hovered ? 0.42 : 0.15}
            transparent
            depthWrite={false}
            {...DECAL}
          />
        </mesh>
      )}
    </group>
  );
};
