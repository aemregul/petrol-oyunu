import { describe, it, expect, vi } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import {
  createEffects,
  runSimulationTick,
  vehicleBodyHalfExtents
} from '../domain/services/simulationEngine';
import { GameState, VehicleEntity } from '../domain/types/gameState';

/**
 * Emre, 2026-09-10, ekran görüntüsü: tanker önalanın ortasında bir hatchback
 * ile bir SUV'un İÇİNDEN geçiyor. "Araçlarda bulunan özellikler tankerde yok
 * gibi, çünkü fren yapmıyor."
 *
 * Haklıydı: tanker fren mesafesini kendi merkezinden ölçüyordu, oysa gövdesi
 * merkezinden iki birim ileri uzanıyor — yani baktığı yer kendi tamponunun
 * çoktan gerisindeydi. Bu dosya sayıyı çivilerler: hiçbir tanker gövdesi
 * hiçbir müşteri gövdesinin içine girmez.
 */

/** A box in the plan, as the game draws it: centre, heading, half-extents. */
interface Box {
  x: number;
  z: number;
  heading: number;
  halfLength: number;
  halfWidth: number;
}

function axes(box: Box): Array<{ x: number; z: number }> {
  const ahead = { x: Math.sin(box.heading), z: Math.cos(box.heading) };
  return [ahead, { x: ahead.z, z: -ahead.x }];
}

function cornersOf(box: Box): Array<[number, number]> {
  const [ahead, across] = axes(box);
  const out: Array<[number, number]> = [];
  for (const along of [-box.halfLength, box.halfLength]) {
    for (const side of [-box.halfWidth, box.halfWidth]) {
      out.push([box.x + ahead.x * along + across.x * side, box.z + ahead.z * along + across.z * side]);
    }
  }
  return out;
}

/**
 * How deep two bodies are inside each other, in grid units (0 = clear).
 * Separating-axis test: the shallowest overlap across the four box axes is
 * how far one would have to be pushed to be clear of the other.
 */
function penetration(a: Box, b: Box): number {
  let shallowest = Infinity;
  for (const axis of [...axes(a), ...axes(b)]) {
    const project = (box: Box) => {
      const values = cornersOf(box).map(([x, z]) => x * axis.x + z * axis.z);
      return { min: Math.min(...values), max: Math.max(...values) };
    };
    const pa = project(a);
    const pb = project(b);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return 0;
    shallowest = Math.min(shallowest, overlap);
  }
  return shallowest;
}

/**
 * The lorry as it is drawn: chassis from -4.4 to +3.2 scene units, cab bumper
 * out to +3.95, 2.2 wide — halved, because the scene draws grid units double.
 */
const TRUCK_BOX = { halfLength: 2.09, halfWidth: 0.55, offset: -0.11 };

function truckBox(truck: NonNullable<GameState['fuelOrders'][number]['truck']>): Box {
  return {
    x: truck.worldPosition[0] + Math.sin(truck.heading) * TRUCK_BOX.offset,
    z: truck.worldPosition[2] + Math.cos(truck.heading) * TRUCK_BOX.offset,
    heading: truck.heading,
    halfLength: TRUCK_BOX.halfLength,
    halfWidth: TRUCK_BOX.halfWidth
  };
}

function carBox(vehicle: VehicleEntity): Box {
  const body = vehicleBodyHalfExtents(vehicle);
  return {
    x: vehicle.worldPosition[0],
    z: vehicle.worldPosition[2],
    heading: vehicle.heading,
    halfLength: body.length,
    halfWidth: body.width
  };
}

/** A busy trading day with lorries turning up all through it. */
function busyStation(): GameState {
  const state = createInitialGameState();
  state.dayState.timeSpeed = 1;
  state.player.level = 20;
  state.player.reputation = 5;
  state.player.cash = 9_000_000;
  state.pricing.gasoline.playerPrice = state.pricing.gasoline.regionalAverage * 0.7;
  state.pricing.diesel.playerPrice = state.pricing.diesel.regionalAverage * 0.7;
  return state;
}

function orderFuel(state: GameState, id: string, fuelType: string): void {
  state.fuelOrders.push({
    id,
    fuelType,
    liters: 600,
    pricePerLiter: 36,
    unitCost: 36,
    totalCost: 21600,
    supplierId: 'sup_1',
    state: 'TRAVELLING',
    remainingSeconds: 0.1,
    truck: null
  } as never);
}

describe('the delivery lorry brakes like everything else on the plot', () => {
  it('never drives its body through a customer car', () => {
    let value = 11 >>> 0;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      value = (value * 1664525 + 1013904223) % 4294967296;
      return value / 4294967296;
    });

    try {
      const state = busyStation();
      const effects = createEffects();

      let worst = 0;
      let worstNote = '';
      let overlapTicks = 0;
      let truckTicks = 0;

      for (let i = 0; i < 24000; i++) {
        if (i % 1200 === 0) {
          orderFuel(state, `order_${i}`, i % 2400 === 0 ? 'gasoline' : 'diesel');
        }
        runSimulationTick(state, 0.05, effects);

        for (const order of state.fuelOrders) {
          const truck = order.truck;
          if (!truck) continue;
          truckTicks++;
          const lorry = truckBox(truck);

          for (const vehicle of Object.values(state.vehicles)) {
            const depth = penetration(lorry, carBox(vehicle));
            if (depth <= 0) continue;
            overlapTicks++;
            if (depth > worst) {
              worst = depth;
              worstNote =
                `${depth.toFixed(2)} derin, tick ${i}: ${order.fuelType} tankeri ` +
                `${truck.worldPosition[0].toFixed(1)},${truck.worldPosition[2].toFixed(1)} ` +
                `(${truck.phase}) <- ${vehicle.state} ${vehicle.archetype} ` +
                `${vehicle.worldPosition[0].toFixed(1)},${vehicle.worldPosition[2].toFixed(1)}`;
            }
          }
        }
      }

      // The delivery has to have actually driven, or the counts pass by default.
      expect(truckTicks).toBeGreaterThan(2000);
      expect({ worst: Number(worst.toFixed(2)), overlapTicks, worstNote }).toEqual({
        worst: 0,
        overlapTicks: 0,
        worstNote: ''
      });
    } finally {
      spy.mockRestore();
    }
  });
});
