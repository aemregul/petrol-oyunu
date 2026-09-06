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
 *
 * Sizing. Both packs are stylised: a sedan is drawn about a third wider than a
 * real one, and some bodies are downright stubby (the RgsDev lorry is only
 * 1.6× as long as it is wide; a real one is 3×). Fitting every model by its
 * real length alone therefore blows the stubby ones up sideways — the lorry
 * came out 4.3 m wide and taller than the bus. Each target length below is
 * instead the geometric mean of two fits against the pack's own sedan: real
 * length (4.7 m ≈ 3.7 units) and real width (1.85 m ≈ 2.0 units). That keeps
 * the road's pecking order honest — hatchback < sedan < SUV < van < ambulance
 * < lorry < fire engine < limousine < bus < artic — without any one body
 * swelling out of proportion. The three giants keep the lengths the docking
 * and driving tests were tuned to.
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
  /** Widens a source body that is drawn too slender for the road, on top of the length fit. */
  widthScale?: number;
  /** A flashing red-and-blue bar on the roof: a black-and-white on a black road needs one. */
  beacon?: boolean;
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
  // Passenger cars, 4.3–4.9 m in life.
  hatchback: rgsdev('hatchback', 3.45),
  sedan: rgsdev('sedan', 3.7),
  taxi: rgsdev('taxi', 3.7),
  suv: rgsdev('suv', 3.8),
  roadster: rgsdev('roadster', 3.8),
  sports: rgsdev('sports', 4.0),
  muscle: rgsdev('muscle', 4.1),
  'muscle-2': rgsdev('muscle-2', 4.1),
  // Light commercials, 5.5–6 m.
  pickup: rgsdev('pickup', 4.25),
  van: rgsdev('van', 4.5),
  ambulance: rgsdev('ambulance', 4.85),
  // The lorry model is stubby; 5.0 is as long as it gets before it turns
  // into a cube wider than the bus.
  truck: rgsdev('truck', 5.0),
  // Wide, tall and short in life too.
  'monster-truck': rgsdev('monster-truck', 3.9),
  // The pack's limousine is drawn long but slight; on the forecourt it read as
  // a thin sedan, so it is stretched to a real stretch-limo length and widened.
  limousine: { ...rgsdev('limousine', 8.6), widthScale: 1.25 },
  // The giants keep the lengths the docking and driving tests were tuned to.
  firetruck: {
    ...rgsdev('firetruck', 7.4),
    wheelScale: 1.4,
    wheelTrackScale: 1.2
  },
  bus: rgsdev('bus', 9.4),
  'truck-with-trailer': rgsdev('truck-with-trailer', 10),
  // Police cars: sized as their civilian twins, plus the beacon.
  'police-sedan': { ...rgsdev('police-sedan', 3.85), beacon: true },
  'police-suv': { ...rgsdev('police-suv', 3.8), beacon: true },
  'police-sports': { ...rgsdev('police-sports', 4.0), beacon: true },
  'police-muscle': { ...rgsdev('police-muscle', 4.1), beacon: true },

  // Kenney bodies are chunkier (taller and wider for their length), so the
  // same real-world fit lands them a touch shorter than their RgsDev twins.
  // Blue on the truck is the one tint kept: it separates it from the green
  // delivery van.
  'kenney-sedan': kenney('sedan', 3.55),
  'kenney-taxi': kenney('taxi', 3.7),
  'kenney-sedan-sports': kenney('sedan-sports', 3.75),
  'kenney-hatchback-sports': kenney('hatchback-sports', 3.8),
  'kenney-suv': kenney('suv', 3.8),
  'kenney-suv-luxury': kenney('suv-luxury', 4.0),
  'kenney-van': kenney('van', 4.2),
  'kenney-delivery': kenney('delivery', 4.95),
  'kenney-truck': kenney('truck', 5.3, '#3b82f6')
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
