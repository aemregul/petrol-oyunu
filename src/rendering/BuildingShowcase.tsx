import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, PerspectiveCamera } from '@react-three/drei';
import { BuildingEntity, PumpEntity, PumpState } from '../domain/types/gameState';
import { GAME_CONFIG } from '../config/gameConfig';
import { BuildingMesh } from './BuildingMesh';
import { PumpMesh } from './PumpMesh';

/**
 * Every buildable item laid out side by side, opened with ?showcase=buildings.
 *
 * It renders the real in-game components rather than copies, so what is shown
 * here is exactly what appears on the forecourt.
 */

/**
 * Cell spacing. Rows are set further apart than columns because the camera
 * looks down at an angle: a tall item would otherwise cover the row behind it.
 */
const CELL_X = 20;
const CELL_Z = 24;
// Wider than deep suits a landscape frame and keeps depth compression low.
const COLUMNS = 6;

interface Entry {
  label: string;
  building?: Omit<BuildingEntity, 'id' | 'position'> & { position?: [number, number] };
  pump?: Omit<PumpEntity, 'id' | 'position'>;
}

function buildingOf(
  type: string,
  level = 1,
  health = 100
): Entry['building'] {
  const catalog = GAME_CONFIG.buildings[type];
  return {
    type,
    level,
    rotation: 0,
    size: catalog ? catalog.size : [2, 2],
    health,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0
  };
}

function pumpOf(
  level: number,
  fuels: PumpEntity['supportedFuels'],
  state: PumpState = 'IDLE',
  health = 100
): Entry['pump'] {
  return {
    level,
    rotation: 0,
    supportedFuels: fuels,
    state,
    health,
    employeeId: null,
    currentVehicleId: null,
    flowRateLps: level >= 3 ? 13 : level >= 2 ? 10 : 8
  };
}

// Ordered smallest-to-largest front to back, so nothing hides what is behind it.
const ENTRIES: Entry[] = [
  { label: 'Pompa S1', pump: pumpOf(1, ['gasoline']) },
  { label: 'Pompa S2', pump: pumpOf(2, ['gasoline', 'diesel']) },
  { label: 'Pompa S3', pump: pumpOf(3, ['gasoline', 'diesel', 'lpg']) },
  { label: 'Pompa — yıpranmış', pump: pumpOf(2, ['gasoline', 'diesel'], 'IDLE', 25) },
  { label: 'Pompa — arızalı', pump: pumpOf(1, ['gasoline'], 'BROKEN', 0) },
  { label: 'AC Şarj Ünitesi', building: buildingOf('ev_charger_ac') },

  { label: 'Fiyat Totemi S1', building: buildingOf('price_sign', 1) },
  { label: 'Fiyat Totemi S2', building: buildingOf('price_sign', 2) },
  { label: 'Fiyat Totemi S3', building: buildingOf('price_sign', 3) },
  { label: 'DC Hızlı Şarj', building: buildingOf('ev_charger_dc') },
  { label: 'Aydınlatma Direği', building: buildingOf('light_pole') },
  { label: 'Çöp Konteyneri', building: buildingOf('trash_can') },

  { label: 'Benzin Tankı', building: buildingOf('tank_gasoline') },
  { label: 'Dizel Tankı', building: buildingOf('tank_diesel') },
  { label: 'LPG Tankı', building: buildingOf('tank_lpg') },
  { label: 'Hava & Su', building: buildingOf('air_water') },
  { label: 'Peyzaj & Dekorasyon', building: buildingOf('decoration') },
  { label: 'Müşteri WC', building: buildingOf('toilet') },

  { label: 'Elektrik Altyapısı', building: buildingOf('ev_substation') },
  { label: 'Enerji Depolama', building: buildingOf('ev_storage') },
  { label: 'Kahveci', building: buildingOf('cafe') },
  { label: 'Lastik Servisi', building: buildingOf('tyre_service') },
  { label: 'Yağ Değişimi', building: buildingOf('oil_change') },

  { label: 'Geniş Giriş Rampası', building: buildingOf('wide_entry') },
  { label: 'Otopark', building: buildingOf('car_park') },
  { label: 'Oto Yıkama', building: buildingOf('car_wash') },
  { label: 'Yönetim Ofisi', building: buildingOf('office', 2) },
  { label: 'Mini Market', building: buildingOf('mini_market', 2) },
  { label: 'Restoran', building: buildingOf('restaurant') },

  { label: 'Geniş Çıkış Rampası', building: buildingOf('wide_exit') },
  { label: 'TIR Parkı', building: buildingOf('truck_park') },
  { label: 'Yol Oteli', building: buildingOf('hotel') },
  { label: 'Dinlenme Tesisi', building: buildingOf('rest_complex') }
];

const ROWS = Math.ceil(ENTRIES.length / COLUMNS);

export const BuildingShowcase: React.FC = () => (
  <div className="w-screen h-screen bg-slate-900">
    <Canvas shadows dpr={[1, 2]}>
      <PerspectiveCamera
        makeDefault
        fov={40}
        position={[0, 120, 146]}
        onUpdate={(c) => c.lookAt(0, 0, 2)}
      />
      <color attach="background" args={['#1b2532']} />

      <ambientLight intensity={0.75} />
      <directionalLight
        position={[40, 60, 35]}
        intensity={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={150}
        shadow-camera-bottom={-150}
        shadow-camera-far={340}
      />
      <hemisphereLight groundColor="#2b333f" intensity={0.5} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#39424f" roughness={0.8} />
      </mesh>

      <Suspense fallback={null}>
        {ENTRIES.map((entry, i) => {
          const col = i % COLUMNS;
          const row = Math.floor(i / COLUMNS);
          // Centre the grid on the origin so the camera framing stays simple.
          const worldX = (col - (COLUMNS - 1) / 2) * CELL_X;
          const worldZ = (row - (ROWS - 1) / 2) * CELL_Z;

          return (
            <group key={entry.label}>
              {/* BuildingMesh and PumpMesh place themselves at position * 2. */}
              {entry.building && (
                <BuildingMesh
                  building={{
                    ...entry.building,
                    id: `showcase_${i}`,
                    position: [worldX / 2, worldZ / 2]
                  } as BuildingEntity}
                />
              )}
              {entry.pump && (
                <PumpMesh
                  pump={{
                    ...entry.pump,
                    id: `showcase_pump_${i}`,
                    position: [worldX / 2, worldZ / 2]
                  } as PumpEntity}
                />
              )}

              {/* Label sits just in front of its own cell so the pairing is clear. */}
              <Html position={[worldX, 0.3, worldZ + CELL_Z / 2 - 4.5]} center distanceFactor={74}>
                <div className="text-[13px] font-bold text-white whitespace-nowrap bg-slate-950/90 border border-slate-700 px-2.5 py-1 rounded">
                  {entry.label}
                </div>
              </Html>
            </group>
          );
        })}
      </Suspense>
    </Canvas>
  </div>
);
