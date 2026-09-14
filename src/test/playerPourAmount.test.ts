import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState, VehicleEntity } from '../domain/types/gameState';
import {
  createEffects,
  beginFueling,
  dispenseStep,
  finalizeSale,
  POUR_MISS_REPUTATION,
  POUR_MISS_SCORE
} from '../domain/services/simulationEngine';
import { useGameStore } from '../store/gameStore';

/**
 * Emre, 2026-09-12: the fuel window typed the driver's sum in for the player,
 * which left nothing to do but press a button. The box now opens empty and the
 * player enters the sum; the sale is measured against what the driver asked
 * for. Pour short and they pay for what went in, less pleased; pour over and
 * they pay only what they asked — the extra is the station's loss.
 */

afterEach(() => vi.restoreAllMocks());

const PRICE = 50;

function station(): GameState {
  const state = createInitialGameState();
  state.pricing.gasoline.playerPrice = PRICE;
  state.tanks.gasoline.stock = 1000;
  state.tanks.gasoline.reservedStock = 0;
  state.station.cleanliness = 100;
  return state;
}

/** A driver at pump_1 who asked for ₺500 of petrol, or for a full tank. */
function driver(state: GameState, full = false): VehicleEntity {
  const car = {
    id: 'asker',
    archetype: 'family',
    modelVariant: 'sedan',
    fuelType: 'gasoline',
    tankCapacity: 60,
    currentFuel: 10,
    request: full
      ? { mode: 'FULL', targetValue: 50, calculatedLiters: 50, calculatedPrice: 50 * PRICE, dispensedLiters: 0, isFinished: false }
      : { mode: 'MONEY', targetValue: 500, calculatedLiters: 500 / PRICE, calculatedPrice: 500, dispensedLiters: 0, isFinished: false },
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
  } as VehicleEntity;
  state.vehicles[car.id] = car;
  state.pumps.pump_1.currentVehicleId = car.id;
  state.pumps.pump_1.state = 'REQUEST_READY';
  return car;
}

function pour(
  state: GameState,
  car: VehicleEntity,
  mode: 'LITERS' | 'MONEY' | 'FULL',
  value: number,
  actor: 'PLAYER' | 'EMPLOYEE' = 'PLAYER'
): void {
  const effects = createEffects();
  expect(beginFueling(state, car, mode, value, actor, effects)).toBe(true);
  for (let i = 0; i < 200 && car.state === 'FUELING'; i++) dispenseStep(state, car, 0.5, effects);
  expect(car.state).toBe('PAYMENT');
}

/** No tips: the dice held high, nudged per call so transaction ids stay apart. */
function noTips(): void {
  let n = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => 0.95 + 0.0003 * (n++ % 100));
}

/** The ₺500 driver, poured the typed sum and settled. */
function sell(typed: number) {
  const state = station();
  const car = driver(state);
  pour(state, car, 'MONEY', typed);
  const receipt = finalizeSale(state, car, createEffects());
  return { state, car, receipt };
}

describe('a pour the player sets by hand', () => {
  it('keeps what the driver asked for, whatever the player types', () => {
    const state = station();
    const car = driver(state);
    pour(state, car, 'MONEY', 600);
    expect(car.request.asked).toEqual({ mode: 'MONEY', targetValue: 500, liters: 10 });
    expect(car.request.targetValue).toBe(600);
  });

  it('charges the sum asked for when that is what the player pours', () => {
    noTips();
    expect(sell(500).receipt).toMatchObject({ sale: 500, off: null });
  });

  it('charges only what went in when the player pours short, and the driver is less pleased', () => {
    noTips();
    const exact = sell(500);
    const short = sell(400);
    expect(short.receipt).toMatchObject({ sale: 400, off: 'short' });
    expect(short.car.satisfaction).toBeLessThan(exact.car.satisfaction);
  });

  it('charges only the sum asked for when the player pours over; the extra fuel is the station’s loss', () => {
    noTips();
    const exact = sell(500);
    const over = sell(600);
    expect(over.receipt).toMatchObject({ sale: 500, off: 'over' });
    expect(over.receipt.poured).toBeCloseTo(600, 5);
    expect(over.state.tanks.gasoline.stock).toBeCloseTo(1000 - 600 / PRICE, 5);
    expect(over.car.satisfaction).toBeLessThan(exact.car.satisfaction);
  });

  it('sends a driver poured off the ask away unhappy, without a tip and with a little reputation lost', () => {
    // The dice held low: a driver served on the ask would tip.
    let n = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => 0.001 + 0.0003 * (n++ % 100));
    const exact = sell(500);
    expect(exact.state.player.reputation).toBe(createInitialGameState().player.reputation);

    for (const typed of [400, 600]) {
      const miss = sell(typed);
      expect(miss.receipt.tip).toBe(0);
      expect(miss.car.departureReason).toBe('SERVED_POOR');
      expect(miss.car.satisfaction).toBeLessThanOrEqual(POUR_MISS_SCORE);
      expect(miss.state.player.reputation).toBeCloseTo(exact.state.player.reputation - POUR_MISS_REPUTATION, 5);
      // Counted for the day-end report: the ₺100 not paid for, or the ₺100 not sold.
      const stats = miss.state.dayState.todayStats;
      if (typed < 500) expect([stats.shortPours, stats.shortPourShortfall, stats.overPours ?? 0]).toEqual([1, 100, 0]);
      else expect([stats.overPours, stats.overPourLoss, stats.shortPours ?? 0]).toEqual([1, 100, 0]);
    }
  });

  it('counts a full tank filled with FULLE, and an attendant’s pour, as spot on', () => {
    noTips();
    const state = station();
    const car = driver(state, true);
    pour(state, car, 'FULL', 50);
    expect(finalizeSale(state, car, createEffects())).toMatchObject({ sale: 50 * PRICE, off: null });

    const staffed = station();
    const other = driver(staffed);
    pour(staffed, other, other.request.mode, other.request.targetValue, 'EMPLOYEE');
    expect(finalizeSale(staffed, other, createEffects())).toMatchObject({ sale: 500, off: null });
  });

  it('tells the player at the hand-over when the pour missed the ask', () => {
    const cases: Array<[number, string]> = [
      [600, '₺100 fazla doldurdun'],
      [400, 'Müşteri ₺500 istemişti']
    ];
    for (const [typed, note] of cases) {
      noTips();
      const state = station();
      const car = driver(state);
      pour(state, car, 'MONEY', typed);
      useGameStore.setState({ gameState: state, selectedVehicleId: car.id, activeModal: 'CUSTOMER_FUEL' });

      useGameStore.getState().completeVehicleFueling(car.id);
      const receipt = useGameStore.getState().gameState.notifications[0];
      expect(receipt).toMatchObject({ type: 'WARNING', title: 'Satış Tamamlandı' });
      expect(receipt.message).toContain(note);
      vi.restoreAllMocks();
    }
  });
});
