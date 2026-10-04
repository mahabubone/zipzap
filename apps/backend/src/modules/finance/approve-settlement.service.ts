/**
 * ApproveSettlement — the point of no return.
 *
 * CREATED -> APPROVED, idempotent-keyed, and the actor is recorded on the row. Audited in the
 * same transaction: an approval without an audit trail is a payment nobody can attribute, and
 * attribution is the entire reason approvals exist.
 *
 * After this, the settlement is immutable. A late COD lands in the next settlement. Rewriting an
 * approved settlement underneath a merchant who may already have been paid against it is not a
 * correction — it is a second, unaudited payment run.
 *
 * This is the highest-value idempotency requirement in the product alongside COD collect: a
 * retried approval must return the recorded decision, never a second approval.
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

export interface ApproveSettlementCommand {
  readonly settlementId: string;
  readonly approverId: string;
  readonly idempotencyKey: string;
}

export interface ApprovedSettlement {
  readonly id: string;
  readonly reference: string;
  readonly status: SettlementStatus;
  readonly netMinor: number;
  readonly currency: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

const RESPONSE_META = { statusCode: 200 };

@Injectable()
export class ApproveSettlementService {
  constructor(
    @InjectDataSource('finance') private readonly financeDataSource: DataSource,
    @Inject(FinanceRepository) private readonly finance: FinanceRepository,
  ) {}

  async execute(command: ApproveSettlementCommand): Promise<{
    result: ApprovedSettlement;
    replayed: boolean;
  }> {
    // The key is scoped to the settlement, not the merchant: replays must return THIS decision.
    const requestHash = hashRequest({ settlementId: command.settlementId });

    return this.financeDataSource.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'settlement.approve', merchantId: null, key: command.idempotencyKey },
        requestHash,
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return { result: claimed.decision.responseBody as ApprovedSettlement, replayed: true };
      }

      const settlement = await this.finance.findSettlementForUpdate(manager, command.settlementId);
      if (!settlement) throw new ResourceNotFoundError('Settlement not found.');

      // Only CREATED may be approved. Anything else is either already decided or never existed
      // as a decision — approving SETTLED twice would be the second payment run.
      assertSettlementTransition(settlement.status as SettlementStatus, 'APPROVED');

      const now = new Date();
      settlement.status = 'APPROVED';
      settlement.approvedBy = command.approverId;
      settlement.approvedAt = now;
      await this.finance.saveSettlement(manager, settlement);

      await appendOutbox(manager, {
        type: 'SettlementApproved',
        aggregateType: 'settlement',
        aggregateId: settlement.id,
        payload: {
          merchantId: settlement.merchantId,
          reference: settlement.reference,
          netMinor: Number(settlement.frozenNetMinor),
          approvedBy: command.approverId,
        },
        occurredAt: now,
      });

      const result: ApprovedSettlement = {
        id: settlement.id,
        reference: settlement.reference,
        status: 'APPROVED',
        netMinor: Number(settlement.frozenNetMinor),
        currency: settlement.currency,
        approvedBy: command.approverId,
        approvedAt: now.toISOString(),
      };
      await claimed.complete(RESPONSE_META.statusCode, result);

      return { result, replayed: false };
    });
  }
}
