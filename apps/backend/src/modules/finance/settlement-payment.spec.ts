import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { FinanceRepository } from './finance.repository.ts';
import { InitiateSettlementPaymentService } from './initiate-settlement-payment.service.ts';
import { ConfirmSettlementPaymentService } from './confirm-settlement-payment.service.ts';
import { PAYMENT_PROVIDER } from './provider/payment-provider.port.ts';
import { MockPaymentProvider } from './provider/mock-payment.provider.ts';
import { InvalidTransitionError } from '../../common/domain-error.ts';

/**
 * The payout choreography, minus the database.
 *
 * What these cover: the machine edges (APPROVED -> PAYMENT_INITIATED ->
 * PAYMENT_CONFIRMED -> SETTLED), the failed-payout path (no entry, no advance),
 * and that the provider converges on the derived invoice. Real atomicity — the
 * payout entry and the status committing together — is proven by
 * test/integration/ against Postgres.
 */

function fakeSettlement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'set-1',
    reference: 'SET-2026-000001',
    merchantId: 'm-1',
    status: 'APPROVED',
    itemsJson: [],
    frozenNetMinor: 125_050,
    currency: 'BDT',
    approvedBy: 'op-1',
    approvedAt: new Date(),
    paymentReference: null,
    paymentInitiatedAt: null,
    paymentConfirmedAt: null,
    ...overrides,
  };
}

function fakeManager(settlement: Record<string, unknown> | null) {
  const touched: string[] = [];
  return {
    touched,
    manager: {
      query: (sql: string) => {
        touched.push(
          sql.includes('outbox_events')
            ? 'system.outbox_events'
            : sql.includes('idempotency_keys')
              ? sql.includes('UPDATE')
                ? 'complete:system.idempotency_keys'
                : 'claim:system.idempotency_keys'
              : sql,
        );
        if (sql.includes('INSERT INTO system.idempotency_keys') && sql.includes('ON CONFLICT')) {
          return Promise.resolve([{ scope: 'x' }]);
        }
        return Promise.resolve([]);
      },
      getRepository: () => ({
        save: (entity: unknown) => {
          touched.push('finance.settlements');
          return Promise.resolve(entity);
        },
        findOneBy: () => Promise.resolve(settlement),
      }),
      createQueryBuilder: () => ({
        setLock: () => ({
          where: () => ({
            getOne: () => {
              touched.push('lock:finance.settlements');
              return Promise.resolve(settlement);
            },
          }),
        }),
      }),
    },
  };
}

function servicesWith(
  fake: ReturnType<typeof fakeManager>,
  payments = new MockPaymentProvider(),
): {
  initiate: InitiateSettlementPaymentService;
  confirm: ConfirmSettlementPaymentService;
} {
  const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
  const repo = new FinanceRepository();
  return {
    initiate: new InitiateSettlementPaymentService(fakeDs as never, repo, payments),
    confirm: new ConfirmSettlementPaymentService(fakeDs as never, repo, payments),
  };
}

describe('settlement payout orchestration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initiates through the provider and records the reference', async () => {
    const fake = fakeManager(fakeSettlement());
    const { initiate } = servicesWith(fake);

    const { result, replayed } = await initiate.execute({
      settlementId: 'set-1',
      idempotencyKey: 'key-init-1',
    });

    expect(replayed).toBe(false);
    expect(result.status).toBe('PAYMENT_INITIATED');
    expect(result.paymentReference).toBe('MOCK000001');
    expect(result.netMinor).toBe(125_050);
    expect(fake.touched).toEqual([
      'claim:system.idempotency_keys',
      'lock:finance.settlements',
      'finance.settlements',
      'system.outbox_events',
      'complete:system.idempotency_keys',
    ]);
  });

  it('derives the invoice from the reference — same settlement, same invoice', async () => {
    const payments = new MockPaymentProvider();
    const fake = fakeManager(fakeSettlement());
    const { initiate } = servicesWith(fake, payments);

    await initiate.execute({ settlementId: 'set-1', idempotencyKey: 'key-init-2' });
    const again = await payments.initiate({
      invoiceNumber: 'PAY-SET-2026-000001',
      amountMinor: 125_050,
      currency: 'BDT',
      beneficiary: 'm-1',
    });
    expect(again.reference).toBe('MOCK000001');
  });

  it('refuses to initiate from CREATED — unapproved money never moves', async () => {
    const fake = fakeManager(fakeSettlement({ status: 'CREATED' }));
    const { initiate } = servicesWith(fake);

    await expect(
      initiate.execute({ settlementId: 'set-1', idempotencyKey: 'key-init-3' }),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it('confirm posts the payout entry and settles on provider success', async () => {
    const payments = new MockPaymentProvider();
    const initiated = await payments.initiate({
      invoiceNumber: 'PAY-SET-2026-000001',
      amountMinor: 125_050,
      currency: 'BDT',
      beneficiary: 'm-1',
    });
    payments.settle(initiated.reference, 'succeeded');

    const fake = fakeManager(
      fakeSettlement({ status: 'PAYMENT_INITIATED', paymentReference: initiated.reference }),
    );
    // FinanceRepository.insertEntry uses getRepository().save — the fake records it.
    const { confirm } = servicesWith(fake, payments);

    const { result } = await confirm.execute({
      settlementId: 'set-1',
      idempotencyKey: 'key-confirm-1',
    });

    expect(result.status).toBe('SETTLED');
    expect(result.providerStatus).toBe('succeeded');
    expect(fake.touched).toContain('finance.settlements');
    expect(fake.touched).toContain('system.outbox_events');
  });

  it('confirm on provider failure advances nothing and posts no entry', async () => {
    const payments = new MockPaymentProvider();
    const initiated = await payments.initiate({
      invoiceNumber: 'PAY-SET-2026-000002',
      amountMinor: 125_050,
      currency: 'BDT',
      beneficiary: 'm-1',
    });
    payments.settle(initiated.reference, 'failed');

    const fake = fakeManager(
      fakeSettlement({ status: 'PAYMENT_INITIATED', paymentReference: initiated.reference }),
    );
    const { confirm } = servicesWith(fake, payments);

    const { result } = await confirm.execute({
      settlementId: 'set-1',
      idempotencyKey: 'key-confirm-2',
    });

    expect(result.status).toBe('PAYMENT_INITIATED');
    expect(result.providerStatus).toBe('failed');
    expect(fake.touched).not.toContain('finance.settlements');
  });

  it('both services resolve through the real Nest container', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InitiateSettlementPaymentService,
        ConfirmSettlementPaymentService,
        { provide: FinanceRepository, useValue: {} },
        { provide: PAYMENT_PROVIDER, useValue: new MockPaymentProvider() },
      ],
    })
      .useMocker(() => ({}))
      .compile();

    expect(module.get(InitiateSettlementPaymentService)).toBeDefined();
    expect(module.get(ConfirmSettlementPaymentService)).toBeDefined();
  });
});
