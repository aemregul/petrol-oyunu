import React from 'react';
import { ConcreteApron, KERB, ParcelFence } from './GroundGrid';
import { parcelBounds } from '../domain/services/land';

/**
 * Catalogue portraits for the land cards (Emre, 2026-09-14). The hand-drawn
 * icons looked nothing like the game, so these are small scenes built from
 * the pieces the map itself draws — the fenced bare ground a bought parcel
 * arrives as, the concrete and its kerb, the countryside's trees — and
 * photographed by the catalogue's booth like every other card.
 */

/** Grid units to world units, as everywhere on the ground. */
const S = 2;

export const LAND_PORTRAITS = {
  land_parcel: 'land',
  land_paved: 'paved'
} as const;

export type LandPortraitType = keyof typeof LAND_PORTRAITS;

export function isLandPortrait(type: string): type is LandPortraitType {
  return type in LAND_PORTRAITS;
}

/** A parcel set back from the road, so its fence and concrete are drawn untrimmed. */
const COL = 0;
const ROW = 2;

/** The countryside's own grass. */
const Grass: React.FC<{ minX: number; maxX: number; minZ: number; maxZ: number }> = ({ minX, maxX, minZ, maxZ }) => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(minX + maxX) / 2, -0.06, (minZ + maxZ) / 2]}>
    <planeGeometry args={[maxX - minX, maxZ - minZ]} />
    <meshStandardMaterial color="#3f5a2c" roughness={0.95} />
  </mesh>
);

/** A tree cut to the shape and colours SceneryProps scatters round the plot. */
const Tree: React.FC<{ x: number; z: number; scale?: number }> = ({ x, z, scale = 1 }) => (
  <group position={[x, 0, z]} scale={scale}>
    <mesh position={[0, 1.4, 0]}>
      <cylinderGeometry args={[0.24, 0.34, 2.8, 5]} />
      <meshStandardMaterial color="#5b4534" roughness={1} />
    </mesh>
    <mesh position={[0, 3.9, 0]}>
      <icosahedronGeometry args={[1.9, 0]} />
      <meshStandardMaterial color="#41802f" roughness={0.95} flatShading />
    </mesh>
  </group>
);

/** SceneryProps' shrub, likewise. */
const Shrub: React.FC<{ x: number; z: number; scale?: number }> = ({ x, z, scale = 1 }) => (
  <mesh position={[x, 0.65 * scale, z]} scale={scale}>
    <icosahedronGeometry args={[1.0, 0]} />
    <meshStandardMaterial color="#4d8f3c" roughness={1} flatShading />
  </mesh>
);

/** One run of the kerb that edges poured concrete. */
const Kerb: React.FC<{ x: number; z: number; width: number; depth: number }> = ({ x, z, width, depth }) => (
  <mesh position={[x, KERB.height / 2, z]}>
    <boxGeometry args={[width, KERB.height, depth]} />
    <meshStandardMaterial color={KERB.color} roughness={0.85} />
  </mesh>
);

export const LandPortrait: React.FC<{ kind: 'land' | 'paved' }> = ({ kind }) => {
  const plot = parcelBounds(COL, ROW);
  const minX = plot.minX * S;
  const maxX = plot.maxX * S;
  const minZ = plot.minZ * S;
  const maxZ = plot.maxZ * S;

  if (kind === 'land') {
    // A bought parcel as it arrives: bare ground behind a fence, out in the country.
    return (
      <group>
        <Grass minX={minX - 3} maxX={maxX + 3} minZ={minZ - 3} maxZ={maxZ + 3} />
        <ParcelFence col={COL} row={ROW} />
        <Tree x={maxX + 1.6} z={minZ + 2.2} scale={1.25} />
        <Tree x={minX - 1.5} z={maxZ - 2} scale={1.05} />
        <Shrub x={maxX + 1.5} z={maxZ - 1.2} scale={1.1} />
        <Shrub x={minX - 1.4} z={minZ + 1.4} scale={0.9} />
      </group>
    );
  }

  // Poured: the parcel next door concreted and kerbed, beside one still waiting for it.
  const next = parcelBounds(COL + 1, ROW);
  const pourMinX = next.minX * S;
  const pourMaxX = next.maxX * S;
  const width = pourMaxX - pourMinX;
  const depth = maxZ - minZ;
  const midX = (pourMinX + pourMaxX) / 2;
  const midZ = (minZ + maxZ) / 2;

  return (
    <group>
      <Grass minX={minX - 2.5} maxX={pourMaxX + 2.5} minZ={minZ - 2.5} maxZ={maxZ + 2.5} />
      <ParcelFence col={COL} row={ROW} />
      <ConcreteApron westX={pourMinX} northZ={minZ} width={width} depth={depth} anchorZ={minZ} joints={false} />
      <Kerb x={midX} z={minZ} width={width} depth={KERB.width} />
      <Kerb x={midX} z={maxZ} width={width} depth={KERB.width} />
      <Kerb x={pourMinX} z={midZ} width={KERB.width} depth={depth} />
      <Kerb x={pourMaxX} z={midZ} width={KERB.width} depth={depth} />
      {/* Behind the waiting parcel, on the far side from the camera, so the
          card's frame never cuts it off. */}
      <Tree x={minX - 1.4} z={minZ + 2.2} scale={1.15} />
    </group>
  );
};
