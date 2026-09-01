import React, { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { BUILDING_MODELS, BUILDING_MODEL_URLS } from './buildingModels';
import { FasciaSign } from '../FasciaSign';

export interface ModelSign {
  text: string;
  color: string;
  textColor: string;
}

interface BuildingModelProps {
  type: string;
  /** Catalogue footprint in grid cells; world units are twice this. */
  footprint: [number, number];
  /** Name board to hang on the building, positioned from its own geometry. */
  sign?: ModelSign;
}

/**
 * Returns the geometry without the triangles that sit wholly inside a box.
 *
 * Only whole triangles go: a triangle with one corner inside the box is part
 * of the wall behind the fixture, and dropping it would open a hole.
 */
function stripBox(
  geometry: THREE.BufferGeometry,
  region: { min: [number, number, number]; max: [number, number, number] }
): THREE.BufferGeometry {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  if (!index) return geometry;

  const min = new THREE.Vector3(...region.min);
  const max = new THREE.Vector3(...region.max);
  const inside = (i: number): boolean => {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    return x >= min.x && x <= max.x && y >= min.y && y <= max.y && z >= min.z && z <= max.z;
  };

  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    if (inside(a) && inside(b) && inside(c)) continue;
    kept.push(a, b, c);
  }

  if (kept.length === index.count) return geometry;

  const trimmed = geometry.clone();
  trimmed.setIndex(kept);
  return trimmed;
}

/**
 * Renders a catalogue building from its Kenney model, sized to the footprint
 * the game reserved for it and resting on the ground.
 *
 * Both the scale and the ground offset are measured from the model rather
 * than hand-tuned, so swapping in a different model needs no new numbers. The
 * name board is placed from the same measurement: a model rarely fills the plot
 * it was given, so a board positioned from the footprint ends up hanging in the
 * air beside the building rather than fixed to it.
 */
/**
 * The horizontal run of the building at one height, and how far forward its
 * front face reaches there.
 *
 * Walks the model's own vertices rather than its bounding box, because the box
 * describes the widest part of the building at any height — which is exactly
 * the wrong number for a board hung at the top of it.
 */
function facadeAt(
  object: THREE.Object3D,
  y: number,
  onWall: boolean
): { minX: number; maxX: number; frontZ: number } {
  // A band rather than a plane: a roofline is never perfectly flat, and a wall
  // sign wants the storey it sits on, not the single row of vertices at its
  // exact height.
  const band = onWall ? 0.9 : 0.55;

  let minX = Infinity;
  let maxX = -Infinity;
  let frontZ = -Infinity;
  const vertex = new THREE.Vector3();

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry?.getAttribute('position');
    if (!position) return;

    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position as THREE.BufferAttribute, i);
      mesh.localToWorld(vertex);
      if (Math.abs(vertex.y - y) > band) continue;
      minX = Math.min(minX, vertex.x);
      maxX = Math.max(maxX, vertex.x);
      frontZ = Math.max(frontZ, vertex.z);
    }
  });

  // Nothing at that height — a model whose top is a spire, say. The caller
  // falls back to the bounding box.
  if (minX === Infinity) return { minX: NaN, maxX: NaN, frontZ: NaN };
  return { minX, maxX, frontZ };
}

export const BuildingModel: React.FC<BuildingModelProps> = ({ type, footprint, sign }) => {
  const config = BUILDING_MODELS[type];
  const { scene } = useGLTF(config.url);

  const { model, groundOffset, extent, facade } = useMemo(() => {
    const clone = scene.clone(true);

    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;

      // Geometry is shared with the cached original, so it is only ever
      // replaced with a copy — editing it in place would strip the fixture
      // from every other model loaded from the same file.
      if (config.stripRegion) child.geometry = stripBox(child.geometry, config.stripRegion);

      // Clone the material so a tint never leaks to other instances.
      const material = (child.material as THREE.MeshStandardMaterial).clone();
      if (config.tint) material.color = new THREE.Color(config.tint);
      material.roughness = 0.75;
      child.material = material;
    });

    clone.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(clone);
    const size = raw.getSize(new THREE.Vector3());

    let scale: number;
    if (config.fit === 'height') {
      scale = (config.targetHeight || 4) / Math.max(0.001, size.y);
    } else {
      // Fill the reserved plot without spilling over either edge.
      const targetWidth = footprint[0] * 2;
      const targetDepth = footprint[1] * 2;
      scale = Math.min(targetWidth / Math.max(0.001, size.x), targetDepth / Math.max(0.001, size.z));

      if (config.maxHeight) {
        scale = Math.min(scale, config.maxHeight / Math.max(0.001, size.y));
      }
    }

    clone.scale.set(scale, scale * (config.heightScale || 1), scale);
    clone.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(clone);

    const size2 = scaled.getSize(new THREE.Vector3());
    const anchor = config.signAnchor;
    // Where the board will hang, measured from the ground the model stands on.
    const signHeight = anchor != null ? size2.y * anchor : size2.y;

    return {
      model: clone,
      groundOffset: -scaled.min.y,
      extent: size2,
      // The building is rarely one block. A shop with a low wing beside a tall
      // one is as wide at the ground as it is narrow at the roof, and a board
      // sized from the whole bounding box then hangs off the end of the tall
      // part into thin air. So the board is measured against the mass that is
      // actually there at the height it hangs at, not against the footprint.
      facade: facadeAt(clone, scaled.min.y + signHeight, anchor != null)
    };
  }, [scene, config, footprint]);

  const rotation = ((config.rotationOffset || 0) * Math.PI) / 180;
  const onWall = config.signAnchor != null;

  // The box is measured before the model is turned, so its axes are the
  // model's own: x across the facade, z through it. The board is hung in that
  // same frame and turned with the building, so it stays on the shop front
  // wherever the building ends up pointing.
  const signYaw = rotation + ((config.signYaw || 0) * Math.PI) / 180;

  // Measured span where the board hangs, falling back to the bounding box for
  // a model that has nothing at that height to measure.
  const spanX = Number.isFinite(facade.minX) ? facade.maxX - facade.minX : extent.x;
  const signWidth = Math.max(2.2, spanX * 0.82);
  const signCentreX = Number.isFinite(facade.minX) ? (facade.minX + facade.maxX) / 2 : 0;
  const signWallOffset = Number.isFinite(facade.frontZ) ? facade.frontZ : extent.z / 2;

  return (
    <>
      <primitive object={model} position={[0, groundOffset, 0]} rotation={[0, rotation, 0]} />

      {sign && (
        <group rotation={[0, signYaw, 0]} position={[signCentreX, 0, 0]}>
          <FasciaSign
            text={sign.text}
            color={sign.color}
            textColor={sign.textColor}
            width={signWidth}
            y={onWall ? extent.y * config.signAnchor! : extent.y}
            anchor={onWall ? 'center' : 'bottom'}
            wallOffset={onWall ? signWallOffset : 0}
          />
        </group>
      )}
    </>
  );
};

for (const url of BUILDING_MODEL_URLS) useGLTF.preload(url);
