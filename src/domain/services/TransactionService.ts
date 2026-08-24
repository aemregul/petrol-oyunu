/**
 * Project Highway - Master Transaction Service
 * Ensures atomic financial and fuel stock transactions with audit log and idempotency.
 * Sourced directly from GDD Section 26.6, 27.2
 */

import { GameState, TransactionRecord, FuelType } from '../types/gameState';
import { GAME_CONFIG } from '../../config/gameConfig';

export interface TransactionResult {
  success: boolean;
  error?: string;
  transactionId: string;
  cashDelta: number;
  newCash: number;
}

export class TransactionService {
  private static processedTxIds = new Set<string>();

  public static generateTxId(prefix: string = 'tx'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  /**
   * Execute an atomic cash change
   */
  public static executeCashTransaction(
    state: GameState,
    params: {
      type: TransactionRecord['type'];
      amount: number; // positive = income, negative = expense
      description: string;
      customTxId?: string;
      allowOverdraft?: boolean;
    }
  ): TransactionResult {
    const txId = params.customTxId || this.generateTxId('cash');

    if (this.processedTxIds.has(txId)) {
      return {
        success: true,
        transactionId: txId,
        cashDelta: 0,
        newCash: state.player.cash
      };
    }

    const minAllowedCash = params.allowOverdraft ? GAME_CONFIG.economy.overdraftLimit : 0;
    const projectedCash = state.player.cash + params.amount;

    if (projectedCash < minAllowedCash) {
      return {
        success: false,
        error: `Yetersiz Bakiye! Gereken: ${Math.abs(params.amount).toLocaleString('tr-TR')} TL, Mevcut: ${state.player.cash.toLocaleString('tr-TR')} TL`,
        transactionId: txId,
        cashDelta: 0,
        newCash: state.player.cash
      };
    }

    const cashBefore = state.player.cash;
    state.player.cash = projectedCash;
    this.processedTxIds.add(txId);

    const record: TransactionRecord = {
      id: txId,
      timestamp: Date.now(),
      type: params.type,
      amount: params.amount,
      cashBefore,
      cashAfter: projectedCash,
      description: params.description
    };

    state.transactionLog.unshift(record);
    if (state.transactionLog.length > 100) {
      state.transactionLog.pop();
    }

    return {
      success: true,
      transactionId: txId,
      cashDelta: params.amount,
      newCash: projectedCash
    };
  }

  /**
   * Reserve fuel in the tank for an incoming fueling request
   */
  public static reserveFuel(
    state: GameState,
    fuelType: FuelType,
    liters: number
  ): { success: boolean; error?: string; reservedLiters: number } {
    const tank = state.tanks[fuelType];
    if (!tank || tank.capacity <= 0) {
      return { success: false, error: `${fuelType} yakıt tankı henüz inşa edilmedi!`, reservedLiters: 0 };
    }

    const availableStock = Math.max(0, tank.stock - tank.reservedStock);
    if (availableStock < 0.1) {
      return { success: false, error: `${tank.fuelType} tankında yeterli yakıt yok!`, reservedLiters: 0 };
    }

    // Reserve as much as possible up to requested
    const fulfillableLiters = Math.min(liters, availableStock);
    tank.reservedStock += fulfillableLiters;

    return {
      success: true,
      reservedLiters: Number(fulfillableLiters.toFixed(2))
    };
  }

  /**
   * Complete fueling: deduct reserved stock, update actual stock
   */
  public static dispenseFuel(
    state: GameState,
    fuelType: FuelType,
    liters: number
  ): boolean {
    const tank = state.tanks[fuelType];
    if (!tank) return false;

    tank.reservedStock = Math.max(0, tank.reservedStock - liters);
    tank.stock = Math.max(0, tank.stock - liters);
    return true;
  }

  /**
   * Release reserved fuel on cancellation
   */
  public static releaseFuelReservation(
    state: GameState,
    fuelType: FuelType,
    liters: number
  ): void {
    const tank = state.tanks[fuelType];
    if (!tank) return;
    tank.reservedStock = Math.max(0, tank.reservedStock - liters);
  }

  /**
   * Add fuel into tank on tanker arrival (handles weighted average cost)
   */
  public static receiveFuelDelivery(
    state: GameState,
    fuelType: FuelType,
    deliveredLiters: number,
    deliveryUnitCost: number
  ): { addedLiters: number; refundedLiters: number; refundAmount: number } {
    const tank = state.tanks[fuelType];
    if (!tank) return { addedLiters: 0, refundedLiters: deliveredLiters, refundAmount: deliveredLiters * deliveryUnitCost };

    const freeCapacity = Math.max(0, tank.capacity - tank.stock);
    const addedLiters = Math.min(freeCapacity, deliveredLiters);
    const refundedLiters = deliveredLiters - addedLiters;
    const refundAmount = refundedLiters * deliveryUnitCost;

    if (addedLiters > 0) {
      // Calculate Weighted Average Cost (Hareketli Ağırlıklı Ortalama Maliyet)
      const currentStockValue = tank.stock * tank.averageCost;
      const newStockValue = addedLiters * deliveryUnitCost;
      const totalStock = tank.stock + addedLiters;
      tank.averageCost = totalStock > 0 ? Number(((currentStockValue + newStockValue) / totalStock).toFixed(2)) : deliveryUnitCost;
      tank.stock += addedLiters;
    }

    if (refundAmount > 0) {
      this.executeCashTransaction(state, {
        type: 'REFUND',
        amount: refundAmount,
        description: `Tank dolduğu için ${refundedLiters.toFixed(0)} L iade edildi.`
      });
    }

    return {
      addedLiters,
      refundedLiters,
      refundAmount
    };
  }
}
