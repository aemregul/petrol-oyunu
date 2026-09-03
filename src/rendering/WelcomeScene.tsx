import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BuildingMesh } from './BuildingMesh';
import { PumpMesh } from './PumpMesh';
import { VehicleMesh } from './VehicleMesh';
import { SceneryProps } from './SceneryProps';
import { PriceTotem } from './PriceTotem';
import { GroundGrid } from './GroundGrid';
import { concreteTexture } from './concrete';
import { GAME_CONFIG } from '../config/gameConfig';
import { BuildingEntity, PumpEntity, VehicleEntity } from '../domain/types/gameState';
import { drivewayMouths, drivewayZ, priceSignPosition } from '../domain/services/simulationEngine';
import { useGameStore } from '../store/gameStore';

/**
 * Karşılama ekranının arka planı: oyunun KENDİ 3B sahnesi, gece.
 *
 * Elle çizilmiş SVG bir istasyon "Paint'te çizilmiş gibi" duruyordu (Emre,
 * 2026-09-03) — haklıydı. Burada aynı modeller, aynı malzemeler, aynı ölçüler
 * kullanılır: PumpMesh, BuildingMesh, VehicleMesh oyunda ne çiziyorsa onu
 * çizer. Fark yalnızca kurgudadır: sahne oyuncunun kaydına değil, elle
 * seçilmiş şirin bir yerleşime bakar ve kamera ağır ağır süzülür. Böylece
 * giriş ekranı her zaman aynı güzellikte açılır — kaydı bomboş olan yeni
 * oyuncuda da.
 *
 * Işık oyunun saat döngüsünden BAĞIMSIZ olarak gecedir: kaydındaki saat
 * öğlen olabilir, giriş ekranı yine de gece görünmelidir.
 */

/** Oyun ölçeği: bir grid birimi iki dünya birimi (mesh'ler de böyle çevirir). */
const S = 2;

/** Sahnenin baktığı nokta ve kameranın ondan uzaklığı, dünya biriminde. */
const FOCUS = new THREE.Vector3(12.5, 1, 11);
const ORBIT_RADIUS = 63;
const ORBIT_HEIGHT = 44;

function building(
  id: string,
  type: string,
  position: [number, number],
  rotation: 0 | 90 | 180 | 270 = 0,
  level = 1
): BuildingEntity {
  const catalog = GAME_CONFIG.buildings[type];
  return {
    id,
    type,
    level,
    position,
    // Sahnenin yerleşimi elle kurulmuştur: oyunun altyapı yerleştiricisi
    // (fiyat totemini kendi hesapladığı noktaya taşıyan kural) devreye
    // girmesin diye her şey "oyuncu taşımış" sayılır.
    movedByPlayer: true,
    rotation,
    size: (catalog?.size ?? [2, 2]) as [number, number],
    health: 100,
    constructionState: 'ACTIVE',
    builtAtTimestamp: 0
  } as BuildingEntity;
}

function pump(
  id: string,
  position: [number, number],
  rotation: 0 | 90 | 180 | 270,
  fuels: PumpEntity['supportedFuels'],
  hasCanopy = true
): PumpEntity {
  return {
    id,
    level: fuels.length,
    position,
    rotation,
    supportedFuels: fuels,
    state: 'IDLE',
    health: 100,
    employeeId: null,
    currentVehicleId: null,
    flowRateLps: 10,
    hasCanopy
  } as PumpEntity;
}

/** Duran araç: konumu grid'de, gövdesi VehicleMesh'in kendisi. */
function parkedCar(id: string, archetype: string, at: [number, number], heading: number): VehicleEntity {
  return {
    id,
    archetype,
    fuelType: 'gasoline',
    tankCapacity: 60,
    currentFuel: 30,
    request: {
      mode: 'FULL',
      targetValue: 30,
      calculatedLiters: 30,
      calculatedPrice: 0,
      dispensedLiters: 0,
      isFinished: false
    },
    patience: 60,
    maxPatience: 60,
    satisfaction: 100,
    state: 'QUEUE',
    targetPumpId: null,
    assignedActor: null,
    worldPosition: [at[0], 0, at[1]],
    targetWaypoint: null,
    route: [],
    heading,
    speed: 1,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  } as unknown as VehicleEntity;
}

/**
 * Elle seçilmiş yerleşim. Oyunun kendi düzenini izler — kanopili pompalar
 * ortada bir sıra, önalanın önünde fiyat totemi, arkada ofis ve market,
 * kenarlarda aydınlatma direkleri — ama kamera için sahnelenmiştir: siluetler
 * yatayda yayılır, orta üçüncü nispeten sakin kalır ki belge okunsun.
 */
/**
 * Yerleşim, kadraja göre kurulur: belge geniş ekranda sağa alındığı için
 * istasyonun görülmesi gereken her şeyi kadrajın SOL yarısına toplanır.
 * Kamera güneyden baktığından ekranın solu, ızgaranın yüksek x'idir.
 */
