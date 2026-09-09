/**
 * Whether this browser can draw the game at all (Emre, 2026-09-09: an old
 * card used to get a black screen and no word why).
 *
 * The scene is WebGL 2 — three.js r170 draws nothing else — so the one
 * question is whether a WebGL 2 context can be had. Asked once, on a
 * throwaway canvas, before the scene is mounted; the renderer string is
 * kept so a software fallback (SwiftShader, llvmpipe) can be named rather
 * than blamed on the game.
 */

export interface GraphicsProbe {
  supported: boolean;
  renderer: string | null;
  /** A software rasteriser: it works, slowly. */
  software: boolean;
}

export function probeWebGL2(): GraphicsProbe {
  if (typeof document === 'undefined') return { supported: true, renderer: null, software: false };
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { supported: false, renderer: null, software: false };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { supported: true, renderer, software: isSoftwareRenderer(renderer) };
  } catch {
    return { supported: false, renderer: null, software: false };
  }
}

export function isSoftwareRenderer(renderer: string | null): boolean {
  if (!renderer) return false;
  return /swiftshader|llvmpipe|software|microsoft basic render/i.test(renderer);
}
