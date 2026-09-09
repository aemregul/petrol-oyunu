import { describe, it, expect, vi } from 'vitest';
import { resizeShadowMap, type ResizableShadow } from '../rendering/SceneLighting';

/**
 * Emre, 2026-09-09: "yüksek ayarda bu gölge bozulmalarına bak". Switching
 * Orta → Yüksek in play left the sun's 1024 shadow texture in place while the
 * depth pass drew at 2048 into it, so every shadow landed scaled away from
 * the caster as long dark streaks on the grass. The map has to be dropped
 * whenever its size changes, and only then.
 */
function shadowWith(map: { width: number; height: number } | null, size = 1024): ResizableShadow & { dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn();
  return {
    dispose,
    mapSize: {
      x: size,
      y: size,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      }
    },
    map: map ? { ...map, dispose } : null
  };
}

describe('the sun’s shadow map', () => {
  it('drops a live map of the wrong size so three rebuilds it', () => {
    const shadow = shadowWith({ width: 1024, height: 1024 });
    expect(resizeShadowMap(shadow, 2048)).toBe(true);
    expect(shadow.map).toBeNull();
    expect(shadow.dispose).toHaveBeenCalledTimes(1);
    expect([shadow.mapSize.x, shadow.mapSize.y]).toEqual([2048, 2048]);
  });

  it('drops it the other way too, Yüksek → Orta', () => {
    const shadow = shadowWith({ width: 2048, height: 2048 }, 2048);
    expect(resizeShadowMap(shadow, 1024)).toBe(true);
    expect(shadow.map).toBeNull();
  });

  it('leaves a map of the right size alone', () => {
    const shadow = shadowWith({ width: 2048, height: 2048 }, 2048);
    expect(resizeShadowMap(shadow, 2048)).toBe(false);
    expect(shadow.map).not.toBeNull();
    expect(shadow.dispose).not.toHaveBeenCalled();
  });

  it('only sets the size when there is no map yet', () => {
    const shadow = shadowWith(null);
    expect(resizeShadowMap(shadow, 2048)).toBe(false);
    expect(shadow.map).toBeNull();
    expect(shadow.mapSize.x).toBe(2048);
  });
});
