/**
 * Project Highway - Employee State Machine
 * GDD Section 26.2:
 * UNASSIGNED > IDLE > SELECT_JOB > MOVING > PREPARE > FUELING > PAYMENT > RETURN_IDLE
 */

import { EmployeeState } from '../types/gameState';

const VALID_EMPLOYEE_TRANSITIONS: Record<EmployeeState, EmployeeState[]> = {
  UNASSIGNED: ['IDLE'],
  IDLE: ['SELECT_JOB', 'UNASSIGNED'],
  SELECT_JOB: ['MOVING', 'IDLE', 'UNASSIGNED'],
  MOVING: ['PREPARE', 'IDLE', 'UNASSIGNED'],
  PREPARE: ['FUELING', 'IDLE'],
  FUELING: ['PAYMENT', 'IDLE'],
  PAYMENT: ['RETURN_IDLE', 'IDLE'],
  RETURN_IDLE: ['IDLE', 'SELECT_JOB', 'UNASSIGNED']
};

export class EmployeeStateMachine {
  public static canTransition(current: EmployeeState, next: EmployeeState): boolean {
    const allowed = VALID_EMPLOYEE_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  public static transition(
    employeeId: string,
    current: EmployeeState,
    next: EmployeeState
  ): { success: boolean; state: EmployeeState; error?: string } {
    if (!this.canTransition(current, next)) {
      const errorMsg = `[Employee ${employeeId}] Geçersiz çalışan durum geçişi: ${current} -> ${next}`;
      console.warn(errorMsg);
      return { success: false, state: current, error: errorMsg };
    }
    return { success: true, state: next };
  }
}