const PUMPS: PumpEntity[] = [
  pump('wp1', [5.5, 7], 90, ['gasoline']),
  pump('wp2', [8.5, 7], 90, ['gasoline', 'diesel']),
  pump('wp3', [11.5, 7], 90, ['gasoline', 'diesel', 'lpg'])
];

const BUILDINGS: BuildingEntity[] = [
  // Arka sıra: istasyonun yüzü.
  building('wb_office', 'office', [13, 12], 0, 2),
  building('wb_cafe', 'cafe', [8, 12.5], 0, 2),
  building('wb_market', 'mini_market', [3, 12], 0, 2),
  // Kadrajın açık yanı (yüksek x) baştan aşağı dolu: boş beton, kurulmamış
  // istasyon gibi duruyordu (Emre, 2026-09-03).
  building('wb_tank', 'tank_farm', [14.5, 8.5]),
  building('wb_park', 'car_park', [13, 3.5]),
  building('wb_lamp_r', 'light_pole', [15.5, 5.5]),
  // Belgenin arkasında kalan yan (düşük x): sahneyi tamamlar, kimse kaçırmaz.
  building('wb_charger', 'ev_charger_dc', [2.5, 6]),
  building('wb_air', 'air_water', [4, 3.5]),
  building('wb_lamp_l', 'light_pole', [0.6, 9]),
  building('wb_trash', 'trash_can', [5.5, 3.5])
];

const CARS: VehicleEntity[] = [
  // İki bayda da müşteri: gece bile işleyen bir istasyon, boş bir arsa değil.
  parkedCar('wc1', 'sedan', [8.5, 5.6], Math.PI / 2),
  parkedCar('wc2', 'suv', [11.5, 5.6], Math.PI / 2),
  parkedCar('wc6', 'hatchback', [5.5, 5.6], Math.PI / 2),
  // Şarj direğinde bekleyen elektrikli
  parkedCar('wc3', 'ev', [4, 6], 0),
  // Otoparkta bekleyen iki araç: sahayı yaşayan bir yer yapar
  parkedCar('wc4', 'hatchback', [12, 3.4], 0),
  parkedCar('wc5', 'sedan', [14, 3.4], 0)
];

/**
 * Rampa aydınlatması. Giriş/çıkış ağızları oyunun zemin katmanınca çizilir ama
 * gece koyu asfalt koyu çimin üstünde kayboluyordu — "rampa yok" (Emre,
 * 2026-09-03). Her ağzın üstüne bir ışık: rampalar gerçek bir istasyonda
 * olduğu gibi, uzaktan seçilir.
 */
const MouthLights: React.FC = () => {
  const plots = useGameStore((s) => s.gameState.station.plots);
  const buildings = useGameStore((s) => s.gameState.buildings);
  const mouths = drivewayMouths({ station: { plots }, buildings });
  const z = drivewayZ('near');

  return (
    <>
      {[mouths.entry.x, mouths.exit.x].map((x) => (
        <pointLight
          key={x}
          position={[x * S, 7, z * S]}
          intensity={110}
          distance={26}
          decay={1.6}
          color="#ffe6b8"
        />
      ))}
    </>
  );
};

/**
 * Fiyat totemi. Konumu ELLE verilmez: zemini çizen katman (GroundGrid) banket
 * çiçekliklerini tabelaya yer bırakarak ikiye ayırır ve o boşluğu oyunun kendi
 * kuralından hesaplar. Toteme burada başka bir yer uydurmak, tabelanın kendi
 * boşluğunun yanında durması demekti (Emre, 2026-09-03). İkisi artık aynı
 * kaynaktan besleniyor. Ad ise sabittir: bu ekran herkese aynı açılır.
 */
const WelcomeTotem: React.FC = () => {
  const plots = useGameStore((s) => s.gameState.station.plots);
  const roadLevel = useGameStore((s) => s.gameState.station.roadLevel);
  const buildings = useGameStore((s) => s.gameState.buildings);

  const sign = Object.values(buildings).find((b) => b.type === 'price_sign');
  const at =
    sign && sign.movedByPlayer
      ? sign.position
      : priceSignPosition({ station: { plots, roadLevel }, buildings });

  return (
    <group position={[at[0] * S, 0, at[1] * S]}>
      <PriceTotem level={sign?.level ?? 3} nameOverride="HIGHWAY" />
    </group>
  );
};

