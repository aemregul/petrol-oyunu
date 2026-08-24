import { describe, it, expect, beforeEach } from 'vitest';
import { TransactionService } from '../domain/services/TransactionService';
import { createInitialGameState } from '../domain/types/initialState';
import { GameState } from '../domain/types/gameState';

describe('TransactionService', () => {
  let state: GameState;

  beforeEach(() => {
    state = createInitialGameState();
  });

  it('should execute valid cash transactions and update audit log', () => {
    const initialCash = state.player.cash;
    const result = TransactionService.executeCashTransaction(state, {
      type: 'FUEL_SALE',
      amount: 1500,
      description: 'Benzin Satışı'
    });

    expect(result.success).toBe(true);
    expect(state.player.cash).toBe(initialCash + 1500);
    expect(state.transactionLog[0].type).toBe('FUEL_SALE');
    expect(state.transactionLog[0].amount).toBe(1500);
    expect(state.transactionLog[0].cashAfter).toBe(initialCash + 1500);
  });

  it('should block transactions that exceed cash without overdraft', () => {
    const initialCash = state.player.cash;
    const result = TransactionService.executeCashTransaction(state, {
      type: 'BUILD',
      amount: -(initialCash + 5000),
      description: 'Pahalı İnşaat'
    });

    expect(result.success).toBe(false);
    expect(state.player.cash).toBe(initialCash);
  });

  it('should guarantee idempotency for duplicate transaction IDs', () => {
    const customTxId = 'tx_unique_12345';
    const res1 = TransactionService.executeCashTransaction(state, {
      type: 'TUTORIAL_REWARD',
      amount: 500,
      description: 'Ödül',
      customTxId
    });

    const cashAfterFirst = state.player.cash;

    const res2 = TransactionService.executeCashTransaction(state, {
      type: 'TUTORIAL_REWARD',
      amount: 500,
      description: 'Ödül Tekrar',
      customTxId
    });

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(state.player.cash).toBe(cashAfterFirst); // Did not double-charge or double-reward!
  });

  it('should atomically reserve and dispense fuel', () => {
    const initialStock = state.tanks.gasoline.stock; // 700
    const reserveRes = TransactionService.reserveFuel(state, 'gasoline', 40);

    expect(reserveRes.success).toBe(true);
    expect(reserveRes.reservedLiters).toBe(40);
    expect(state.tanks.gasoline.reservedStock).toBe(40);
    expect(state.tanks.gasoline.stock).toBe(initialStock);

    TransactionService.dispenseFuel(state, 'gasoline', 40);
    expect(state.tanks.gasoline.reservedStock).toBe(0);
    expect(state.tanks.gasoline.stock).toBe(initialStock - 40);
  });
});
