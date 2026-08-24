import { describe, it, expect } from 'vitest';
import { PumpStateMachine } from '../domain/stateMachines/pumpStateMachine';
import { VehicleStateMachine } from '../domain/stateMachines/vehicleStateMachine';
import { OrderStateMachine } from '../domain/stateMachines/orderStateMachine';

describe('State Machines Validation', () => {
  it('should validate Pump transitions strictly', () => {
    expect(PumpStateMachine.canTransition('IDLE', 'RESERVED')).toBe(true);
    expect(PumpStateMachine.canTransition('RESERVED', 'VEHICLE_ARRIVING')).toBe(true);
    expect(PumpStateMachine.canTransition('REQUEST_READY', 'FUELING')).toBe(true);
    expect(PumpStateMachine.canTransition('FUELING', 'PAYMENT')).toBe(true);

    // Invalid transition
    expect(PumpStateMachine.canTransition('IDLE', 'FUELING')).toBe(false);
  });

  it('should validate Vehicle state lifecycle', () => {
    expect(VehicleStateMachine.canTransition('SPAWN', 'ROAD_APPROACH')).toBe(true);
    expect(VehicleStateMachine.canTransition('AT_PUMP', 'REQUEST')).toBe(true);
    expect(VehicleStateMachine.canTransition('REQUEST', 'FUELING')).toBe(true);
    expect(VehicleStateMachine.canTransition('FUELING', 'PAYMENT')).toBe(true);
    expect(VehicleStateMachine.canTransition('PAYMENT', 'EXIT')).toBe(true);

    // Invalid transition
    expect(VehicleStateMachine.canTransition('SPAWN', 'PAYMENT')).toBe(false);
  });

  it('should validate Order state flow', () => {
    expect(OrderStateMachine.canTransition('TRAVELLING', 'COMPLETED')).toBe(true);
    expect(OrderStateMachine.canTransition('UNLOADING', 'COMPLETED')).toBe(true);
    expect(OrderStateMachine.canTransition('COMPLETED', 'TRAVELLING')).toBe(false);
  });
});
