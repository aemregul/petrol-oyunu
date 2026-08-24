/**
 * Project Highway - Fuel Order / Tanker State Machine
 * GDD Section 11.4 & 26.3:
 * CREATED > PAID > TRAVELLING > QUEUED_AT_GATE > UNLOADING > COMPLETED > EXITED
 */

import { OrderState } from '../types/gameState';

const VALID_ORDER_TRANSITIONS: Record<OrderState, OrderState[]> = {
  TRAVELLING: ['QUEUED_AT_GATE', 'COMPLETED'],
  QUEUED_AT_GATE: ['UNLOADING'],
  UNLOADING: ['COMPLETED'],
  COMPLETED: []
};

export class OrderStateMachine {
  public static canTransition(current: OrderState, next: OrderState): boolean {
    const allowed = VALID_ORDER_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  public static transition(
    orderId: string,
    current: OrderState,
    next: OrderState
  ): { success: boolean; state: OrderState; error?: string } {
    if (!this.canTransition(current, next)) {
      const errorMsg = `[FuelOrder ${orderId}] Geçersiz sipariş durum geçişi: ${current} -> ${next}`;
      console.warn(errorMsg);
      return { success: false, state: current, error: errorMsg };
    }
    return { success: true, state: next };
  }
}
