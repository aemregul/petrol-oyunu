/**
 * Maps build-catalogue entries onto Kenney models (CC0).
 *
 * Anything the kits do not cover — the pump, the canopy, the price totem —
 * stays hand-built, because those pieces define the station's silhouette and
 * no off-the-shelf CC0 model fits them.
 *
 * Each kit ships its own `Textures/colormap.png`, so kits live in separate
 * folders; merging them would make one kit's texture overwrite the other's.
 */

export type ModelFit =
  /** Scale so the model fills its grid footprint. */
  | 'footprint'
  /** Scale to a target height, ignoring the footprint (poles, signs). */
  | 'height';

export interface BuildingModelConfig {
  url: string;
  fit: ModelFit;
  /** Required when fit is 'height'; world units. */
  targetHeight?: number;
  /** Caps how tall a footprint-fitted model may become, in world units. */
  maxHeight?: number;
  /** Extra turn applied after the entity's own rotation, in degrees. */
  rotationOffset?: number;
  tint?: string;
}

const COMMERCIAL = '/models/buildings/commercial';
const ROADS = '/models/buildings/roads';
const FACTORY = '/models/buildings/factory';

export const BUILDING_MODELS: Record<string, BuildingModelConfig> = {
  // building-k is the kit's wide low-rise: it reads as an office block rather
  // than an apartment tower once scaled into a 4x4 plot.
  office: {
    url: `${COMMERCIAL}/building-k.glb`,
    fit: 'footprint',
    maxHeight: 10
  },
  // building-e is the flattest, widest model in the kit — the right shape for
  // a forecourt shop.
  mini_market: {
    url: `${COMMERCIAL}/building-e.glb`,
    fit: 'footprint',
    maxHeight: 5.5
  },
  toilet: {
    url: `${COMMERCIAL}/building-c.glb`,
    fit: 'footprint',
    maxHeight: 4
  },
  cafe: {
    url: `${COMMERCIAL}/building-d.glb`,
    fit: 'footprint',
    maxHeight: 5
  },
  hotel: {
    url: `${COMMERCIAL}/building-n.glb`,
    fit: 'footprint',
    maxHeight: 11
  },
  trash_can: {
    url: `${ROADS}/dumpster.glb`,
    fit: 'height',
    targetHeight: 1.6
  }
};

export const BUILDING_MODEL_URLS = Object.values(BUILDING_MODELS).map((m) => m.url);

export function hasBuildingModel(type: string): boolean {
  return type in BUILDING_MODELS;
}
