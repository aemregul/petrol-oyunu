import { describe, it, expect } from 'vitest';
import {
  STARTING_PARCELS,
  parcelBounds,
  parcelAt,
  isOwned,
  isBuyable,
  buyableParcels,
  parcelPrice,
  ownedBounds,
  isFootprintOnOwnedLand,
  paveCost,
  PARCEL
} from '../domain/services/land';

describe('land parcels', () => {
  it('starts with a 2x2 block against the road', () => {
    expect(STARTING_PARCELS).toHaveLength(4);
    const bounds = ownedBounds(STARTING_PARCELS);
    expect(bounds.width).toBe(PARCEL.width * 2);
    expect(bounds.height).toBe(PARCEL.depth * 2);
  });

  it('maps a grid point to the parcel containing it', () => {
    expect(parcelAt(0, 0)).toEqual({ col: 0, row: 0 });
    expect(parcelAt(PARCEL.width + 1, PARCEL.depth + 1)).toEqual({ col: 1, row: 1 });
    expect(parcelAt(-1, 0).col).toBe(-1);
  });

  it('only offers parcels that touch owned land', () => {
    const owned = [...STARTING_PARCELS];

    // Directly right of the block.
    expect(isBuyable(owned, 2, 0)).toBe(true);
    // Diagonal from the corner touches nothing edge-on.
    expect(isBuyable(owned, 2, 2)).toBe(false);
    // Already owned.
    expect(isBuyable(owned, 0, 0)).toBe(false);
  });

  it('respects the map bounds', () => {
    const owned = ['0,0'];
    expect(isBuyable(owned, 0, -1)).toBe(false);
  });

  it('grows only where the parcel was bought', () => {
    // Buy one parcel at the far right of the front row.
    const owned = [...STARTING_PARCELS, '2,0'];
    const bounds = ownedBounds(owned);

    // The bounding box widens, but the back row is untouched: buying frontage
    // must not drag the depth along with it.
    expect(bounds.width).toBe(PARCEL.width * 3);
    expect(bounds.height).toBe(PARCEL.depth * 2);
    expect(isOwned(owned, 2, 1)).toBe(false);
  });

  it('charges more as the estate grows, and a premium for road frontage', () => {
    const small = [...STARTING_PARCELS];
    const large = [...STARTING_PARCELS, '2,0', '2,1', '3,0'];

    expect(parcelPrice(large, 0)).toBeGreaterThan(parcelPrice(small, 0));
    // Row 0 fronts the highway and costs more than the row behind it.
    expect(parcelPrice(small, 0)).toBeGreaterThan(parcelPrice(small, 1));
  });

  it('rejects a footprint that spills onto unowned land', () => {
    const owned = [...STARTING_PARCELS];
    const bounds = ownedBounds(owned);

    const inside = { minX: 2, minZ: 2, maxX: 6, maxZ: 6 };
    expect(isFootprintOnOwnedLand(owned, inside)).toBe(true);

    // Straddles the right-hand boundary of the owned block.
    const spilling = {
      minX: bounds.width - 2,
      minZ: 2,
      maxX: bounds.width + 3,
      maxZ: 6
    };
    expect(isFootprintOnOwnedLand(owned, spilling)).toBe(false);
  });

  it('accepts a footprint spanning two owned parcels', () => {
    const owned = [...STARTING_PARCELS];
    const across = { minX: PARCEL.width - 2, minZ: 2, maxX: PARCEL.width + 2, maxZ: 6 };
    expect(isFootprintOnOwnedLand(owned, across)).toBe(true);
  });

  it('offers the parcels around the starting block', () => {
    const offers = buyableParcels(STARTING_PARCELS);
    expect(offers.length).toBeGreaterThan(0);
    for (const { col, row } of offers) {
      expect(isOwned(STARTING_PARCELS, col, row)).toBe(false);
    }
  });

  it('places parcel bounds contiguously', () => {
    const a = parcelBounds(0, 0);
    const b = parcelBounds(1, 0);
    expect(a.maxX).toBe(b.minX);
  });

  it('charges to pave, with a premium on the road frontage', () => {
    expect(paveCost(0)).toBeGreaterThan(paveCost(1));
    // Paving is meant to be a fraction of the land price, not a second purchase.
    expect(paveCost(0)).toBeLessThan(parcelPrice(STARTING_PARCELS, 0) / 2);
  });
});

describe('land — the far side of the highway', () => {
  it('keeps the far side shut until the road is widened', () => {
    // Straight across the road from an owned parcel.
    expect(isBuyable(STARTING_PARCELS, 0, -1, 1)).toBe(false);
    expect(isBuyable(STARTING_PARCELS, 0, -1, 2)).toBe(true);
  });

  it('only lets you cross where you already hold the near side', () => {
    // Column 4 is nowhere near the starting block.
    expect(isBuyable(STARTING_PARCELS, 4, -1, 2)).toBe(false);
  });

  it('extends an existing far-side holding away from the road', () => {
    const owned = [...STARTING_PARCELS, '0,-1'];
    expect(isBuyable(owned, 0, -2, 2)).toBe(true);
    expect(isBuyable(owned, 1, -1, 2)).toBe(true);
  });

  it('places far-side parcels clear of the carriageway', () => {
    const far = parcelBounds(0, -1);
    const near = parcelBounds(0, 0);

    // The far parcel sits entirely on the negative side, with the road between.
    expect(far.maxZ).toBeLessThan(near.minZ);
    expect(far.maxZ - far.minZ).toBe(PARCEL.depth);
  });

  it('maps a point across the road back to its far-side parcel', () => {
    const b = parcelBounds(1, -1);
    const mid = (b.minZ + b.maxZ) / 2;
    expect(parcelAt(b.minX + 1, mid)).toEqual({ col: 1, row: -1 });
  });

  it('charges the frontage premium on both sides of the road', () => {
    expect(parcelPrice(STARTING_PARCELS, -1)).toBe(parcelPrice(STARTING_PARCELS, 0));
    expect(paveCost(-1)).toBe(paveCost(0));
  });
});
