/**
 * The worker's subscription table, extracted from worker.ts so specs can import it.
 *
 * worker.ts boots NATS and the Nest container on import, which makes it unimportable
 * from unit tests. This table is pure data — consumer name plus subject — so it lives
 * here and worker.ts imports it. subscriptions.spec.ts pins it against the consumers'
 * handled-event sets: a handler that maps an event nobody routes to it is a silent drop,
 * which is exactly how `CODCollected` missed the public timeline until 2026-10-04.
 */

export type SubscriptionConsumer = 'tracking' | 'finance' | 'webhook';

export interface NatsSubscription {
  readonly consumer: SubscriptionConsumer;
  readonly subject: string;
}

export const SUBSCRIPTIONS: readonly NatsSubscription[] = [
  { consumer: 'tracking', subject: 'zipzap.shipment.created' },
  { consumer: 'tracking', subject: 'zipzap.pickup.requested' },
  { consumer: 'tracking', subject: 'zipzap.pickup.assigned' },
  { consumer: 'tracking', subject: 'zipzap.delivery.out_for_delivery' },
  { consumer: 'tracking', subject: 'zipzap.delivery.attempted' },
  { consumer: 'tracking', subject: 'zipzap.delivery.completed' },
  { consumer: 'tracking', subject: 'zipzap.cod.collected' },
  { consumer: 'tracking', subject: 'zipzap.return.completed' },
  { consumer: 'tracking', subject: 'zipzap.return.requested' },
  { consumer: 'tracking', subject: 'zipzap.return.advanced' },
  { consumer: 'finance', subject: 'zipzap.cod.collected' },
  { consumer: 'finance', subject: 'zipzap.cod.partial_collection' },
  { consumer: 'finance', subject: 'zipzap.return.completed' },
  { consumer: 'webhook', subject: 'zipzap.shipment.created' },
  { consumer: 'webhook', subject: 'zipzap.delivery.out_for_delivery' },
  { consumer: 'webhook', subject: 'zipzap.delivery.completed' },
  { consumer: 'webhook', subject: 'zipzap.cod.collected' },
  { consumer: 'webhook', subject: 'zipzap.settlement.approved' },
  { consumer: 'webhook', subject: 'zipzap.settlement.completed' },
  { consumer: 'webhook', subject: 'zipzap.return.requested' },
  { consumer: 'webhook', subject: 'zipzap.return.completed' },
];
