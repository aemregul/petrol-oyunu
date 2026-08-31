import React, { useMemo } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useGameStore } from '../store/gameStore';
import {
  PARCEL,
  parcelAt,
  parcelBounds,
  isBuyable,
  isOwned,
  buyableParcels,
  parseParcelKey
} from '../domain/services/land';
import { PointerState } from './BuildPlacementPlane';
import { DECAL } from './decal';
import { S, pavedSpan } from './forecourt';

/** Gap left around a marker so neighbouring plots read as separate. */
const INSET = 0.6;

interface LandParcelLayerProps {
  pointerState: React.MutableRefObject<PointerState>;
}

/**
 * Land-buying overlay: highlights every parcel that may be bought, previews
 * the one under the cursor with its price, and buys it on click.
 *
 * Only shown while land mode is active, so it never interferes with building.
 */
export const LandParcelLayer: React.FC<LandParcelLayerProps> = ({ pointerState }) => {
  const landMode = useGameStore((s) => s.landMode);
  const owned = useGameStore((s) => s.gameState.station.plots.ownedParcels);
  const paved = useGameStore((s) => s.gameState.station.plots.pavedParcels);
  const roadLevel = useGameStore((s) => s.gameState.station.roadLevel);
  const hoverParcel = useGameStore((s) => s.hoverParcel);
  const buyHoveredParcel = useGameStore((s) => s.buyHoveredParcel);
  const paveHoveredParcel = useGameStore((s) => s.paveHoveredParcel);

  /**
   * Outlines, one per distinct depth rather than one for everything.
   *
   * A parcel fronting the road is poured a square shallower than the ones
   * behind it, so drawing every marker at the full parcel depth put the plot
   * on offer a square nearer the road than the concrete would ever reach — it
   * looked crooked against its neighbour, then "straightened" the moment it
   * was bought and poured. The marker now describes the ground on offer.
   */
  const outlines = useMemo(() => {
    const cache = new Map<number, THREE.EdgesGeometry>();
    return (depth: number) => {
      const key = Math.round(depth * 100);
      let geometry = cache.get(key);
      if (!geometry) {
        geometry = new THREE.EdgesGeometry(
          new THREE.PlaneGeometry(PARCEL.width * S - INSET, depth - INSET)
        );
        cache.set(key, geometry);
      }
      return geometry;
    };
  }, []);

  if (!landMode.active) return null;

  // Two kinds of offer: unowned neighbours to buy, and owned land to pave.
  const forSale = buyableParcels(owned, roadLevel);
  const toPave = owned
    .filter((key) => !paved.includes(key))
    .map((key) => parseParcelKey(key));

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (pointerState.current.pointerDown) return;
    e.stopPropagation();
    const { col, row } = parcelAt(e.point.x / S, e.point.z / S);
    hoverParcel(col, row);
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (pointerState.current.dragged) return;
    e.stopPropagation();
    const { col, row } = parcelAt(e.point.x / S, e.point.z / S);
    hoverParcel(col, row);

    if (isOwned(owned, col, row)) paveHoveredParcel();
    else buyHoveredParcel();
  };

  const hovered = landMode.hovered;
  const showTag = hovered !== null && landMode.action !== 'NONE';

  return (
    <group>
      {/* Pointer target covering the whole buyable map */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.06, 0]}
        onPointerMove={handleMove}
        onClick={handleClick}
      >
        <planeGeometry args={[900, 900]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Parcels on offer: blue to buy, amber to pave */}
      {[
        ...forSale.map((p) => ({ ...p, kind: 'BUY' as const })),
        ...toPave.map((p) => ({ ...p, kind: 'PAVE' as const }))
      ].map(({ col, row, kind }) => {
        const b = parcelBounds(col, row);
        const [front, back] = pavedSpan(b);
        const depth = back - front;
        const centreZ = (front + back) / 2;
        const isHovered = hovered?.col === col && hovered?.row === row;

        return (
          <group key={`${kind}_${col},${row}`}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[((b.minX + b.maxX) / 2) * S, isHovered ? 0.1 : 0.08, centreZ]}
            >
              <planeGeometry args={[PARCEL.width * S - INSET, depth - INSET]} />
              <meshBasicMaterial
                color={isHovered ? '#22c55e' : kind === 'PAVE' ? '#f59e0b' : '#38bdf8'}
                transparent
                opacity={isHovered ? 0.42 : 0.16}
                depthWrite={false}
                {...DECAL}
              />
            </mesh>

            {/* Boundary so an unhovered parcel still reads as a plot */}
            <lineSegments
              geometry={outlines(depth)}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[((b.minX + b.maxX) / 2) * S, 0.12, centreZ]}
            >
              <lineBasicMaterial
                color={isHovered ? '#22c55e' : kind === 'PAVE' ? '#f59e0b' : '#38bdf8'}
              />
            </lineSegments>
          </group>
        );
      })}

      {/* Price tag for the parcel under the cursor */}
      {showTag && hovered && (
        <Html
          position={[
            ((parcelBounds(hovered.col, hovered.row).minX +
              parcelBounds(hovered.col, hovered.row).maxX) /
              2) *
              S,
            2.5,
            (() => {
              const [front, back] = pavedSpan(parcelBounds(hovered.col, hovered.row));
              return (front + back) / 2;
            })()
          ]}
          center
          distanceFactor={30}
          zIndexRange={[5, 0]}
        >
          <div
            className={`px-3 py-1.5 rounded-xl font-bold text-xs shadow-2xl whitespace-nowrap border ${
              landMode.canBuy
                ? 'bg-slate-950/95 border-emerald-500 text-emerald-300'
                : 'bg-slate-950/95 border-red-500 text-red-300'
            }`}
          >
            {landMode.action === 'PAVE' ? 'Beton' : 'Arsa'}: ₺
            {landMode.price.toLocaleString('tr-TR')}
            {landMode.action === 'BUY' && hovered.row === 0 && (
              <span className="text-slate-400"> · yol cephesi</span>
            )}
            <span className="ml-1">{landMode.canBuy ? '✓' : '✕'}</span>
          </div>
        </Html>
      )}
    </group>
  );
};
