import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity } from '../domain/types/gameState';
import { createEffects, beginFueling, dispenseStep, finalizeSale } from '../domain/services/simulationEngine';
import { useGameStore } from '../store/gameStore';

/**
 * Emre, 2026-09-12: "teslim et'e tıkladığımda bildirim kısmında kaç TL bahşiş
 * kazandığım yazsın, çünkü ben toplam kazancı kasamda oturup hesaplayamam" —
 * a sale cannot be worked out from the cash tile. The player's hand-over now
 * spells out what went into the till: the fuel, the tip, and the sum.
 */

afterEach(() => vi.restoreAllMocks());

const lira = (n: number) => `₺${n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;

function atPump(state: GameState): VehicleEntity {
  const vehicle: VehicleEntity = {
    id: 'receipt_car',
    archetype: 'family',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 60,
    currentFuel: 10,
    request: {
      mode: 'LITERS', targetValue: 20, calculatedLiters: 20, calculatedPrice: 0,
      dispensedLiters: 0, isFinished: false
    },
    patience: 100,
    maxPatience: 100,
    satisfaction: 100,
    state: 'AT_PUMP',
    targetPumpId: 'pump_1',
    assignedActor: null,
    worldPosition: [8.5, 0, 5.6],
    targetWaypoint: null,
    route: [],
    heading: 0,
    speed: 0,
    routeProgress: 0,
    waitingTimeSeconds: 0,
    shoppingIntent: false
  };
  state.vehicles[vehicle.id] = vehicle;
  state.pumps.pump_1.currentVehicleId = vehicle.id;
  state.pumps.pump_1.state = 'REQUEST_READY';
  return vehicle;
}

/** The whole request poured at the player's hand, waiting for the hand-over. */
function pourAll(state: GameState, car: VehicleEntity): void {
  const effects = createEffects();
  expect(beginFueling(state, car, 'LITERS', 20, 'PLAYER', effects)).toBe(true);
  for (let i = 0; i < 100 && car.state === 'FUELING'; i++) dispenseStep(state, car, 0.5, effects);
  expect(car.state).toBe('PAYMENT');
}

/**
 * The tip's dice held low (a tip is left) or high (none is), nudged on every
 * call so two transactions in the same millisecond never share an id.
 */
function diceHeld(level: 'low' | 'high'): void {
  let n = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => (level === 'low' ? 0.001 : 0.95) + 0.0003 * (n++ % 100));
}

/** A poured car in the store, its panel open for the hand-over. */
function readyForHandOver(): { car: VehicleEntity; cash: number } {
  const state = createInitialGameState();
  const car = atPump(state);
  pourAll(state, car);
  useGameStore.setState({ gameState: state, selectedVehicleId: car.id, activeModal: 'CUSTOMER_FUEL' });
  return { car, cash: state.player.cash };
}

describe('the hand-over', () => {
  it('tells the player what went into the till: the fuel, the tip and the sum', () => {
    const { car, cash } = readyForHandOver();
    diceHeld('low');
    useGameStore.getState().completeVehicleFueling(car.id);

    const after = useGameStore.getState().gameState;
    const tip = after.dayState.todayStats.tips;
    const earned = after.player.cash - cash;
    expect(tip).toBeGreaterThan(0);
    expect(after.notifications[0]).toMatchObject({
      type: 'REWARD',
      title: 'Satış Tamamlandı',
      message: `${lira(earned - tip)} yakıt + ${lira(tip)} bahşiş = ${lira(earned)} kasaya girdi.`
    });
  });

  it('says so when the driver left no tip', () => {
    const { car, cash } = readyForHandOver();
    diceHeld('high');
    useGameStore.getState().completeVehicleFueling(car.id);

    const after = useGameStore.getState().gameState;
    expect(after.dayState.todayStats.tips).toBe(0);
    expect(after.notifications[0]).toMatchObject({
      type: 'INFO',
      title: 'Satış Tamamlandı',
      message: `${lira(after.player.cash - cash)} kasaya girdi; bu müşteri bahşiş bırakmadı.`
    });
  });

  it('gets its figures from the sale itself, which says nothing on its own for an attendant', () => {
    diceHeld('low');
    const state = createInitialGameState();
    const car = atPump(state);
    pourAll(state, car);
    const cash = state.player.cash;

    const effects = createEffects();
    const receipt = finalizeSale(state, car, effects);
    expect(receipt.sale + receipt.tip).toBeCloseTo(state.player.cash - cash, 5);
    expect(receipt.tip).toBe(state.dayState.todayStats.tips);
    // The engine settles an attendant's sales the same way; only the player's hand-over speaks.
    expect(effects.notifications.some((n) => n.title === 'Satış Tamamlandı')).toBe(false);
  });
});
