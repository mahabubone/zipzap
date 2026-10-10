/**
 * Notification fan-out consumer: NATS event in, BullMQ jobs out. Never sends inline.
 *
 * Subscribes to the parcel lifecycle subjects, resolves the recipient through the
 * shipment lookup, renders the versioned template, and enqueues one job per
 * (event, recipient). Idempotent on (eventId, channel, recipient): the same
 * outbox event redelivered converges on the same message row.
 *
 * A provider outage must not affect the operation that triggered the send — the
 * queue absorbs the latency, the ladder absorbs the failure.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { Queue } from 'bullmq';
import { NotificationRepository } from './notification.repository.ts';
import { SHIPMENT_LOOKUP, type ShipmentLookup } from '../shipment/shipment.lookup.ts';
import { renderTemplate, SMS_TEMPLATES } from './sms-templates.ts';
import { dedupeKey } from './rules/channel.ts';
import { TEMPLATE_OF, isEnabled } from './rules/preferences.ts';

export const NOTIFICATION_CONSUMER = 'notification';
export const NOTIFICATION_QUEUE = 'notifications';

interface NotificationEnvelope {
  readonly id: string;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

@Injectable()
export class NotificationConsumer {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    @InjectDataSource('notification') private readonly notifications: DataSource,
    @Inject(NotificationRepository) private readonly repository: NotificationRepository,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    @Inject(SHIPMENT_LOOKUP) private readonly shipments: ShipmentLookup,
  ) {}

  /**
   * Whether this merchant still wants this event, read inside the caller's transaction.
   *
   * The lookup is one extra indexed read per event, which is the cheap way to keep a preference
   * decision in the same transaction as the message it governs: a merchant who opts out while a
   * batch is in flight either loses that message or keeps it, and both are defensible — what is not
   * defensible is the two halves committing separately and a message existing that no preference
   * ever allowed.
   */
  private async allowed(
    manager: EntityManager,
    shipmentId: string,
    eventType: string,
  ): Promise<boolean> {
    const merchantId = await this.shipments.findMerchantId(shipmentId);
    if (!merchantId) {
      // An event about a parcel with no owner has no preference to honour. Sending to a customer
      // because a lookup failed is the wrong default; skipping is invisible and reversible.
      this.logger.warn({ shipmentId, eventType }, 'no merchant for shipment; not notifying');
      return false;
    }
    const rows = await this.repository.findPreferences(manager, merchantId);
    return isEnabled(rows, eventType);
  }

  async handle(message: {
    subject: string;
    payload: Uint8Array;
  }): Promise<'processed' | 'duplicate' | 'ignored' | 'malformed'> {
    let envelope: NotificationEnvelope;
    try {
      envelope = JSON.parse(Buffer.from(message.payload).toString('utf8')) as NotificationEnvelope;
    } catch {
      this.logger.error({ subject: message.subject }, 'unparseable event payload');
      return 'malformed';
    }

    const templateName = TEMPLATE_OF[envelope.type];
    if (!templateName) return 'ignored';

    // Shipment-scoped events name the parcel in data.shipmentId — except the
    // shipment module's own events (ShipmentCreated et al), which carry it in
    // aggregateId when aggregateType is `shipment`. Same fallback shape as the
    // tracking consumer: without it the first event of every lifecycle drops.
    let shipmentId = typeof envelope.data.shipmentId === 'string' ? envelope.data.shipmentId : null;
    if (!shipmentId && envelope.aggregateType === 'shipment') {
      shipmentId = envelope.aggregateId;
    }
    if (!shipmentId) {
      this.logger.warn({ type: envelope.type }, 'event carries no shipment identity');
      return 'ignored';
    }

    const recipient = await this.shipments.findRecipient(shipmentId);
    if (!recipient) {
      this.logger.warn({ shipmentId }, 'unknown shipment in event');
      return 'ignored';
    }

    const template =
      SMS_TEMPLATES.find((t) => t.name === templateName && t.locale === 'en') ??
      SMS_TEMPLATES.find((t) => t.name === templateName);
    if (!template) {
      this.logger.warn({ templateName }, 'no template for event');
      return 'ignored';
    }

    const trackingCode =
      typeof envelope.data.trackingCode === 'string' ? envelope.data.trackingCode : '';
    const body = renderTemplate(template.body, {
      trackingCode,
      amount: '',
    });

    return this.notifications.transaction(async (manager) => {
      const key = dedupeKey(envelope.id, 'sms', recipient.phone);
      const existing = await this.repository.findMessageByDedupe(
        manager,
        envelope.id,
        'sms',
        recipient.phone,
      );
      if (existing) return 'duplicate';

      // After the dedupe check, before anything is written. Order matters: a muted event should
      // leave no message row, or the merchant's own history shows messages they asked not to get.
      if (!(await this.allowed(manager, shipmentId, envelope.type))) {
        this.logger.warn(
          { shipmentId, eventType: envelope.type },
          'merchant opted out of this notification',
        );
        return 'ignored';
      }

      const saved = await this.repository.insertMessage(manager, {
        id: randomUUID(),
        eventId: envelope.id,
        channel: 'sms',
        recipient: recipient.phone,
        templateName: template.name,
        templateVersion: template.version,
        body,
        status: 'QUEUED',
        createdAt: new Date(),
      } as never);

      await this.queue.add(
        'send',
        {
          messageId: saved.id,
          eventId: envelope.id,
          recipient: recipient.phone,
          body,
          attempt: 1,
        },
        { jobId: `${key}-attempt-1` },
      );

      return 'processed';
    });
  }
}
