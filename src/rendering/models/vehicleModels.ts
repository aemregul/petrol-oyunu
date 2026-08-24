/**
 * Maps each customer archetype onto a Kenney Car Kit model (CC0).
 *
 * The kit ships one material per model driven by a shared colour-atlas
 * texture, so bodies are recoloured by tinting that material rather than by
 * assigning a flat colour. Wheels are separate named nodes, which is what
 * lets them spin.
 */

import { VehicleArchetype } from '../../domain/types/gameState';

export interface VehicleModelConfig {
  /** Path under public/. */
  url: string;
  /** Uniform scale to bring the kit's ~2.5 unit body up to our road scale. */
  scale: number;
  /** Multiplied over the atlas texture; null keeps the kit's own livery. */
  tint: string | null;
}

const MODEL_BASE = '/models/vehicles';

export const VEHICLE_MODELS: Record<VehicleArchetype, VehicleModelConfig> = {
  // Every model keeps the kit's own livery. Blue is the single exception,
  // used only to separate the two green models that would otherwise be hard
  // to tell apart on the forecourt.
  commuter: { url: `${MODEL_BASE}/sedan.glb`, scale: 1.45, tint: null },
  family: { url: `${MODEL_BASE}/suv.glb`, scale: 1.45, tint: null },
  taxi: { url: `${MODEL_BASE}/taxi.glb`, scale: 1.45, tint: null },
  courier: { url: `${MODEL_BASE}/van.glb`, scale: 1.4, tint: null },
  commercial: { url: `${MODEL_BASE}/delivery.glb`, scale: 1.45, tint: null },
  truck: { url: `${MODEL_BASE}/truck.glb`, scale: 1.6, tint: '#3b82f6' },
  luxury: { url: `${MODEL_BASE}/suv-luxury.glb`, scale: 1.45, tint: null },
  // Electric cars get a distinct silhouette and a cool white body so they
  // never read as one of the combustion archetypes.
  ev: { url: `${MODEL_BASE}/hatchback-sports.glb`, scale: 1.45, tint: '#e8f4ff' }
};

export const VEHICLE_MODEL_URLS = Object.values(VEHICLE_MODELS).map((m) => m.url);
