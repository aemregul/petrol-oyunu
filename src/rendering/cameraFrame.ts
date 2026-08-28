/**
 * Where the camera sits for a given zoom step, and which step frames a plot of
 * a given size.
 *
 * The rig and the "centre the view" button both need this, and they have to
 * agree: a fit worked out from one set of numbers and applied to another puts
 * the plot half off screen.
 */

/** Zoom runs 1 (furthest out) to 7 (closest in). */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 7;

/**
 * The last few steps pull back much harder than the first ones. A plot grown
 * across the highway is far larger than the one the game starts on, and a flat
 * scale that framed the starting forecourt could never fit both blocks on
 * screen. From the default step inwards nothing changes.
 */
export function cameraOffsets(zoom: number): { distance: number; height: number } {
  const zoomOut = MAX_ZOOM - zoom;
  const wide = Math.max(0, zoomOut - 3) ** 2;

  return {
    distance: 26 + zoomOut * 7 + wide * 8,
    height: 20 + zoomOut * 5 + wide * 5.5
  };
}

/**
 * Roughly how much ground the camera takes in at a zoom step, in world units.
 * Derived from the rig's own numbers so the two cannot drift apart, and scaled
 * against a known-good frame: the starting plot is 32 units across and sits
 * comfortably at the default step, which is what fixes the constant.
 */
export function groundCoverage(zoom: number): number {
  const { distance, height } = cameraOffsets(zoom);
  return Math.hypot(distance, height) * 0.56;
}

/**
 * The closest zoom step that still takes in a plot this wide, in world units.
 * A plot too big for even the widest step gets that step: as much of it as
 * the camera can hold, rather than a frame that gives up.
 */
export function zoomToFit(span: number): number {
  for (let zoom = MAX_ZOOM; zoom > MIN_ZOOM; zoom--) {
    if (groundCoverage(zoom) >= span) return zoom;
  }
  return MIN_ZOOM;
}
