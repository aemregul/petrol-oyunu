import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BuildingMesh } from './BuildingMesh';
import { PumpMesh } from './PumpMesh';
import { VehicleMesh } from './VehicleMesh';
import { SceneryProps } from './SceneryProps';
import { PriceTotem } from './PriceTotem';
import { GroundGrid } from './GroundGrid';
import { LightPole } from './LightPole';
import { drivewayMouths, drivewayZ } from '../domain/services/simulationEngine';
import {
  WELCOME_CARS,
  WELCOME_GROUND,
  WELCOME_LAMPS,
  WELCOME_PLOT,
  WELCOME_PUMPS,
  WELCOME_ROAD_LEVEL,
  WELCOME_SIGN,
  WELCOME_STRUCTURES,
  stationScreenBand,
  welcomeCar
} from './welcomeLayout';

/**
 * Karşılama ekranının arka planı: oyunun KENDİ 3B sahnesi, gece.
 *
 * Elle çizilmiş SVG bir istasyon "Paint'te çizilmiş gibi" duruyordu (Emre,
 * 2026-09-03) — haklıydı. Burada aynı modeller, aynı malzemeler, aynı ölçüler
 * kullanılır: PumpMesh, BuildingMesh, VehicleMesh oyunda ne çiziyorsa onu
 * çizer. Fark yalnızca kurgudadır: sahne oyuncunun kaydına değil, elle
 * kurulmuş bir vitrin istasyona (welcomeLayout.ts) bakar ve kamera ağır ağır
 * süzülür. Böylece giriş ekranı her zaman aynı güzellikte açılır — kaydı
 * bomboş olan yeni oyuncuda da.
 *
 * Işık oyunun saat döngüsünden BAĞIMSIZ olarak gecedir: kaydındaki saat
 * öğlen olabilir, giriş ekranı yine de gece görünmelidir — lambalar dahil.
 */

/** Oyun ölçeği: bir grid birimi iki dünya birimi (mesh'ler de böyle çevirir). */
const S = 2;

/**
 * Ekranda kalması ŞART olan hacim, dünya biriminde: arsa, banket, iki rampa,
 * bu yakadaki şerit ve ofisin çatısına kadar yükseklik.
 */
const FRAME_BOX = { minX: -3, maxX: 35, minY: 0, maxY: 9, minZ: -11, maxZ: 28 };

/** Kameranın baktığı nokta — arsanın ortası — ve bakış yüksekliği (radyan). */
const FOCUS = new THREE.Vector3(16, 0, 10);
const ELEVATION = 0.6;
/**
 * Bakış açısı: güneyin biraz doğusundan, dar bir salınımla. Fiyat totemi
 * oyunda yola DİK durur (yüzü trafiğe bakar), tam güneyden bakınca yalnız
 * kenarı görünüyordu; doğuya kayınca "HIGHWAY" ve fiyatlar okunur.
 */
const SWEEP_CENTRE = -Math.PI / 2 + 0.3;
const SWEEP_AMPLITUDE = 0.12;
/** Kadraj ölçümünün yapıldığı deneme uzaklığı; asıl uzaklık buradan çözülür. */
const PROBE_DISTANCE = 80;

/**
 * Kamera: kadrajı EKRANA göre kurar, ekranı sahneye göre değil.
 *
 * Belge geniş ekranda sağdadır ve istasyonun tamamı — giriş rampası dahil —
 * onun solunda kalmalıdır. Sabit bir kamera bunu tek bir ekran oranında
 * tutturur; başka oranda ya rampa belgenin altına girer ya arsanın solunda
 * boş çim kalır (Emre, 2026-09-03: ikisi de oldu). Bu yüzden her karede:
 * çerçeve hacminin sekiz köşesi izdüşürülür, istasyonun ekranda kaplayacağı
 * bant (stationScreenBand) için uzaklık çözülür ve görüntü, bandın ortasına
 * bir görüş kaydırmasıyla (setViewOffset) yerleştirilir. Kaydırma bir
 * lens-shift'tir: perspektifi bozmaz, sadece kadrajı kaydırır.
 *
 * Kamera odak noktasının çevresinde çok yavaş bir yay çizer, tam tur atmaz.
 * Yükseklik bilerek fazladır — alçak açıda, yolun bu yakasındaki
 * aydınlatılmamış ağaçlar kadraja kara kütleler olarak giriyordu.
 */
