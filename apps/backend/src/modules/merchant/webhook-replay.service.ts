/**
 * Replay a terminal delivery on demand. The merchant fixed their endpoint and
 * wants the event again — pause, fix, replay, rather than missing events and
 * reconciling by hand.
 *
 * Reads the last terminal row for (endpoint, delivery-equivalent), re-enqueues
 * with a FRESH delivery id. The receiver dedupes on ZipZap-Delivery, so a replay
 * must not reuse the original id — same bytes with a new id is a new delivery,
 * and the log shows both. Replaying only terminal rows: a delivery still climbing
 * the ladder will arrive on its own; re-firing it now would double-deliver.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { Queue } from 'bullmq';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { WebhookRepository } from './webhook.repository.ts';
import { WEBHOOK_QUEUE } from './webhook.consumer.ts';

export interface ReplayDeliveryCommand {
  readonly merchantId: string;
  readonly deliveryId: string;
}

export interface ReplayedDelivery {
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly wireEvent: string;
}

@Injectable()
export class WebhookReplayService {
  constructor(
    @InjectDataSource('merchant') private readonly merchant: DataSource,
    @Inject(WebhookRepository) private readonly webhooks: WebhookRepository,
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue,
  ) {}

  async replay(command: ReplayDeliveryCommand): Promise<ReplayedDelivery> {
    const source = await this.merchant.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT endpoint_id, merchant_id, event_type, payload
           FROM merchant.webhook_deliveries
          WHERE id = $1 AND merchant_id = $2 AND terminal = true
          ORDER BY attempted_at DESC
          LIMIT 1`,
        [command.deliveryId, command.merchantId],
      );
      return rows[0] as
        | {
            endpoint_id: string;
            merchant_id: string;
            event_type: string;
            payload: Record<string, unknown>;
          }
        | undefined;
    });
    if (!source) throw new ResourceNotFoundError('Terminal delivery not found.');

    const endpoint = await this.merchant.transaction((manager) =>
      this.webhooks.findEndpoint(manager, source.endpoint_id),
    );
    if (!endpoint || endpoint.merchantId !== command.merchantId) {
      throw new ResourceNotFoundError('Webhook endpoint not found.');
    }
    if (endpoint.status === 'PAUSED') {
      throw new ResourceNotFoundError('Endpoint is paused; resume it before replaying.');
    }

    const deliveryId = `dlv_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await this.queue.add(
      'deliver',
      {
        deliveryId,
        endpointId: endpoint.id,
        merchantId: command.merchantId,
        url: endpoint.url,
        secret: endpoint.secretHash,
        wireEvent: source.event_type,
        payload: { ...(source.payload as object), id: deliveryId, replayOf: command.deliveryId },
        attempt: 1,
      },
      { jobId: `${deliveryId}-attempt-1` },
    );

    return { deliveryId, endpointId: endpoint.id, wireEvent: source.event_type };
  }
}
