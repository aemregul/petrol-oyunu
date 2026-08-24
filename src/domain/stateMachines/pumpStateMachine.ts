/**
 * Project Highway - Pump State Machine
 * GDD Section 26.1: IDLE > RESERVED > VEHICLE_ARRIVING > REQUEST_READY > FUELING > PAYMENT > RELEASE > IDLE
 */

import { PumpState } from '../types/gameState';

const VALID_PUMP_TRANSITIONS: Record<PumpState, PumpState[]> = {
  IDLE: ['RESERVED', 'MAINTENANCE', 'BROKEN'],
  RESERVED: ['VEHICLE_ARRIVING', 'IDLE', 'BROKEN'],
  VEHICLE_ARRIVING: ['REQUEST_READY', 'IDLE', 'BROKEN'],
  REQUEST_READY: ['FUELING', 'RELEASE', 'IDLE', 'BROKEN'],
  FUELING: ['PAYMENT', 'RELEASE', 'BROKEN'],
  PAYMENT: ['RELEASE', 'IDLE', 'BROKEN'],
  RELEASE: ['IDLE', 'MAINTENANCE', 'BROKEN'],
  MAINTENANCE: ['IDLE'],
  BROKEN: ['MAINTENANCE', 'IDLE']
};

export class PumpStateMachine {
  public static canTransition(current: PumpState, next: PumpState): boolean {
    const allowed = VALID_PUMP_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  public static transition(
    pumpId: string,
    current: PumpState,
    next: PumpState
  ): { success: boolean; state: PumpState; error?: string } {
    if (!this.canTransition(current, next)) {
      const errorMsg = `[Pump ${pumpId}] Geçersiz durum geçişi: ${current} -> ${next}`;
      console.warn(errorMsg);
      return { success: false, state: current, error: errorMsg };
    }
    return { success: true, state: next };
  }
}
