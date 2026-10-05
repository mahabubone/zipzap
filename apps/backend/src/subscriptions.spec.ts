import { describe, expect, it } from 'vitest';
import { SUBSCRIPTIONS } from './subscriptions.ts';
import { subjectFor } from './modules/system/outbox.publisher.ts';
import { TRACKING_EVENT_MAP } from './modules/tracking/tracking.consumer.ts';
import { FINANCE_HANDLED_TYPES } from './modules/finance/finance-consumer.service.ts';
import { WEBHOOK_EVENTS } from './modules/merchant/rules/webhook.ts';

/**
 * The wiring that silently dropped CODCollected from the public timeline until
 * 2026-10-04: TrackingConsumer mapped the event, but the worker never routed the
 * subject to it. Three small tables — the subscription list, each consumer's handled
 * set, the outbox subject rule — must agree, and nothing else enforces it.
 *
 * What these prove: the subscribed subject set for each consumer is EXACTLY the
 * subject set its handled events publish to. A new event type mapped in a consumer
 * but never subscribed fails here; a stale subscription to a removed event fails
 * here too. Exact equality, not containment — containment lets dead entries linger.
 */

const AGGREGATE_OF: Record<string, string> = {
  ShipmentCreated: 'shipment',
  PickupRequested: 'pickup',
  PickupAssigned: 'pickup',
  DeliveryOutForDelivery: 'delivery',
  DeliveryAttempted: 'delivery',
  DeliveryCompleted: 'delivery',
  CODCollected: 'cod',
  CODPartialCollection: 'cod',
  SettlementApproved: 'settlement',
  SettlementCompleted: 'settlement',
  ReturnRequested: 'return',
  ReturnAdvanced: 'return',
  ReturnCompleted: 'return',
};

function subjectsOf(types: readonly string[]): Set<string> {
  return new Set(
    types.map((type) => {
      const aggregate = AGGREGATE_OF[type];
      expect(aggregate, `${type} needs an aggregate in AGGREGATE_OF`).toBeDefined();
      return subjectFor({ aggregate_type: aggregate!, event_type: type });
    }),
  );
}

function subscribed(consumer: 'tracking' | 'finance' | 'webhook' | 'notification'): Set<string> {
  return new Set(SUBSCRIPTIONS.filter((s) => s.consumer === consumer).map((s) => s.subject));
}

describe('subscription parity', () => {
  it('tracking subscribes to exactly its handled events', () => {
    expect(subscribed('tracking')).toEqual(subjectsOf(Object.keys(TRACKING_EVENT_MAP)));
  });

  it('finance subscribes to exactly its handled events', () => {
    expect(subscribed('finance')).toEqual(subjectsOf(FINANCE_HANDLED_TYPES));
  });

  it('webhook subscribes to exactly its wire-mapped events', () => {
    expect(subscribed('webhook')).toEqual(subjectsOf(Object.keys(WEBHOOK_EVENTS)));
  });

  it('notification subscribes to exactly its template-mapped events', () => {
    expect(subscribed('notification')).toEqual(
      subjectsOf(['ShipmentCreated', 'DeliveryOutForDelivery', 'DeliveryCompleted']),
    );
  });
});
