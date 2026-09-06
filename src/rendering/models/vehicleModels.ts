/**
 * Two CC0 vehicle packs share the road.
 *
 * RgsDev Free Low Poly Vehicles Pack (FBX).
 * Source: https://opengameart.org/content/free-low-poly-vehicles-pack
 * License: CC0 1.0 — the original license text is kept beside the assets.
 *
 * Kenney Car Kit (GLB). The kit ships one material per model driven by a
 * shared colour-atlas texture, so bodies are recoloured by tinting that
 * material rather than by assigning a flat colour. Wheels are separate named
 * nodes, which is what lets them spin.
 */

import { VehicleArchetype, VehicleModelVariant } from '../../domain/types/gameState';

export interface VehicleModelConfig {
  url: string;
  /** Which loader reads the file; the packs are not interchangeable. */
  format: 'fbx' | 'glb';
  /** Desired nose-to-tail size in Three.js scene units. */
  targetLength: number;
  /** Asset-specific correction when the source wheel diameter is undersized. */
  wheelScale?: number;
  /** Pushes wheels out from underneath an overly wide source body. */
  wheelTrackScale?: number;
  /** Multiplied over the Kenney atlas texture; absent keeps the kit's livery. */
  tint?: string;
}

const RGSDEV_BASE = '/models/vehicles/rgsdev';
const KENNEY_BASE = '/models/vehicles';

function rgsdev(file: string, targetLength: number): VehicleModelConfig {
  return { url: `${RGSDEV_BASE}/${file}.fbx`, format: 'fbx', targetLength };
}

function kenney(file: string, targetLength: number, tint?: string): VehicleModelConfig {
  return { url: `${KENNEY_BASE}/${file}.glb`, format: 'glb', targetLength, tint };
}

export const VEHICLE_MODELS: Record<VehicleModelVariant, VehicleModelConfig> = {
  sedan: rgsdev('sedan', 3.7),
  hatchback: rgsdev('hatchback', 3.55),
  suv: rgsdev('suv', 3.7),
  taxi: rgsdev('taxi', 3.7),
  van: rgsdev('van', 4.15),
  pickup: rgsdev('pickup', 3.8),
  truck: rgsdev('truck', 5.4),
  'truck-with-trailer': rgsdev('truck-with-trailer', 10),
  sports: rgsdev('sports', 3.9),
  roadster: rgsdev('roadster', 3.9),
  muscle: rgsdev('muscle', 4.15),
  'muscle-2': rgsdev('muscle-2', 4.15),
  limousine: rgsdev('limousine', 7),
  'police-sedan': rgsdev('police-sedan', 3.75),
  'police-suv': rgsdev('police-suv', 3.7),
  'police-sports': rgsdev('police-sports', 3.9),
  'police-muscle': rgsdev('police-muscle', 4.15),
  ambulance: rgsdev('ambulance', 5.4),
  firetruck: {
    ...rgsdev('firetruck', 7.4),
    wheelScale: 1.4,
    wheelTrackScale: 1.2
  },
  bus: rgsdev('bus', 9.4),
  'monster-truck': rgsdev('monster-truck', 4.25),

  // The Kenney sizes match what the kit's old uniform scale produced, so the
  // cars the player already knows do not shrink or grow on the merge. Blue on
  // the truck is the one tint kept: it separates it from the green delivery.
  'kenney-sedan': kenney('sedan', 3.6),
  'kenney-suv': kenney('suv', 3.7),
  'kenney-taxi': kenney('taxi', 3.6),
  'kenney-van': kenney('van', 3.9),
  'kenney-delivery': kenney('delivery', 4.0),
  'kenney-truck': kenney('truck', 5.1, '#3b82f6'),
  'kenney-suv-luxury': kenney('suv-luxury', 3.8),
  'kenney-sedan-sports': kenney('sedan-sports', 3.7),
  'kenney-hatchback-sports': kenney('hatchback-sports', 3.5)
};

export const DEFAULT_VEHICLE_MODEL: Record<VehicleArchetype, VehicleModelVariant> = {
  commuter: 'sedan',
  family: 'suv',
  taxi: 'taxi',
  courier: 'hatchback',
  commercial: 'van',
  truck: 'truck',
  luxury: 'sports',
  ev: 'hatchback',
  police: 'police-sedan',
  ambulance: 'ambulance',
  firetruck: 'firetruck',
  bus: 'bus',
  monster: 'monster-truck'
};

export const VEHICLE_MODEL_URLS = Object.values(VEHICLE_MODELS).map((model) => model.url);
