/**
 * Builds the public tracking timeline from the event stream.
 *
 * This is the piece that makes tracking eventually consistent on purpose: the authoritative
 * `tracking.events` log is written inside the state-changing transaction, while the public
 * read model is projected here. Two seconds of staleness on a public tracking page is not a bug;
 * a missing event is.
 *
 * Consumes the shipment's own connection, because tracking.public_timeline is its table and it
 * must not reach into shipment.shipments to learn a tracking code.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { consumeOnce } from '../../system/consume-once.ts';

export const TRACKING_CONSUMER = 'tracking';

interface ShipmentCreatedEnvelope {
  readonly id: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly data: {
    readonly merchantId: string;
    readonly trackingCode: string;
    readonly status: string;
    readonly cod: { readonly amountMinor: number; readonly currency: string };
  };
}

@Injectable()
export class TrackingConsumer {
  private readonly logger = new Logger(TrackingConsumer.name);

  constructor(@InjectDataSource('tracking') private readonly tracking: DataSource) {}

  async handle(message: { subject: string; payload: Uint8Array }): Promise<ConsumeOutcomeResult> {
    let envelope: ShipmentCreatedEnvelope;
    try {
      envelope = JSON.parse(
        Buffer.from(message.payload).toString('utf8'),
      ) as ShipmentCreatedEnvelope;
    } catch {
      // An unparseable message must not kill the consumer loop.
      this.logger.error({ subject: message.subject }, 'unparseable event payload');
      return 'malformed';
    }

    if (envelope.type !== 'ShipmentCreated') return 'ignored';

    try {
      const outcome = await consumeOnce(
        this.tracking,
        TRACKING_CONSUMER,
        envelope.id,
        async (manager) => {
          // Sequence is monotonic per tracking code, so the public timeline has a total order.
          const rows = await manager.query(
            `SELECT COALESCE(MAX(sequence), 0) + 1 AS next
               FROM tracking.public_timeline
              WHERE tracking_code = $1`,
            [envelope.data.trackingCode],
          );
          const sequence = Number(rows[0]?.next ?? 1);

          await manager.query(
            `INSERT INTO tracking.public_timeline
               (id, tracking_code, shipment_id, sequence, event_type, occurred_at)
             VALUES ($1, $2, $3, $4, 'SHIPMENT_CREATED', $5)`,
            [
              randomUUID(),
              envelope.data.trackingCode,
              envelope.aggregateId,
              sequence,
              envelope.occurredAt,
            ],
          );
        },
      );

      if (outcome === 'duplicate') {
        // Not an error: at-least-once means this is expected, and the claim is the proof.
        this.logger.debug({ eventId: envelope.id }, 'duplicate event skipped');
      }
      return outcome;
    } catch (error) {
      this.logger.error({ err: error, eventId: envelope.id }, 'tracking consumer failed');
      throw error;
    }
  }
}

export type ConsumeOutcomeResult = 'processed' | 'duplicate' | 'ignored' | 'malformed';
