import { describe, expect, it } from 'vitest';
import { placeCard } from '../ui/LessonOverlay';

/**
 * Emre, 2026-09-12: a lesson card with nothing to point at sat with its top
 * left corner on the centre of the screen. It was centred by a transform, and
 * the card's fade-in animation owns `transform`. The position is plain
 * arithmetic now; these pin the numbers.
 */
describe('where a lesson card goes with nothing lit', () => {
  it('sits with its middle on the middle of the screen, without a transform', () => {
    const { style, arrow } = placeCard(null, { w: 1920, h: 1000 }, 340, 180, false);
    expect(style).toEqual({ left: 790, top: 410, width: 340 });
    expect(arrow).toBeNull();
  });

  it('waits at the bottom middle on a step that leaves the screen usable', () => {
    const { style } = placeCard(null, { w: 1920, h: 1000 }, 340, 180, true);
    expect(style).toEqual({ left: 790, top: 710, width: 340 });
  });

  it('never goes off a screen too small for it', () => {
    const { style } = placeCard(null, { w: 300, h: 150 }, 276, 180, false);
    expect(style).toEqual({ left: 12, top: 12, width: 276 });
  });
});
