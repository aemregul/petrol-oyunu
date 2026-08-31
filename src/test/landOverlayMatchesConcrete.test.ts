import { describe, it, expect } from 'vitest';
import { parcelBounds } from '../domain/services/land';
import { S, APRON_FRONT, FAR_APRON_FRONT, pavedSpan } from '../rendering/forecourt';

/**
 * The land-buying overlay and the concrete describe the same ground.
 *
 * A parcel fronting the road is poured a square short of its own boundary, so
 * the verge survives. The overlay drew the full parcel instead, which put a
 * plot on offer a square nearer the road than the forecourt beside it — it
 * looked crooked, then snapped straight once bought and poured. Both now read
 * the same span, and this is what stops them drifting apart again.
 */
describe('the land overlay and the concrete', () => {
  it('trims a road-facing parcel back to the verge line', () => {
    const [front, back] = pavedSpan(parcelBounds(0, 0));

    expect(front).toBe(APRON_FRONT);
    expect(back).toBe(parcelBounds(0, 0).maxZ * S);
    // Exactly one build square of verge is given up, and only at the front.
    expect(front - parcelBounds(0, 0).minZ * S).toBe(S);
  });

  it('leaves a parcel that fronts nothing at its full depth', () => {
    const b = parcelBounds(0, 1);
    expect(pavedSpan(b)).toEqual([b.minZ * S, b.maxZ * S]);
  });

  it('mirrors the trim on the block across the road', () => {
    const b = parcelBounds(0, -1);
    const [front, back] = pavedSpan(b);

    expect(front).toBe(b.minZ * S);
    expect(back).toBe(Math.min(b.maxZ * S, FAR_APRON_FRONT));
    expect(back).toBeLessThanOrEqual(b.maxZ * S);
  });

  it('keeps every edge on a build-cell boundary', () => {
    for (const row of [0, 1, 2, -1, -2]) {
      const [front, back] = pavedSpan(parcelBounds(0, row));
      // Math.abs, because a negative z leaves `% S` as -0, which is not +0.
      expect(Math.abs(front % S)).toBe(0);
      expect(Math.abs(back % S)).toBe(0);
      expect(back).toBeGreaterThan(front);
    }
  });
});
