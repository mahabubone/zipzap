/**
 * CollectCOD.
 *
 * Five writes, one transaction — the same shape as CreateShipment, for the same reason:
 *
 *   1. cod.records                the record, COD_EXPECTED -> COD_COLLECTED or PARTIAL
 *   2. tracking.events             the movement history
 *   3. system.outbox_events        the event to publish
 *   4. system.idempotency_keys     the retry guard
 *
 * The row is locked before it is read. Without that, a rider's retried request and the first
 * attempt both read COD_EXPECTED and both collect — money created from nothing, which is the
 * single failure this design exists to prevent.
 *
 * Partial collection is a first-class outcome, not an error: `125000` collected against
 * `125050` expected records PARTIAL_COLLECTION and settles at the collected amount, with the
 * shortfall visible. Nobody reconciles it by hand, and nobody invents the missing 50.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { CodRecordNotFoundError, InvalidIdempotencyKeyError } from '../../common/domain-error.ts';
import { hashRequest } from '../../common/idempotency.ts';
import { claim } from '../system/idempotency.store.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { CodRecordRepository } from './cod-record.repository.ts';
import { assertTransition, nextAfterReconcile, reconcile, type CodStatus } from './rules/cod.ts';

export interface CollectCodCommand {
  readonly shipmentId: string;
  readonly collectedMinor: number;
  readonly idempotencyKey: string;
  readonly actorId: string | null;
}

export interface CollectedCod {
  readonly shipmentId: string;
  readonly expectedMinor: number;
  readonly collectedMinor: number;
  readonly shortfallMinor: number;
  readonly status: CodStatus;
}

const RESPONSE_META = { statusCode: 200 };

@Injectable()
export class CollectCodService {
  constructor(
    @InjectDataSource('cod') private readonly codDataSource: DataSource,
    @Inject(CodRecordRepository) private readonly records: CodRecordRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
  ) {}

  async execute(command: CollectCodCommand): Promise<{
    result: CollectedCod;
    replayed: boolean;
  }> {
    const requestHash = hashRequest({
      shipmentId: command.shipmentId,
      collectedMinor: command.collectedMinor,
    });

    return this.codDataSource.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'cod.collect', merchantId: null, key: command.idempotencyKey },
        requestHash,
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return { result: claimed.decision.responseBody as CollectedCod, replayed: true };
      }

      const record = await this.records.findByShipmentIdForUpdate(manager, command.shipmentId);
      if (!record) throw new CodRecordNotFoundError();

      // The expected amount is a promise from the frozen quote. It is never overwritten by
      // collection — the gap between promise and reality is exactly what reconciliation measures.
      const outcome = reconcile({
        expectedMinor: record.expectedMinor,
        collectedMinor: command.collectedMinor,
      });

      const next = nextAfterReconcile(outcome);
      assertTransition(record.status as CodStatus, next);

      record.collectedMinor = command.collectedMinor;
      record.status = next;
      await this.records.save(manager, record);

      const now = new Date();
      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: command.shipmentId,
        eventType: 'COD_COLLECTED',
        occurredAt: now,
        actorType: 'RIDER',
        actorId: command.actorId,
        metadata: {
          expectedMinor: record.expectedMinor,
          collectedMinor: command.collectedMinor,
          shortfallMinor: 'shortfallMinor' in outcome ? outcome.shortfallMinor : 0,
        },
      });

      await appendOutbox(manager, {
        type:
          outcome.kind === 'MATCHED'
            ? 'CODCollected'
            : outcome.kind === 'PARTIAL'
              ? 'CODPartialCollection'
              : 'CODCollectionFailed',
        aggregateType: 'cod',
        aggregateId: record.id,
        payload: {
          shipmentId: command.shipmentId,
          merchantId: record.merchantId,
          currency: record.currency,
          expectedMinor: record.expectedMinor,
          collectedMinor: command.collectedMinor,
          shortfallMinor: 'shortfallMinor' in outcome ? outcome.shortfallMinor : 0,
        },
      });

      const result: CollectedCod = {
        shipmentId: command.shipmentId,
        expectedMinor: record.expectedMinor,
        collectedMinor: command.collectedMinor,
        shortfallMinor: 'shortfallMinor' in outcome ? outcome.shortfallMinor : 0,
        status: next,
      };
      await claimed.complete(RESPONSE_META.statusCode, result);

      return { result, replayed: false };
    });
  }
}
