import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';

/**
 * Emre, 2026-09-07: land is bought and paved from two cards in the catalogue.
 * Each opens the map for one job only — the buyer is never offered concrete,
 * the concrete crew is never offered land — so a click cannot do the wrong
 * thing on the wrong parcel.
 */
function stubBrowser(): void {
  (globalThis as any).window = {};
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  };
}

beforeEach(() => {
  stubBrowser();
  const state = createInitialGameState();
  state.player.cash = 1_000_000;
  // One owned parcel left bare: the concrete crew's only job.
  state.station.plots.ownedParcels.push('2,0');
  useGameStore.setState({ gameState: state, activeModal: 'BUILD' });
});

describe('land mode intent', () => {
  it('offers only land to a buyer, even on a bare parcel they own', () => {
    useGameStore.getState().enterLandMode('BUY');
    expect(useGameStore.getState().activeModal).toBe('NONE');

    useGameStore.getState().hoverParcel(2, 0);
    expect(useGameStore.getState().landMode.action).toBe('NONE');

    useGameStore.getState().hoverParcel(3, 0);
    expect(useGameStore.getState().landMode.action).toBe('BUY');
    expect(useGameStore.getState().buyHoveredParcel()).toBe(true);
    expect(useGameStore.getState().gameState.station.plots.ownedParcels).toContain('3,0');
  });

  it('offers only concrete to the crew, and only on bare land the player owns', () => {
    useGameStore.getState().enterLandMode('PAVE');

    useGameStore.getState().hoverParcel(3, 0);
    expect(useGameStore.getState().landMode.action).toBe('NONE');

    useGameStore.getState().hoverParcel(2, 0);
    expect(useGameStore.getState().landMode.action).toBe('PAVE');
    expect(useGameStore.getState().paveHoveredParcel()).toBe(true);
    expect(useGameStore.getState().gameState.station.plots.pavedParcels).toContain('2,0');
  });

  it('comes in as a buyer when nobody says otherwise', () => {
    useGameStore.getState().enterLandMode();
    expect(useGameStore.getState().landMode.intent).toBe('BUY');
  });
});
