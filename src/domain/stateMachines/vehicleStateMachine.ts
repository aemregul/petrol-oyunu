/**
 * Project Highway - Vehicle State Machine
 * GDD Section 12.2 & 26:
 * SPAWN > PASSING > DESPAWN, or SPAWN > ROAD_APPROACH > QUEUE > PUMP_RESERVED > AT_PUMP > REQUEST > FUELING > PAYMENT > OPTIONAL_SHOP > EXIT > DESPAWN
 */

import { VehicleState } from '../types/gameState';

const VALID_VEHICLE_TRANSITIONS: Record<VehicleState, VehicleState[]> = {
  SPAWN: ['ROAD_APPROACH', 'PASSING', 'DESPAWN'],
  // Through traffic joins the road and leaves it again without ever stopping.
  PASSING: ['DESPAWN'],
  // A driver who came for the shop rather than the pumps skips the forecourt
  // queue entirely — there is nothing on this block to queue for.
  // A driver who finds the forecourt full before committing to the mouth
  // simply carries on down the road.
  ROAD_APPROACH: ['QUEUE', 'PUMP_RESERVED', 'OPTIONAL_SHOP', 'TO_PARK', 'PASSING', 'EXIT', 'DESPAWN'],
  QUEUE: ['PUMP_RESERVED', 'EXIT', 'DESPAWN'],
  PUMP_RESERVED: ['AT_PUMP', 'EXIT', 'DESPAWN'],
  // A charged car is served where it stands, so it leaves for the shop from here.
  AT_PUMP: ['REQUEST', 'OPTIONAL_SHOP', 'TO_PARK', 'EXIT', 'DESPAWN'],
  REQUEST: ['FUELING', 'EXIT', 'DESPAWN'],
  // A charged car settles up where it stands, so it leaves for the shop or
  // the park straight from here.
  FUELING: ['PAYMENT', 'OPTIONAL_SHOP', 'TO_PARK', 'EXIT', 'DESPAWN'],
  // Paid up: off to the park, a visit booked on the spot, or — the driver
  // leaving the car at the pump — straight into the visit.
  PAYMENT: ['OPTIONAL_SHOP', 'TO_PARK', 'VISITING', 'EXIT', 'DESPAWN'],
  OPTIONAL_SHOP: ['EXIT', 'DESPAWN'],
  TO_PARK: ['VISITING', 'EXIT', 'DESPAWN'],
  VISITING: ['EXIT', 'DESPAWN'],
  EXIT: ['DESPAWN'],
  DESPAWN: []
};

export class VehicleStateMachine {
  public static canTransition(current: VehicleState, next: VehicleState): boolean {
    const allowed = VALID_VEHICLE_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  public static transition(
    vehicleId: string,
    current: VehicleState,
    next: VehicleState
  ): { success: boolean; state: VehicleState; error?: string } {
    if (!this.canTransition(current, next)) {
      const errorMsg = `[Vehicle ${vehicleId}] Geçersiz araç durum geçişi: ${current} -> ${next}`;
      console.warn(errorMsg);
      return { success: false, state: current, error: errorMsg };
    }
    return { success: true, state: next };
  }
}