const FramedOrbit: React.FC = () => {
  const size = useThree((s) => s.size);
  const probe = useMemo(() => new THREE.PerspectiveCamera(), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const corners = useMemo(() => {
    const b = FRAME_BOX;
    const out: THREE.Vector3[] = [];
    for (const x of [b.minX, b.maxX])
      for (const y of [b.minY, b.maxY])
        for (const z of [b.minZ, b.maxZ]) out.push(new THREE.Vector3(x, y, z));
    return out;
  }, []);

  useFrame(({ camera, clock }) => {
    const cam = camera as THREE.PerspectiveCamera;
    const sweep = SWEEP_CENTRE + Math.sin(clock.elapsedTime * 0.045) * SWEEP_AMPLITUDE;
    direction.set(
      Math.cos(sweep) * Math.cos(ELEVATION),
      Math.sin(ELEVATION),
      Math.sin(sweep) * Math.cos(ELEVATION)
    );

    probe.fov = cam.fov;
    probe.aspect = size.width / size.height;
    probe.near = cam.near;
    probe.far = cam.far;
    probe.updateProjectionMatrix();

    /** Çerçeve köşelerinin, verilen uzaklıktan, NDC'deki kapladığı dikdörtgen. */
    const measure = (distance: number) => {
      probe.position.copy(FOCUS).addScaledVector(direction, distance);
      probe.lookAt(FOCUS);
      probe.updateMatrixWorld();
      const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      for (const corner of corners) {
        scratch.copy(corner).project(probe);
        box.minX = Math.min(box.minX, scratch.x);
        box.maxX = Math.max(box.maxX, scratch.x);
        box.minY = Math.min(box.minY, scratch.y);
        box.maxY = Math.max(box.maxY, scratch.y);
      }
      return box;
    };
    const widthOf = (box: ReturnType<typeof measure>) => (box.maxX - box.minX) / 2;
    const heightOf = (box: ReturnType<typeof measure>) => (box.maxY - box.minY) / 2;

    const [bandLeft, bandRight] = stationScreenBand(size.width);
    const bandWidth = bandRight - bandLeft;

    // İzdüşüm genişliği uzaklıkla yaklaşık ters orantılı: bir kez çöz, bir
    // kez düzelt. Dikeyde taşarsa (çok dar bant, çok yüksek ekran) geri çekil.
    let distance = (PROBE_DISTANCE * widthOf(measure(PROBE_DISTANCE))) / bandWidth;
    distance *= widthOf(measure(distance)) / bandWidth;
    let box = measure(distance);
    const maxHeight = 0.92;
    if (heightOf(box) > maxHeight) {
      distance *= heightOf(box) / maxHeight;
      box = measure(distance);
    }

    // Kutunun ekrandaki merkezi (soldan/üstten oran) ve gitmesi gereken yer.
    const centreX = ((box.minX + box.maxX) / 2 + 1) / 2;
    const centreY = (1 - (box.minY + box.maxY) / 2) / 2;
    const wantX = (bandLeft + bandRight) / 2;
    const wantY = 0.5;

    cam.position.copy(probe.position);
    cam.lookAt(FOCUS);
    cam.setViewOffset(
      size.width,
      size.height,
      (centreX - wantX) * size.width,
      (centreY - wantY) * size.height,
      size.width,
      size.height
    );
  });

  return null;
};

/**
 * Rampa aydınlatması. Giriş/çıkış ağızları oyunun zemin katmanınca çizilir ama
 * gece koyu asfalt koyu çimin üstünde kayboluyordu — "rampa yok" (Emre,
 * 2026-09-03). Her ağzın üstüne bir ışık: rampalar gerçek bir istasyonda
 * olduğu gibi, uzaktan seçilir.
 */
const MouthLights: React.FC = () => {
  const mouths = drivewayMouths(
    { station: { plots: WELCOME_PLOT }, buildings: WELCOME_GROUND.buildings },
    'near'
  );
  const z = drivewayZ('near') * S;

  return (
    <>
      {[mouths.entry.x, mouths.exit.x].map((x) => (
        <pointLight
          key={x}
          position={[x * S, 7, z]}
          intensity={90}
          distance={26}
          decay={1.6}
          color="#ffe6b8"
        />
      ))}
    </>
  );
};

/**
 * Fiyat totemi. Konumu ELLE verilmez: yerleşim onu oyunun kendi kuralından
 * (iki ağzın ortası) alır ve zemin katmanı banket çiçekliklerini aynı noktaya
 * göre ikiye ayırır — totem kendi boşluğunun yanında duramaz (Emre,
 * 2026-09-03). Ad sabittir: bu ekran herkese aynı açılır.
 */
const WelcomeTotem: React.FC = () => (
  <group position={[WELCOME_SIGN.position[0] * S, 0, WELCOME_SIGN.position[1] * S]}>
    <PriceTotem level={WELCOME_SIGN.level} nameOverride="HIGHWAY" />
  </group>
);

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
    () =>
      welcomeCar(
        `pass_${archetype}_${z}_${offset}`,
        archetype,
        [0, 0],
        facing > 0 ? Math.PI / 2 : -Math.PI / 2
      ),
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
 * Gece ışığı: mavi ay ışığı yukarıdan, kanopilerin altına soğuk-beyaz havuz,
 * cephelere ılık dolgu, totemin yüzüne ışık. Konumlar yerleşimden okunur;
 * bir pompa taşınırsa ışığı da taşınır.
 */
const NightLights: React.FC = () => {
  const office = WELCOME_STRUCTURES.find((b) => b.type === 'office')!;
  const market = WELCOME_STRUCTURES.find((b) => b.type === 'mini_market')!;
  const cafe = WELCOME_STRUCTURES.find((b) => b.type === 'cafe')!;
  // Cephe önü: yapının ön kenarından bir hücre önde.
  const facade = (b: typeof office, y: number): [number, number, number] => [
    b.position[0] * S,
    y,
    (b.position[1] - b.size[1] / 2 - 1) * S
  ];

  return (
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
      {/* Pompa adaları: sundurma yok, adanın kendi ışığı — alçak ve ölçülü,
          yoksa arkadaki cepheleri de yıkar. */}
      {WELCOME_PUMPS.map((p) => (
        <pointLight
          key={p.id}
          position={[p.position[0] * S, 5.5, p.position[1] * S]}
          intensity={70}
          distance={24}
          decay={1.7}
          color="#e8f4ff"
        />
      ))}
      {/* Cephelere ılık dolgu */}
      <pointLight position={facade(office, 5)} intensity={90} distance={30} decay={1.7} color="#ffd7a0" />
      <pointLight position={facade(market, 4.5)} intensity={70} distance={26} decay={1.7} color="#ffcf93" />
      <pointLight position={facade(cafe, 4)} intensity={45} distance={20} decay={1.7} color="#ffe0b8" />
      {/* Totemin yola dönük yüzüne ışık — totemle birlikte taşınır, yoksa
          tabela gecede kara bir levhaya döner. Uzaktan ve ölçülü: iki adım
          önüne konan 95'lik ışık yüzü bembeyaz yakıyordu, fiyatlar okunmuyordu. */}
      <pointLight
        position={[WELCOME_SIGN.position[0] * S + 3, 7, WELCOME_SIGN.position[1] * S - 11]}
        intensity={40}
        distance={30}
        decay={1.6}
        color="#fff0cf"
      />
    </>
  );
};

/**
 * Arka plan sahnesi. Tıklamaları yemez (pointer-events kapalı): giriş
 * belgesi her zaman önde ve etkileşimli kalır.
 */
export const WelcomeScene: React.FC = () => (
  <div className="absolute inset-0 pointer-events-none">
    <Canvas
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [16, 50, -60], fov: 34, near: 1, far: 600 }}
      gl={{ antialias: true, powerPreference: 'low-power' }}
    >
      <color attach="background" args={['#070c18']} />
      <fog attach="fog" args={['#0a1120', 60, 210]} />

      <FramedOrbit />
      <NightLights />

      <Suspense fallback={null}>
        {/* Zemin, yol, rampalar ve peyzaj: oyunun kendi katmanları, vitrin
            arsasına bakar — oyuncunun kaydına değil. */}
        <GroundGrid scene={WELCOME_GROUND} />
        <SceneryProps scene={{ plots: WELCOME_PLOT, roadLevel: WELCOME_ROAD_LEVEL, lit: true }} />

        {WELCOME_PUMPS.map((p) => (
          <PumpMesh key={p.id} pump={p} neighbours={WELCOME_PUMPS} />
        ))}
        {WELCOME_STRUCTURES.map((b) => (
          <BuildingMesh key={b.id} building={b} />
        ))}
        {/* Lambalar oyun saatine bakmadan yanar: gece sahnesi, gece lambası. */}
        {WELCOME_LAMPS.map((lamp) => (
          <group
            key={lamp.id}
            position={[lamp.position[0] * S, 0, lamp.position[1] * S]}
            rotation={[0, (lamp.rotation * Math.PI) / 180, 0]}
          >
            <LightPole lit />
          </group>
        ))}
        {WELCOME_CARS.map((c) => (
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
