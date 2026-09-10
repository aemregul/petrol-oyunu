import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore, DEFAULT_CAMERA_ANGLE } from '../store/gameStore';
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
      cameraAngle: DEFAULT_CAMERA_ANGLE,
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

  /**
   * Where a grid step lands on screen for a given camera yaw. The rig puts the
   * camera at target + (sin A, ·, cos A), so the ground's screen-right runs
   * along (cos A, −sin A) and screen-up (away from the camera) along
   * (−sin A, −cos A).
   */
  function onScreen(step: [number, number], angle: number): { right: number; up: number } {
    const rad = (angle * Math.PI) / 180;
    const [x, z] = step;
    return {
      right: x * Math.cos(rad) - z * Math.sin(rad),
      up: -x * Math.sin(rad) - z * Math.cos(rad)
    };
  }

  it('changes only one grid axis at every quarter turn of the camera', () => {
    for (let turn = 0; turn < 4; turn++) {
      useGameStore.setState({ cameraAngle: (DEFAULT_CAMERA_ANGLE + turn * 90) % 360 });
      useGameStore.getState().enterBuildMode('trash_can');
      useGameStore.getState().pinBuildPreviewAt([10, 10]);

      useGameStore.getState().nudgeBuildPreview('RIGHT');

      const [x, z] = useGameStore.getState().buildMode.pointer;
      // Exactly one coordinate moved, by exactly one cell.
      expect(Math.abs(x - 10) + Math.abs(z - 10), `çeyrek ${turn}`).toBe(1);
      useGameStore.getState().exitBuildMode();
    }
  });

  it('sends a structure the way the arrow points however the camera is turned', () => {
    // Emre, 2026-09-10: "arka kamera açısında sola basınca sağa gidiyor" —
    // the keys were calibrated to the default framing and never turned with
    // the view, so each rotation had to be relearned by trial and error.
    const wanted = {
      LEFT: (s: { right: number }) => s.right < 0,
      RIGHT: (s: { right: number }) => s.right > 0,
      UP: (s: { up: number }) => s.up > 0,
      DOWN: (s: { up: number }) => s.up < 0
    } as const;

    for (let turn = 0; turn < 4; turn++) {
      const angle = (DEFAULT_CAMERA_ANGLE + turn * 90) % 360;

      for (const direction of ['LEFT', 'RIGHT', 'UP', 'DOWN'] as const) {
        useGameStore.setState({ cameraAngle: angle });
        useGameStore.getState().enterBuildMode('trash_can');
        useGameStore.getState().pinBuildPreviewAt([10, 10]);

        useGameStore.getState().nudgeBuildPreview(direction);

        const [x, z] = useGameStore.getState().buildMode.pointer;
        const screen = onScreen([x - 10, z - 10], angle);
        expect(wanted[direction](screen), `${direction} @ ${angle}° → ${JSON.stringify(screen)}`).toBe(true);
        useGameStore.getState().exitBuildMode();
      }
    }
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
