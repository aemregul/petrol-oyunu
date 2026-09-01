import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createInitialGameState } from '../domain/types/initialState';

function stubBrowser(): void {
  (globalThis as any).window = {};
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  };
}

describe('two-stage build placement controls', () => {
  beforeEach(() => {
    stubBrowser();
    const gameState = createInitialGameState();
    gameState.player.level = 12;
    gameState.player.cash = 1_000_000;
    useGameStore.setState({
      gameState,
      cameraAngle: 0,
      buildMode: {
        active: false,
        buildingType: null,
        pinned: false,
        position: [0, 0],
        pointer: [0, 0],
        rotation: 0,
        isValid: true
      },
      relocating: null
    });
  });

  it('starts cursor-following and anchors only after a ground click', () => {
    useGameStore.getState().enterBuildMode('trash_can');
    expect(useGameStore.getState().buildMode.pinned).toBe(false);

    useGameStore.getState().pinBuildPreviewAt([10, 10]);
    const anchored = useGameStore.getState().buildMode;

    expect(anchored.pinned).toBe(true);
    expect(anchored.pointer).toEqual([10, 10]);
    // A 1x1 footprint centres in the middle of its grid square.
    expect(anchored.position).toEqual([10.5, 10.5]);
  });

  it('ignores fine-tuning commands until the preview is anchored', () => {
    useGameStore.getState().enterBuildMode('trash_can');
    const before = useGameStore.getState().buildMode;

    useGameStore.getState().nudgeBuildPreview('RIGHT');

    expect(useGameStore.getState().buildMode).toEqual(before);
  });

  it('nudges one grid step in the direction shown on screen', () => {
    useGameStore.getState().enterBuildMode('trash_can');
    useGameStore.getState().pinBuildPreviewAt([10, 10]);

    useGameStore.getState().nudgeBuildPreview('RIGHT');
    expect(useGameStore.getState().buildMode.pointer).toEqual([9, 10]);

    useGameStore.getState().nudgeBuildPreview('UP');
    expect(useGameStore.getState().buildMode.pointer).toEqual([9, 11]);
  });

  it('changes only one grid axis even when the camera is rotated', () => {
    useGameStore.setState({ cameraAngle: 90 });
    useGameStore.getState().enterBuildMode('trash_can');
    useGameStore.getState().pinBuildPreviewAt([10, 10]);

    useGameStore.getState().nudgeBuildPreview('RIGHT');

    expect(useGameStore.getState().buildMode.pointer).toEqual([9, 10]);
  });

  it('clears the anchor after cancel or successful placement', () => {
    useGameStore.getState().enterBuildMode('trash_can');
    useGameStore.getState().pinBuildPreviewAt([10, 10]);
    useGameStore.getState().exitBuildMode();
    expect(useGameStore.getState().buildMode.pinned).toBe(false);

    useGameStore.getState().enterBuildMode('trash_can');
    useGameStore.getState().pinBuildPreviewAt([10, 10]);
    expect(useGameStore.getState().confirmBuildPlacement()).toBe(true);
    expect(useGameStore.getState().buildMode.pinned).toBe(false);
  });
});
