/**
 * Builds the public tracking timeline from the event stream.
 *
 * This is the piece that makes tracking eventually consistent on purpose: the authoritative
 * `tracking.events` log is written inside the state-changing transaction, while the public
 * read model is projected here. Two seconds of staleness on a public tracking page is not a bug;
 * a missing event is.
 *
 * Each shipment-scoped event projects one timeline row per affected parcel, in outbox-id order.
 * Pickup events carry `shipmentIds`; delivery events carry one `shipmentId`. The consumer
 * resolves each id's public code through the shipment boundary's lookup contract — it must not
 * open the shipment connection, and it must not reach into `shipment.shipments` to learn a code.
 * An id that resolves to nothing is skipped, never fatal: a missing parcel is an operations
 * problem, not a consumer-crash problem.
 *
 * Dedupe is per outbox row, inside the same transaction as the projection. Replayed events are
 * skipped silently; the skip is the expected shape of at-least-once delivery, not an error.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { consumeOnce } from '../system/consume-once.ts';
import { SHIPMENT_LOOKUP, type ShipmentLookup } from '../shipment/shipment.lookup.ts';
import type { TrackingEventType } from './rules/tracking-event.ts';

export const TRACKING_CONSUMER = 'tracking';

interface TrackingEnvelope {
  readonly id: string;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

/** Outbox event type -> the tracking event it projects. Exhaustive by construction of the switch. */
const EVENT_MAP = {
  ShipmentCreated: 'SHIPMENT_CREATED',
  PickupRequested: 'PICKUP_REQUESTED',
  PickupAssigned: 'PICKUP_ASSIGNED',
  DeliveryOutForDelivery: 'OUT_FOR_DELIVERY',
  DeliveryAttempted: 'DELIVERY_ATTEMPTED',
} as const satisfies Record<string, TrackingEventType>;

/** Events with no public projection. Emitted for operations, not for recipients. */
const SILENT = new Set(['DeliveryJobCreated', 'DeliveryAccepted']);

interface Projection {
  readonly trackingCode: string;
  readonly shipmentId: string;
  readonly eventType: TrackingEventType;
}

@Injectable()
export class TrackingConsumer {
  private readonly logger = new Logger(TrackingConsumer.name);

  constructor(
    @InjectDataSource('tracking') private readonly tracking: DataSource,
    @Inject(SHIPMENT_LOOKUP) private readonly shipments: ShipmentLookup,
  ) {}

  async handle(message: { subject: string; payload: Uint8Array }): Promise<ConsumeOutcomeResult> {
    let envelope: TrackingEnvelope;
    try {
      envelope = JSON.parse(Buffer.from(message.payload).toString('utf8')) as TrackingEnvelope;
    } catch {
      // An unparseable message must not kill the consumer loop.
      this.logger.error({ subject: message.subject }, 'unparseable event payload');
      return 'malformed';
    }

    if (SILENT.has(envelope.type)) return 'ignored';

    const eventType = EVENT_MAP[envelope.type as keyof typeof EVENT_MAP];
    if (!eventType) {
      this.logger.warn({ type: envelope.type }, 'unmapped event type');
      return 'ignored';
    }

    const shipmentIds = shipmentIdsOf(envelope);
    if (shipmentIds.length === 0) {
      this.logger.warn({ type: envelope.type }, 'event carries no shipment identity');
      return 'ignored';
    }

    try {
      const outcome = await consumeOnce(
        this.tracking,
        TRACKING_CONSUMER,
        envelope.id,
        async (manager) => {
          const projections: Projection[] = [];
          for (const shipmentId of shipmentIds) {
            const trackingCode = await this.shipments.findTrackingCode(shipmentId);
            if (!trackingCode) {
              this.logger.warn({ shipmentId }, 'unknown shipment id in event');
              continue;
            }
            projections.push({ trackingCode, shipmentId, eventType });
          }

          for (const projection of projections) {
            // Sequence is monotonic per tracking code, so the public timeline has a total order.
            const rows = await manager.query(
              `SELECT COALESCE(MAX(sequence), 0) + 1 AS next
                 FROM tracking.public_timeline
                WHERE tracking_code = $1`,
              [projection.trackingCode],
            );
            const sequence = Number(rows[0]?.next ?? 1);

            await manager.query(
              `INSERT INTO tracking.public_timeline
                 (id, tracking_code, shipment_id, sequence, event_type, occurred_at)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                randomUUID(),
                projection.trackingCode,
                projection.shipmentId,
                sequence,
                projection.eventType,
                envelope.occurredAt,
              ],
            );
          }
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

/**
 * Every shipment-scoped event names its parcels the same way: pickup events carry
 * `shipmentIds`, delivery and shipment events carry one `shipmentId`. One shape in, one list
 * out — a new event type that names parcels differently fails here, loudly, instead of
 * projecting half a timeline.
 *
 * The shipment module's own events (ShipmentCreated et al) name no parcel in the payload — but
 * every outbox envelope carries the shipment in `aggregateId` whenever `aggregateType` is
 * `shipment`. That fallback is the reason ShipmentCreated projects at all: without it the
 * first event of every lifecycle is silently dropped as identity-less.
 */
function shipmentIdsOf(envelope: TrackingEnvelope): string[] {
  if (Array.isArray(envelope.data.shipmentIds)) {
    return envelope.data.shipmentIds.filter((id): id is string => typeof id === 'string');
  }
  if (typeof envelope.data.shipmentId === 'string') {
    return [envelope.data.shipmentId];
  }
  if (envelope.aggregateType === 'shipment' && typeof envelope.aggregateId === 'string') {
    return [envelope.aggregateId];
  }
  return [];
}

export type ConsumeOutcomeResult = 'processed' | 'duplicate' | 'ignored' | 'malformed';
