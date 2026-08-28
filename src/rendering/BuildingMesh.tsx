import React, { useState, useMemo, Suspense } from 'react';
import { BuildingEntity } from '../domain/types/gameState';
import { useGameStore } from '../store/gameStore';
import { BuildingModel } from './models/BuildingModel';
import { hasBuildingModel } from './models/buildingModels';
import { ModelErrorBoundary } from './models/ModelErrorBoundary';
import { PriceTotem } from './PriceTotem';
import { LightPole } from './LightPole';
import { FasciaSign } from './FasciaSign';
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

/** The island roof: hand-built, since no CC0 kit ships a forecourt canopy. */
const Canopy: React.FC<{ building: BuildingEntity }> = ({ building }) => {
  const w = building.size[0] * 2;
  const d = building.size[1] * 2;
  const height = 6.2;
  const pillarX = w / 2 - 1;
  const pillarZ = d / 2 - 1;

  return (
    <group>
      {[
        [-pillarX, -pillarZ],
        [pillarX, -pillarZ],
        [-pillarX, pillarZ],
        [pillarX, pillarZ]
      ].map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, height / 2, z]} castShadow>
          <cylinderGeometry args={[0.22, 0.26, height, 12]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.35} roughness={0.5} />
        </mesh>
      ))}

      {/* Roof slab with a coloured fascia band around all four sides */}
      <mesh position={[0, height + 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.5, d]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.65} metalness={0.15} />
      </mesh>
      <mesh position={[0, height + 0.05, 0]}>
        <boxGeometry args={[w + 0.25, 0.42, d + 0.25]} />
        <meshStandardMaterial
          color="#0284c7"
          emissive="#0284c7"
          emissiveIntensity={0.45}
          toneMapped={false}
        />
      </mesh>

      {/* Recessed downlights so the island reads as lit from above */}
      {[-w / 4, w / 4].map((x) =>
        [-d / 4, d / 4].map((z) => (
          <mesh key={`${x}_${z}`} position={[x, height - 0.16, z]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.42, 12]} />
            <meshStandardMaterial
              color="#fff8e1"
              emissive="#ffedb8"
              emissiveIntensity={1.6}
              toneMapped={false}
            />
          </mesh>
        ))
      )}
    </group>
  );
};

/**
 * Surface fittings for a buried fuel tank: the concrete lid, its filler caps
 * and the vent stack. The tank itself is underground, so this is all the
 * player ever sees of it.
 */
const TankFixtures: React.FC<{ building: BuildingEntity }> = ({ building }) => {
  const TANK_ACCENTS: Record<string, string> = {
    tank_gasoline: '#22c55e',
    tank_diesel: '#f97316',
    tank_lpg: '#3b82f6'
  };
  const accent = TANK_ACCENTS[building.type] || '#94a3b8';
  const w = building.size[0] * 2;
  const d = building.size[1] * 2;

  return (
    <group>
      {/* Concrete access slab, sunk almost flush with the apron */}
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[w * 0.85, 0.12, d * 0.85]} />
        <meshStandardMaterial color="#7c8798" roughness={0.9} />
      </mesh>

      {/* Painted border in the fuel's colour so the grade is obvious */}
      <mesh position={[0, 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[w * 0.36, w * 0.42, 4]} />
        <meshBasicMaterial color={accent} transparent opacity={0.75} />
      </mesh>

      {/* Two filler caps */}
      {[-w * 0.18, w * 0.18].map((x) => (
        <group key={x} position={[x, 0.12, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.42, 0.46, 0.22, 16]} />
            <meshStandardMaterial color="#4b5563" metalness={0.7} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.13, 0]}>
            <cylinderGeometry args={[0.3, 0.3, 0.06, 16]} />
            <meshStandardMaterial
              color={accent}
              emissive={accent}
              emissiveIntensity={0.25}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      {/* Vent stack at the back corner */}
      <group position={[w * 0.34, 0, -d * 0.32]}>
        <mesh position={[0, 1.5, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.13, 3, 10]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.5} />
        </mesh>
        <mesh position={[0, 3.05, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.11, 0.11, 0.5, 10]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.5} />
        </mesh>
      </group>
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
  ) : building.type === 'canopy' ? (
    <Canopy building={building} />
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
          />
        </mesh>
      )}
    </group>
  );
};
