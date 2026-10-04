/**
 * ReconcileCOD — the human decision point, recorded.
 *
 * Collection already classified the outcome: MATCHED moved to COD_COLLECTED, PARTIAL moved to
 * PARTIAL_COLLECTION, MISMATCH raised RECONCILIATION_EXCEPTION. Reconciliation proper — the
 * comparison itself — lives in rules/cod.ts reconcile(), which is pure and unit-tested.
 *
 * This service exists for the one transition the machine permits after the fact: resolving a
 * RECONCILIATION_EXCEPTION or a PARTIAL_COLLECTION back toward COD_RECONCILED once operations
 * has reviewed it. It does not auto-correct — there is no code path here that changes an
 * amount. The reviewer's identity is recorded with the decision, because a mismatch resolution
 * without an owner is indistinguishable from a cover-up.
 *
 * A mismatch that is never reviewed blocks settlement. That is the product working.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { CodRecordNotFoundError } from '../../common/domain-error.ts';
import { assertTransition, type CodStatus } from './rules/cod.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { CodRecordRepository } from './cod-record.repository.ts';

export interface ReconcileCodCommand {
  readonly shipmentId: string;
  readonly note: string;
  readonly actorId: string | null;
}

export interface ReconciledCod {
  readonly shipmentId: string;
  readonly status: CodStatus;
}

@Injectable()
export class ReconcileCodService {
  constructor(
    @InjectDataSource('cod') private readonly codDataSource: DataSource,
    @Inject(CodRecordRepository) private readonly records: CodRecordRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
  ) {}

  async execute(command: ReconcileCodCommand): Promise<ReconciledCod> {
    return this.codDataSource.transaction(async (manager) => {
      const record = await this.records.findByShipmentIdForUpdate(manager, command.shipmentId);
      if (!record) throw new CodRecordNotFoundError();

      // Only the two reviewable states may be resolved. Everything else is either already
      // reconciled or not yet collected, and resolving those would be meaningless.
      assertTransition(record.status as CodStatus, 'COD_RECONCILED');

      record.status = 'COD_RECONCILED';
      await this.records.save(manager, record);

      const now = new Date();
      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: command.shipmentId,
        eventType: 'EVENT_CORRECTED',
        occurredAt: now,
        actorType: 'OPERATIONS',
        actorId: command.actorId,
        metadata: { reviewNote: command.note, resolvedTo: 'COD_RECONCILED' },
      });

      await appendOutbox(manager, {
        type: 'CODReconciled',
        aggregateType: 'cod',
        aggregateId: record.id,
        payload: {
          shipmentId: command.shipmentId,
          reviewerId: command.actorId,
          note: command.note,
        },
      });

      return { shipmentId: command.shipmentId, status: 'COD_RECONCILED' };
    });
  }
}
