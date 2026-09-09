import { VehicleEntity } from '../types/gameState';

/**
 * Half-extents in simulation grid units. Rendering doubles grid coordinates,
 * so a regular 0.9-long car becomes roughly 3.6 scene units nose to tail.
 *
 * Kendi dosyasında, çünkü motor da planlayıcı da aynı ölçüyü okur: motor
 * gövde kuralında (bodyInSolid), planlayıcı dönüş payında — otobüs bir binek
 * gibi 1.1 payla dönemez, kuyruğu yanındaki tank sahasına giriyordu (Emre,
 * 2026-09-09).
 */
export function vehicleBodyHalfExtents(
  vehicle: Pick<VehicleEntity, 'archetype' | 'modelVariant'>
): { length: number; width: number } {
  switch (vehicle.modelVariant) {
    case 'truck-with-trailer':
      return { length: 2.15, width: 0.55 };
    case 'bus':
      return { length: 2.05, width: 0.55 };
    case 'firetruck':
      return { length: 1.9, width: 0.62 };
    case 'limousine':
      return { length: 2.15, width: 0.58 };
    case 'ambulance':
      return { length: 1.38, width: 0.55 };
    case 'van':
      return { length: 1.12, width: 0.48 };
    case 'truck':
      return { length: 1.12, width: 0.52 };
    case 'monster-truck':
      return { length: 1.05, width: 0.68 };
    default:
      if (vehicle.archetype === 'truck') return { length: 1.12, width: 0.52 };
      if (vehicle.archetype === 'bus') return { length: 2.05, width: 0.55 };
      if (vehicle.archetype === 'ambulance') return { length: 1.38, width: 0.55 };
      if (vehicle.archetype === 'firetruck') return { length: 1.9, width: 0.62 };
      return { length: 0.9, width: 0.43 };
  }
}
