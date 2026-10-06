/**
 * Analytics consumer: the event stream into the six projections.
 *
 * Fifth NATS consumer, same shape as tracking: parse the envelope, ignore what
 * is not mapped (never fatal), then claim and project inside one transaction
 * via `consumeOnce` — at-least-once delivery needs the dedupe row and the
 * upserts to commit together or a redelivery double-counts every counter.
 *
 * The projections themselves live in `projections.ts` so the rebuild CLI can
 * replay the identical code path from `system.outbox_events`
 * (docs/domains/analytics.md — if rebuild and live disagree, that is the bug).
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { consumeOnce } from '../system/consume-once.ts';
import { isAnalyticsEventType, project, type AnalyticsEventType } from './projections.ts';

export const ANALYTICS_CONSUMER = 'analytics';

interface AnalyticsEnvelope {
  readonly id: string;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

export type AnalyticsOutcome = 'processed' | 'duplicate' | 'ignored' | 'malformed';

@Injectable()
export class AnalyticsConsumer {
  private readonly logger = new Logger(AnalyticsConsumer.name);

  constructor(@InjectDataSource('analytics') private readonly analytics: DataSource) {}

  async handle(message: { subject: string; payload: Uint8Array }): Promise<AnalyticsOutcome> {
    let envelope: AnalyticsEnvelope;
    try {
      envelope = JSON.parse(Buffer.from(message.payload).toString('utf8')) as AnalyticsEnvelope;
    } catch {
      // An unparseable message must not kill the consumer loop.
      this.logger.error({ subject: message.subject }, 'unparseable event payload');
      return 'malformed';
    }

    if (!isAnalyticsEventType(envelope.type)) return 'ignored';

    try {
      const outcome = await consumeOnce(
        this.analytics,
        ANALYTICS_CONSUMER,
        envelope.id,
        async (manager) => {
          await project(manager, {
            type: envelope.type as AnalyticsEventType,
            occurredAt: new Date(envelope.occurredAt),
            data: envelope.data ?? {},
          });
        },
      );

      if (outcome === 'duplicate') {
        // At-least-once redelivery: the claim is the proof, skip is expected.
        this.logger.debug({ eventId: envelope.id }, 'duplicate event skipped');
      }
      return outcome;
    } catch (error) {
      this.logger.error({ err: error, eventId: envelope.id }, 'analytics consumer failed');
      throw error;
    }
  }
}
