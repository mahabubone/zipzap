/**
 * RecordAttempt — a failed delivery attempt moves the job forward, not backward.
 *
 * Retryable reason with attempts left   -> OUT_FOR_DELIVERY (try again)
 * Terminal reason, or attempts exhausted -> FAILED (triggers return upstream)
 *
 * The attempt row is written in the same transaction as the status change: an attempt without a
 * matching job state is a record nobody can act on.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { claim } from '../system/idempotency.store.ts';
import { InvalidIdempotencyKeyError } from '../../common/domain-error.ts';
import { hashRequest } from '../../common/idempotency.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { DeliveryRepository } from './delivery.repository.ts';
import {
  assertTransition,
  attemptsRemain,
  isRetryable,
  type DeliveryStatus,
  type FailureReason,
} from './rules/delivery.ts';

export interface RecordAttemptCommand {
  readonly jobId: string;
  readonly reason: FailureReason;
  readonly note?: string;
  readonly idempotencyKey: string;
  readonly actorId: string | null;
}

export interface RecordedAttempt {
  readonly jobId: string;
  readonly sequence: number;
  readonly status: DeliveryStatus;
  readonly retryScheduled: boolean;
}

const RESPONSE_META = { statusCode: 200 };

@Injectable()
export class RecordAttemptService {
  constructor(
    @InjectDataSource('delivery') private readonly deliveryDataSource: DataSource,
    @Inject(DeliveryRepository) private readonly jobs: DeliveryRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
  ) {}

  async execute(command: RecordAttemptCommand): Promise<{
    result: RecordedAttempt;
    replayed: boolean;
  }> {
    const requestHash = hashRequest({ jobId: command.jobId, reason: command.reason });

    return this.deliveryDataSource.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'delivery.attempt', merchantId: null, key: command.idempotencyKey },
        requestHash,
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return { result: claimed.decision.responseBody as RecordedAttempt, replayed: true };
      }

      const job = await this.jobs.findByIdForUpdate(manager, command.jobId);
      if (!job) throw new ResourceNotFoundError('Delivery job not found.');

      const sequence = job.attemptsMade + 1;
      await this.jobs.insertAttempt(manager, {
        id: randomUUID(),
        jobId: job.id,
        sequence,
        reason: command.reason,
        note: command.note ?? null,
        attemptedAt: new Date(),
      });

      job.attemptsMade = sequence;
      job.lastFailureReason = command.reason;

      // The reason decides the branch: a retryable failure with budget left goes back out,
      // anything else ends the job and hands off to returns. Both edges are asserted —
      // OUT_FOR_DELIVERY -> ATTEMPTED records the attempt, ATTEMPTED -> next resolves it.
      const retryScheduled = isRetryable(command.reason) && attemptsRemain(sequence);
      const next: DeliveryStatus = retryScheduled ? 'OUT_FOR_DELIVERY' : 'FAILED';
      assertTransition(job.status as DeliveryStatus, 'ATTEMPTED');
      assertTransition('ATTEMPTED', next);
      job.status = next;
      await this.jobs.save(manager, job);

      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: job.shipmentId,
        eventType: 'DELIVERY_ATTEMPTED',
        actorType: 'RIDER',
        actorId: command.actorId,
        metadata: { jobId: job.id, sequence, reason: command.reason, retryScheduled },
      });

      await appendOutbox(manager, {
        type: 'DeliveryAttempted',
        aggregateType: 'delivery',
        aggregateId: job.id,
        payload: { shipmentId: job.shipmentId, sequence, reason: command.reason, retryScheduled },
      });

      const result: RecordedAttempt = {
        jobId: job.id,
        sequence,
        status: next,
        retryScheduled,
      };
      await claimed.complete(RESPONSE_META.statusCode, result);

      return { result, replayed: false };
    });
  }
}
