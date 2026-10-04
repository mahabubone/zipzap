/**
 * Webhook fan-out consumer: NATS event in, BullMQ jobs out. Never sends inline.
 *
 * Subscribes to the settlement/delivery subjects the parity spec pins, maps the
 * internal type to the wire name, fans out per active endpoint, and enqueues one
 * job per (endpoint, event). A merchant endpoint that hangs must not hold a NATS
 * consumer — the queue absorbs the latency, the ladder absorbs the failure.
 *
 * Idempotent by delivery id: the same outbox event redelivered enqueues the same
 * job id, and BullMQ dedupes on it. The receiver dedupes on ZipZap-Delivery.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { Queue } from 'bullmq';
import { WebhookRepository } from './webhook.repository.ts';
import { wireEvent, type WebhookEvent } from './rules/webhook.ts';

export const WEBHOOK_CONSUMER = 'webhook';
export const WEBHOOK_QUEUE = 'webhooks';

interface WebhookEnvelope {
  readonly id: string;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

@Injectable()
export class WebhookConsumer {
  private readonly logger = new Logger(WebhookConsumer.name);

  constructor(
    @InjectDataSource('merchant') private readonly merchant: DataSource,
    @Inject(WebhookRepository) private readonly webhooks: WebhookRepository,
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue,
  ) {}

  async handle(message: {
    subject: string;
    payload: Uint8Array;
  }): Promise<'processed' | 'duplicate' | 'ignored' | 'malformed'> {
    let envelope: WebhookEnvelope;
    try {
      envelope = JSON.parse(Buffer.from(message.payload).toString('utf8')) as WebhookEnvelope;
    } catch {
      this.logger.error({ subject: message.subject }, 'unparseable event payload');
      return 'malformed';
    }
    const wire = wireEvent(envelope.type);
    if (!wire) return 'ignored';

    const merchantId =
      typeof envelope.data.merchantId === 'string' ? envelope.data.merchantId : null;
    if (!merchantId) {
      this.logger.warn({ type: envelope.type }, 'event carries no merchant identity');
      return 'ignored';
    }

    const endpoints = await this.merchant.transaction((manager) =>
      this.webhooks.findActiveForEvent(manager, merchantId, wire),
    );
    if (endpoints.length === 0) return 'ignored';

    for (const endpoint of endpoints) {
      const deliveryId = `dlv_${envelope.id}_${endpoint.id.slice(0, 8)}`;
      await this.queue.add(
        'deliver',
        {
          deliveryId,
          endpointId: endpoint.id,
          merchantId,
          url: endpoint.url,
          secret: endpoint.secretHash,
          wireEvent: wire satisfies WebhookEvent as string,
          payload: {
            id: deliveryId,
            type: wire,
            occurredAt: envelope.occurredAt,
            data: envelope.data,
          },
          attempt: 1,
        },
        // Same outbox event redelivered enqueues the same job id: BullMQ dedupes,
        // and the receiver dedupes on ZipZap-Delivery. At-least-once, both ends.
        // No colons: BullMQ rejects them in custom job ids.
        { jobId: `${deliveryId}-attempt-1` },
      );
    }

    return 'processed';
  }
}
