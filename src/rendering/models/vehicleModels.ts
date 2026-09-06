/**
 * RgsDev Free Low Poly Vehicles Pack.
 * Source: https://opengameart.org/content/free-low-poly-vehicles-pack
 * License: CC0 1.0 — the original license text is kept beside the assets.
 */

import { VehicleArchetype, VehicleModelVariant } from '../../domain/types/gameState';

export interface VehicleModelConfig {
  url: string;
  /** Desired nose-to-tail size in Three.js scene units. */
  targetLength: number;
  /** Asset-specific correction when the source wheel diameter is undersized. */
  wheelScale?: number;
  /** Pushes wheels out from underneath an overly wide source body. */
  wheelTrackScale?: number;
}

const MODEL_BASE = '/models/vehicles/rgsdev';

export const VEHICLE_MODELS: Record<VehicleModelVariant, VehicleModelConfig> = {
  sedan: { url: `${MODEL_BASE}/sedan.fbx`, targetLength: 3.7 },
  hatchback: { url: `${MODEL_BASE}/hatchback.fbx`, targetLength: 3.55 },
  suv: { url: `${MODEL_BASE}/suv.fbx`, targetLength: 3.7 },
  taxi: { url: `${MODEL_BASE}/taxi.fbx`, targetLength: 3.7 },
  van: { url: `${MODEL_BASE}/van.fbx`, targetLength: 4.15 },
  pickup: { url: `${MODEL_BASE}/pickup.fbx`, targetLength: 3.8 },
  truck: { url: `${MODEL_BASE}/truck.fbx`, targetLength: 5.4 },
  'truck-with-trailer': { url: `${MODEL_BASE}/truck-with-trailer.fbx`, targetLength: 10 },
  sports: { url: `${MODEL_BASE}/sports.fbx`, targetLength: 3.9 },
  roadster: { url: `${MODEL_BASE}/roadster.fbx`, targetLength: 3.9 },
  muscle: { url: `${MODEL_BASE}/muscle.fbx`, targetLength: 4.15 },
  'muscle-2': { url: `${MODEL_BASE}/muscle-2.fbx`, targetLength: 4.15 },
  limousine: { url: `${MODEL_BASE}/limousine.fbx`, targetLength: 7 },
  'police-sedan': { url: `${MODEL_BASE}/police-sedan.fbx`, targetLength: 3.75 },
  'police-suv': { url: `${MODEL_BASE}/police-suv.fbx`, targetLength: 3.7 },
  'police-sports': { url: `${MODEL_BASE}/police-sports.fbx`, targetLength: 3.9 },
  'police-muscle': { url: `${MODEL_BASE}/police-muscle.fbx`, targetLength: 4.15 },
  ambulance: { url: `${MODEL_BASE}/ambulance.fbx`, targetLength: 5.4 },
  firetruck: {
    url: `${MODEL_BASE}/firetruck.fbx`,
    targetLength: 7.4,
    wheelScale: 1.4,
    wheelTrackScale: 1.2
  },
  bus: { url: `${MODEL_BASE}/bus.fbx`, targetLength: 9.4 },
  'monster-truck': { url: `${MODEL_BASE}/monster-truck.fbx`, targetLength: 4.25 }
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
