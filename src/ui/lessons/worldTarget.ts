import type { WorldBox } from './lessonTypes';

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The hand-off between the lesson overlay, which lives in the DOM, and the
 * scene, which is the only place a camera exists. The overlay says which box
 * it wants lit; a probe inside the Canvas projects it every frame and leaves
 * the screen rectangle here. A plain object rather than store state: it
 * changes every frame while a car moves, and nothing should re-render for it
 * but the overlay that polls it.
 */
export const worldTarget: { box: WorldBox | null; rect: ScreenRect | null } = {
  box: null,
  rect: null
};
