/**
 * Project Highway - Vehicle State Machine
 * GDD Section 12.2 & 26:
 * SPAWN > ROAD_APPROACH > QUEUE > PUMP_RESERVED > AT_PUMP > REQUEST > FUELING > PAYMENT > OPTIONAL_SHOP > EXIT > DESPAWN
 */

import { VehicleState } from '../types/gameState';

const VALID_VEHICLE_TRANSITIONS: Record<VehicleState, VehicleState[]> = {
  SPAWN: ['ROAD_APPROACH', 'DESPAWN'],
  ROAD_APPROACH: ['QUEUE', 'PUMP_RESERVED', 'EXIT', 'DESPAWN'],
  QUEUE: ['PUMP_RESERVED', 'EXIT', 'DESPAWN'],
  PUMP_RESERVED: ['AT_PUMP', 'EXIT', 'DESPAWN'],
  AT_PUMP: ['REQUEST', 'EXIT', 'DESPAWN'],
  REQUEST: ['FUELING', 'EXIT', 'DESPAWN'],
  FUELING: ['PAYMENT', 'EXIT', 'DESPAWN'],
  PAYMENT: ['OPTIONAL_SHOP', 'EXIT', 'DESPAWN'],
  OPTIONAL_SHOP: ['EXIT', 'DESPAWN'],
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
