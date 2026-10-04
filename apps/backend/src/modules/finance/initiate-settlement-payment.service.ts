/**
 * InitiateSettlementPayment — APPROVED -> PAYMENT_INITIATED, through the payout port.
 *
 * The invoice number is derived, not stored: `PAY-<reference>`. A retried initiation
 * re-derives the same invoice, and the provider converges on it instead of paying
 * twice. The provider reference is recorded on the row — it is the only new fact,
 * and the row is the audit trail.
 *
 * The provider call happens INSIDE the transaction on purpose. If initiate succeeds
 * but the commit fails, the provider holds a payment we never recorded — but the
 * retry re-derives the same invoice and converges on the existing payment instead
 * of creating a second one. If the call happens outside and the process dies between
 * the two, there is no convergence: just a payment nobody knows about. Convergence
 * beats separation here because the invoice is deterministic.
 *
 * Idempotency-keyed like approval: a retried initiation returns the recorded payment,
 * never a second one.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { InvalidIdempotencyKeyError, ResourceNotFoundError } from '../../common/domain-error.ts';
import { hashRequest } from '../../common/idempotency.ts';
import { claim } from '../system/idempotency.store.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { FinanceRepository } from './finance.repository.ts';
import { assertSettlementTransition, type SettlementStatus } from './rules/finance.ts';
import type { Currency } from '../../common/money.ts';
import { PAYMENT_PROVIDER } from './provider/payment-provider.port.ts';
import type { PaymentProvider } from './rules/payment-provider.ts';

export interface InitiateSettlementPaymentCommand {
  readonly settlementId: string;
  readonly idempotencyKey: string;
}

export interface InitiatedSettlementPayment {
  readonly id: string;
  readonly reference: string;
  readonly status: SettlementStatus;
  readonly paymentReference: string;
  readonly netMinor: number;
  readonly currency: string;
}

const RESPONSE_META = { statusCode: 200 };

export function paymentInvoiceNumber(reference: string): string {
  return `PAY-${reference}`;
}

@Injectable()
export class InitiateSettlementPaymentService {
  constructor(
    @InjectDataSource('finance') private readonly financeDataSource: DataSource,
    @Inject(FinanceRepository) private readonly finance: FinanceRepository,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  async execute(command: InitiateSettlementPaymentCommand): Promise<{
    result: InitiatedSettlementPayment;
    replayed: boolean;
  }> {
    const requestHash = hashRequest({ settlementId: command.settlementId });

    return this.financeDataSource.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'settlement.initiate-payment', merchantId: null, key: command.idempotencyKey },
        requestHash,
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return {
          result: claimed.decision.responseBody as InitiatedSettlementPayment,
          replayed: true,
        };
      }

      const settlement = await this.finance.findSettlementForUpdate(manager, command.settlementId);
      if (!settlement) throw new ResourceNotFoundError('Settlement not found.');

      // Only APPROVED may initiate. Anything else is either not yet payable or already paid —
      // initiating from CREATED would pay an unapproved settlement.
      assertSettlementTransition(settlement.status as SettlementStatus, 'PAYMENT_INITIATED');

      const netMinor = Number(settlement.frozenNetMinor);
      const currency = settlement.currency as Currency;
      const payment = await this.payments.initiate({
        invoiceNumber: paymentInvoiceNumber(settlement.reference),
        amountMinor: netMinor,
        currency,
        beneficiary: settlement.merchantId,
      });

      const now = new Date();
      settlement.status = 'PAYMENT_INITIATED';
      settlement.paymentReference = payment.reference;
      settlement.paymentInitiatedAt = now;
      await this.finance.saveSettlement(manager, settlement);

      await appendOutbox(manager, {
        type: 'SettlementPaymentInitiated',
        aggregateType: 'settlement',
        aggregateId: settlement.id,
        payload: {
          merchantId: settlement.merchantId,
          reference: settlement.reference,
          netMinor,
          paymentReference: payment.reference,
        },
        occurredAt: now,
      });

      const result: InitiatedSettlementPayment = {
        id: settlement.id,
        reference: settlement.reference,
        status: 'PAYMENT_INITIATED',
        paymentReference: payment.reference,
        netMinor,
        currency: settlement.currency,
      };
      await claimed.complete(RESPONSE_META.statusCode, result);

      return { result, replayed: false };
    });
  }
}
