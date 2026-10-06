/**
 * ConfirmSettlementPayment — PAYMENT_INITIATED -> PAYMENT_CONFIRMED, then -> SETTLED.
 *
 * Asks the provider for the payment's terminal state and records it. `succeeded`
 * posts the SETTLEMENT_PAYOUT ledger entry (the merchant was paid; the ledger must
 * say so) and the settlement moves to SETTLED via PAYMENT_CONFIRMED — two machine
 * edges, one transaction, because the payout entry and the status are one fact.
 * `failed` and `refunded` leave the settlement in PAYMENT_INITIATED with the
 * provider's answer recorded in the outbox: money did not move, so no entry posts,
 * and operations retries or investigates. A failed payout that silently settled
 * would be a merchant paid on paper but not in fact.
 *
 * Idempotency-keyed per settlement like the other money edges: a retried confirm
 * returns the recorded outcome, and the payout entry's reference check (one entry
 * per settlement) makes even a double-run converge.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { InvalidIdempotencyKeyError, ResourceNotFoundError } from '../../common/domain-error.ts';
import { hashRequest } from '../../common/idempotency.ts';
import type { Currency } from '../../common/money.ts';
import { claim } from '../system/idempotency.store.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { settlementsCompletedTotal } from '../../common/metrics';
import { FinanceRepository } from './finance.repository.ts';
import {
  assertSettlementTransition,
  validateLedgerEntry,
  type SettlementStatus,
} from './rules/finance.ts';
import { PAYMENT_PROVIDER } from './provider/payment-provider.port.ts';
import type { PaymentProvider } from './rules/payment-provider.ts';

export interface ConfirmSettlementPaymentCommand {
  readonly settlementId: string;
  readonly idempotencyKey: string;
}

export interface ConfirmedSettlementPayment {
  readonly id: string;
  readonly reference: string;
  readonly status: SettlementStatus;
  readonly paymentReference: string;
  readonly providerStatus: string;
  readonly netMinor: number;
  readonly currency: string;
}

const RESPONSE_META = { statusCode: 200 };

@Injectable()
export class ConfirmSettlementPaymentService {
  constructor(
    @InjectDataSource('finance') private readonly financeDataSource: DataSource,
    @Inject(FinanceRepository) private readonly finance: FinanceRepository,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  async execute(command: ConfirmSettlementPaymentCommand): Promise<{
    result: ConfirmedSettlementPayment;
    replayed: boolean;
  }> {
    const requestHash = hashRequest({ settlementId: command.settlementId });

    return this.financeDataSource.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'settlement.confirm-payment', merchantId: null, key: command.idempotencyKey },
        requestHash,
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return {
          result: claimed.decision.responseBody as ConfirmedSettlementPayment,
          replayed: true,
        };
      }

      const settlement = await this.finance.findSettlementForUpdate(manager, command.settlementId);
      if (!settlement) throw new ResourceNotFoundError('Settlement not found.');
      if (!settlement.paymentReference) {
        throw new ResourceNotFoundError('Settlement has no initiated payment to confirm.');
      }

      // Only PAYMENT_INITIATED may confirm. Confirming APPROVED would pay without
      // initiating; confirming SETTLED would pay twice.
      assertSettlementTransition(settlement.status as SettlementStatus, 'PAYMENT_CONFIRMED');

      const payment = await this.payments.verify(settlement.paymentReference);
      const now = new Date();
      const netMinor = Number(settlement.frozenNetMinor);
      const currency = settlement.currency as Currency;

      if (payment.status === 'succeeded') {
        // In this transaction, not via PostLedgerEntryService (which opens its own): the
        // payout entry and the status are one fact and must commit together.
        validateLedgerEntry({
          merchantId: settlement.merchantId,
          type: 'SETTLEMENT_PAYOUT',
          direction: -1,
          amountMinor: netMinor,
          currency,
          referenceType: 'SETTLEMENT',
          referenceId: settlement.id,
        });
        await this.finance.insertEntry(manager, {
          id: randomUUID(),
          merchantId: settlement.merchantId,
          entryType: 'SETTLEMENT_PAYOUT',
          direction: -1,
          amountMinor: netMinor,
          currency,
          referenceType: 'SETTLEMENT',
          referenceId: settlement.id,
          memo: `Payout ${payment.reference} for ${settlement.reference}`,
          occurredAt: now,
          createdAt: now,
          recordedAt: now,
        } as never);

        settlement.status = 'PAYMENT_CONFIRMED';
        settlement.paymentConfirmedAt = now;
        await this.finance.saveSettlement(manager, settlement);
        assertSettlementTransition('PAYMENT_CONFIRMED', 'SETTLED');
        settlement.status = 'SETTLED';
        await this.finance.saveSettlement(manager, settlement);
      }

      await appendOutbox(manager, {
        type: payment.status === 'succeeded' ? 'SettlementCompleted' : 'SettlementPaymentFailed',
        aggregateType: 'settlement',
        aggregateId: settlement.id,
        payload: {
          merchantId: settlement.merchantId,
          reference: settlement.reference,
          netMinor,
          paymentReference: payment.reference,
          providerStatus: payment.status,
        },
        occurredAt: now,
      });
      if (payment.status === 'succeeded') {
        settlementsCompletedTotal.labels({ currency: settlement.currency }).inc(netMinor);
      }

      const result: ConfirmedSettlementPayment = {
        id: settlement.id,
        reference: settlement.reference,
        status: settlement.status as SettlementStatus,
        paymentReference: payment.reference,
        providerStatus: payment.status,
        netMinor,
        currency: settlement.currency,
      };
      await claimed.complete(RESPONSE_META.statusCode, result);

      return { result, replayed: false };
    });
  }
}
