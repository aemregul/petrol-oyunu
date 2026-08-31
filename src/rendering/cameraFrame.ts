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
 * The three ways of looking at the station, in the order the view button walks
 * through them. Pitch is measured up from the ground: 0 would be standing on
 * the forecourt, 90 would be straight overhead.
 *
 * Nothing reaches 90 on purpose — a camera exactly above its target has no
 * unambiguous "up", and `lookAt` rolls the world when it gets there.
 */
/**
 * `radiusScale` is what keeps roughly the same amount of forecourt in frame at
 * every pitch. Looking straight down, the ground is square to the lens and a
 * fixed distance shows far less of it than the same distance does obliquely —
 * so the overhead view stands further off, and the low one comes in closer.
 */
export const CAMERA_VIEWS = [
  { id: 'ISOMETRIC', label: 'İzometrik', pitch: 36, radiusScale: 1 },
  { id: 'TOP_DOWN', label: 'Kuşbakışı', pitch: 85, radiusScale: 1.38 },
  { id: 'LOW', label: 'Alçak Açı', pitch: 16, radiusScale: 0.64 }
] as const;

export type CameraViewId = (typeof CAMERA_VIEWS)[number]['id'];

/** The pitch the rig sat at before the view button existed. */
const DEFAULT_PITCH = CAMERA_VIEWS[0].pitch;

/**
 * How far the camera sits from what it is looking at. The last few steps pull
 * back much harder than the first ones: a plot grown across the highway is far
 * larger than the one the game starts on, and a flat scale that framed the
 * starting forecourt could never fit both blocks on screen. From the default
 * step inwards nothing changes.
 */
function cameraRadius(zoom: number): number {
  const zoomOut = MAX_ZOOM - zoom;
  const wide = Math.max(0, zoomOut - 3) ** 2;

  return Math.hypot(26 + zoomOut * 7 + wide * 8, 20 + zoomOut * 5 + wide * 5.5);
}

/**
 * Where the camera sits for a given zoom step, pitch and distance scale.
 * Defaults reproduce the isometric rig exactly, so callers that do not care
 * about the view — the framing maths, chiefly — need not pass either.
 */
export function cameraOffsets(
  zoom: number,
  pitchDeg: number = DEFAULT_PITCH,
  radiusScale = 1
): { distance: number; height: number } {
  const radius = cameraRadius(zoom) * radiusScale;
  const pitch = (pitchDeg * Math.PI) / 180;

  return {
    distance: radius * Math.cos(pitch),
    height: radius * Math.sin(pitch)
  };
}

/**
 * Roughly how much ground the camera takes in at a zoom step, in world units.
 * Derived from the rig's own numbers so the two cannot drift apart, and scaled
 * against a known-good frame: the starting plot is 32 units across and sits
 * comfortably at the default step, which is what fixes the constant.
 */
export function groundCoverage(zoom: number): number {
  return cameraRadius(zoom) * 0.56;
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
