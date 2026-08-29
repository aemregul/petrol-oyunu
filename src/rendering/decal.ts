/**
 * Depth bias for paint: anything drawn onto a surface it sits only a hair
 * above. Road markings, bay lines, the coloured pad under a charger, the ring
 * on a tank lid, the panel on a cabinet door.
 *
 * At the distance the forecourt is viewed from, a hundredth of a unit is below
 * what the depth buffer can tell apart, so the paint and the surface under it
 * take turns winning and the marking breaks into stripes that crawl as the
 * camera turns. Lifting the paint further would leave it visibly floating; the
 * fix is to bias it toward the camera in depth only, which settles it at every
 * distance and angle without moving it at all.
 *
 * The bias is graded, because two surfaces biased by the same amount still
 * fight each other: a marking painted on a surface that is itself painted on
 * the ground has to be given the next layer up.
 *
 *     <mesh>                                     ground
 *       <meshStandardMaterial {...decal(0.5)} /> an apron laid on it
 *     <mesh>
 *       <meshBasicMaterial {...DECAL} />         the arrow painted on the apron
 *     <mesh>
 *       <meshBasicMaterial {...decal(2)} />      a badge on top of the arrow
 */
export function decal(layer = 1): {
  polygonOffset: true;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
} {
  return {
    polygonOffset: true,
    polygonOffsetFactor: -2 * layer,
    polygonOffsetUnits: -2 * layer
  };
}

/** The common case: one coat of paint on the surface underneath it. */
export const DECAL = decal(1);
