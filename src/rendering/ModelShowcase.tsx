import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF, Html, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

/**
 * A side-by-side lineup of candidate models, opened with ?showcase=1.
 * Development aid for choosing art assets, not part of the game itself.
 */

const CANDIDATES = [
  { file: 'sedan', label: 'sedan → İşe Giden' },
  { file: 'suv', label: 'suv → Aile' },
  { file: 'taxi', label: 'taxi → Taksi' },
  { file: 'van', label: 'van → Kurye' },
  { file: 'delivery', label: 'delivery → Ticari' },
  { file: 'truck', label: 'truck → Kamyon' },
  { file: 'suv-luxury', label: 'suv-luxury → Lüks' },
  { file: 'sedan-sports', label: 'sedan-sports' },
  { file: 'hatchback-sports', label: 'hatchback-sports → Elektrikli' }
];

const TINTS: Array<{ name: string; color: string | null }> = [
  { name: 'Orijinal', color: null },
  { name: 'Kırmızı', color: '#ef4444' },
  { name: 'Mavi', color: '#3b82f6' },
  { name: 'Beyaz', color: '#f8fafc' }
];

const ShowcaseModel: React.FC<{ file: string; tint: string | null }> = ({ file, tint }) => {
  const { scene } = useGLTF(`/models/vehicles/${file}.glb`);

  const model = React.useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = (child.material as THREE.MeshStandardMaterial).clone();
      if (tint && !child.name.startsWith('wheel')) {
        material.color = new THREE.Color(tint);
      }
      material.roughness = 0.55;
      child.material = material;
      child.castShadow = true;
    });
    return clone;
  }, [scene, tint]);

  return <primitive object={model} />;
};

export const ModelShowcase: React.FC = () => (
  <div className="w-screen h-screen bg-slate-900">
    <Canvas shadows dpr={[1, 2]}>
      <PerspectiveCamera
        makeDefault
        fov={38}
        position={[0, 24, 34]}
        onUpdate={(c) => c.lookAt(0, 0, 0)}
      />
      <ambientLight intensity={0.8} />
      <directionalLight position={[8, 14, 10]} intensity={2} castShadow />
      <hemisphereLight groundColor="#334155" intensity={0.5} />
      <color attach="background" args={['#1e293b']} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#39424f" roughness={0.8} />
      </mesh>

      <Suspense fallback={null}>
        {CANDIDATES.map((candidate, col) =>
          TINTS.map((tint, row) => (
            <group
              key={`${candidate.file}-${tint.name}`}
              position={[col * 3.6 - 14.4, 0, row * 3.6 - 5.4]}
            >
              <ShowcaseModel file={candidate.file} tint={tint.color} />
              {row === 0 && (
                <Html position={[0, 1.6, -2.6]} center distanceFactor={30}>
                  <div className="text-[12px] font-bold text-white whitespace-nowrap bg-slate-950/85 px-2 py-1 rounded">
                    {candidate.label}
                  </div>
                </Html>
              )}
              {col === 0 && (
                <Html position={[-3.4, 1.0, 0]} center distanceFactor={30}>
                  <div className="text-[12px] font-bold text-sky-300 whitespace-nowrap bg-slate-950/85 px-2 py-1 rounded">
                    {tint.name}
                  </div>
                </Html>
              )}
            </group>
          ))
        )}
      </Suspense>
    </Canvas>
  </div>
);
