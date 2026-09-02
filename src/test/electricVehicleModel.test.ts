import { describe, expect, it } from 'vitest';
import { electricVehicleVariant } from '../rendering/models/ElectricVehicleModel';

describe('electric vehicle body variants', () => {
  it('keeps the same vehicle on the same body across renders', () => {
    expect(electricVehicleVariant('veh_persisted')).toBe(
      electricVehicleVariant('veh_persisted')
    );
  });

  it('makes both EV silhouettes available to the customer fleet', () => {
    const variants = new Set(
      Array.from({ length: 30 }, (_, index) => electricVehicleVariant(`veh_${index}`))
    );

    expect(variants).toEqual(new Set(['hatchback', 'city']));
  });
});