/** Yolda süzülen araç: gövde VehicleMesh, hareket sarmalayıcı grupta. */
const PassingCar: React.FC<{
  archetype: string;
  z: number;
  speed: number;
  offset: number;
  facing: 1 | -1;
}> = ({ archetype, z, speed, offset, facing }) => {
  const ref = useRef<THREE.Group>(null);
  const car = useMemo(
    () => parkedCar(`pass_${archetype}_${z}_${offset}`, archetype, [0, 0], facing > 0 ? Math.PI / 2 : -Math.PI / 2),
    [archetype, z, offset, facing]
  );

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const span = 120;
    const t = ((clock.elapsedTime * speed + offset) % span) / span;
    const x = facing > 0 ? -30 + t * span : 90 - t * span;
    ref.current.position.set(x, 0, z * S);
  });

  return (
    <group ref={ref}>
      <VehicleMesh vehicle={car} />
    </group>
  );
};

/**
 * Kamera: odak noktasının çevresinde çok yavaş bir yay çizer, tam tur atmaz.
 * Yükseklik bilerek fazladır — alçak açıda, yolun bu yakasındaki (kameranın
 * önünde kalan) aydınlatılmamış ağaçlar ve lamba direkleri kadraja kara
 * kütleler olarak giriyordu; yukarıdan bakınca onların üstünden aşıyoruz.
 */
const CameraRig: React.FC = () => {
  useFrame(({ camera, clock }) => {
    const sweep = Math.sin(clock.elapsedTime * 0.045) * 0.42 - Math.PI / 2;
    camera.position.set(
      FOCUS.x + Math.cos(sweep) * ORBIT_RADIUS,
      ORBIT_HEIGHT + Math.sin(clock.elapsedTime * 0.07) * 0.8,
      FOCUS.z + Math.sin(sweep) * ORBIT_RADIUS
    );
    camera.lookAt(FOCUS);
  });
  return null;
};

/**
 * Gece ışığı: mavi ay ışığı yukarıdan, kanopinin altına sıcak-beyaz havuz,
 * ofis ve marketin önüne ılık dolgu. Oyunun saat döngüsüne bakmaz.
 */
const NightLights: React.FC = () => (
  <>
    <ambientLight intensity={0.24} color="#8298cc" />
    <hemisphereLight args={['#222f4e', '#0b140f', 0.4]} />
    {/* Ay: gölgeleri veren yön ışığı */}
    <directionalLight
      position={[-40, 46, -18]}
      intensity={0.42}
      color="#93aada"
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-60}
      shadow-camera-right={60}
      shadow-camera-top={60}
      shadow-camera-bottom={-60}
      shadow-camera-far={160}
    />
    {/* Kanopi altı: sahnenin en parlak yeri */}
    {[5, 9, 13].map((x) => (
      <pointLight
        key={x}
        position={[x * S, 9, 7 * S]}
        intensity={140}
        distance={34}
        decay={1.6}
        color="#e8f4ff"
      />
    ))}
    {/* Ofis ve marketin cephesine ılık dolgu */}
    <pointLight position={[13.5 * S, 5, 9.5 * S]} intensity={90} distance={30} decay={1.7} color="#ffd7a0" />
    <pointLight position={[4 * S, 4.5, 9.5 * S]} intensity={70} distance={26} decay={1.7} color="#ffcf93" />
    {/* Totemin yüzünü aydınlatan ışık — totemle birlikte taşınır, yoksa
        tabela gecede kara bir levhaya döner. */}
    <pointLight position={[15 * S, 7, 0.2 * S]} intensity={95} distance={26} decay={1.7} color="#fff0cf" />
  </>
);

/**
 * Arka plan sahnesi. Tıklamaları yemez (pointer-events kapalı): giriş
 * belgesi her zaman önde ve etkileşimli kalır.
 */
export const WelcomeScene: React.FC = () => (
  <div className="absolute inset-0 pointer-events-none">
    <Canvas
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [16, ORBIT_HEIGHT, -15], fov: 34, near: 1, far: 600 }}
      gl={{ antialias: true, powerPreference: 'low-power' }}
    >
      <color attach="background" args={['#070c18']} />
      <fog attach="fog" args={['#0a1120', 60, 210]} />

      <CameraRig />
      <NightLights />

      <Suspense fallback={null}>
        {/* Zemin, yol, rampalar ve peyzaj: oyunun kendi katmanları. Elle
            çizilmiş bir asfalt yerine oyunda ne varsa o. */}
        <GroundGrid />
        <SceneryProps />

        {PUMPS.map((p) => (
          <PumpMesh key={p.id} pump={p} />
        ))}
        {BUILDINGS.map((b) => (
          <BuildingMesh key={b.id} building={b} />
        ))}
        {CARS.map((c) => (
          <VehicleMesh key={c.id} vehicle={c} />
        ))}

        <WelcomeTotem />
        <MouthLights />
        <PassingCar archetype="sedan" z={-3.7} speed={7} offset={0} facing={1} />
        <PassingCar archetype="suv" z={-2.3} speed={5.5} offset={64} facing={1} />
        <PassingCar archetype="hatchback" z={-3.7} speed={6.2} offset={110} facing={1} />
      </Suspense>
    </Canvas>
  </div>
);
