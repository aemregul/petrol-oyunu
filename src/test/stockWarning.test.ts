import { describe, it, expect } from 'vitest';
import { stockWarningDue } from '../ui/ActiveEventsBar';

/**
 * Emre, 2026-09-07: the "critical stock" card kept shouting after a tanker
 * had been ordered. The card asks for exactly one thing; once that thing is
 * on its way, the card goes.
 */
describe('critical stock card', () => {
  const low = { stock: 100, capacity: 1500, fuelType: 'gasoline' };

  it('shows for a low tank with nothing ordered', () => {
    expect(stockWarningDue(low, [])).toBe(true);
  });

  it('goes quiet once a tanker for that fuel is on its way', () => {
    expect(stockWarningDue(low, [{ fuelType: 'gasoline' }])).toBe(false);
    // An order for another fuel does nothing for this tank.
    expect(stockWarningDue(low, [{ fuelType: 'diesel' }])).toBe(true);
  });

  it('never shows for a tank above the line', () => {
    expect(stockWarningDue({ ...low, stock: 300 }, [])).toBe(false);
  });
});
