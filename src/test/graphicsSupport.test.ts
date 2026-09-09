import { describe, it, expect } from 'vitest';
import { isSoftwareRenderer, probeWebGL2 } from '../services/graphicsSupport';

/**
 * Emre, 2026-09-09: a card instead of a black screen. The probe itself
 * needs a browser; what can be pinned here is that it never throws where
 * there is no document, and that software rasterisers are recognised.
 */
describe('graphics support', () => {
  it('reports support where there is no document at all', () => {
    expect(probeWebGL2().supported).toBe(true);
  });

  it('knows a software renderer by its name', () => {
    expect(isSoftwareRenderer('Google SwiftShader')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Apple, Apple M1, OpenGL 4.1)')).toBe(false);
    expect(isSoftwareRenderer(null)).toBe(false);
  });
});
