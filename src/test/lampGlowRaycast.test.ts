import { describe, it, expect, vi } from 'vitest';
import React from 'react';

// The glow's falloff texture is painted on a canvas; there is no browser here,
// so a canvas that accepts the calls and draws nothing stands in for it.
vi.stubGlobal('document', {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop: () => undefined }),
      fillStyle: null,
      fillRect: () => undefined
    })
  })
});

import { LampGlow } from '../rendering/LampGlow';

/**
 * Emre, 2026-09-09: "boş arsaya tıkladığımda sürekli aydınlatma direği paneli
 * açılıyor… bazen çok sorunsuz çalışıyor". The lamp's light pool is a plane a
 * dozen units across, drawn inside the pole's click group once the lamps come
 * on at night. It caught every click on the apron — the pole's panel opened —
 * and swallowed every pointer move meant for the ground, so the build preview
 * froze and nothing could be paved or placed. By day the glow is not drawn,
 * and everything worked. Light takes no part in raycasting, ever.
 */

/** Every <mesh>/<sprite> element in a React element tree. */
function pickables(node: React.ReactNode, out: React.ReactElement[] = []): React.ReactElement[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) pickables(child, out);
    return out;
  }
  const el = node as React.ReactElement<{ children?: React.ReactNode }>;
  if (el.type === 'mesh' || el.type === 'sprite') out.push(el);
  pickables(el.props?.children, out);
  return out;
}

describe('a lamp’s glow', () => {
  it('is drawn but cannot be clicked or hovered', () => {
    const tree = LampGlow({ position: [1.15, 7.05, 0], reach: 6, lit: true }) as React.ReactElement;
    const parts = pickables(tree);
    // Pool, shaft and flare.
    expect(parts.length).toBe(3);
    for (const part of parts) {
      const raycast = (part.props as { raycast?: unknown }).raycast;
      expect(typeof raycast, `${String(part.type)} has no raycast override`).toBe('function');
      expect((raycast as () => unknown)()).toBeNull();
    }
  });

  it('is not drawn at all while the lamp is off', () => {
    expect(LampGlow({ position: [0, 7, 0], reach: 6, lit: false })).toBeNull();
  });
});
