import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { subjectFor } from './outbox.publisher.ts';

/**
 * The subject is a public contract: consumers subscribe to it. Once published in production
 * it cannot change without a migration, so the naming rule is asserted rather than implied.
 */
describe('subjectFor', () => {
  const subject = (aggregate: string, type: string): string =>
    subjectFor({ aggregate_type: aggregate, event_type: type });

  test('strips the aggregate prefix — no zipzap.shipment.shipment_delivered', () => {
    assert.equal(subject('shipment', 'ShipmentDelivered'), 'zipzap.shipment.delivered');
    assert.equal(subject('settlement', 'SettlementCompleted'), 'zipzap.settlement.completed');
    assert.equal(subject('cod', 'CODCollected'), 'zipzap.cod.collected');
  });

  test('handles multi-word aggregates', () => {
    assert.equal(subject('network', 'NetworkRouteCreated'), 'zipzap.network.route_created');
  });

  test('snake_cases the remaining fact', () => {
    assert.equal(subject('delivery', 'DeliveryAttempted'), 'zipzap.delivery.attempted');
    assert.equal(subject('delivery', 'DeliveryOutForDelivery'), 'zipzap.delivery.out_for_delivery');
  });

  test('falls back to the whole event name when the prefix does not match', () => {
    // Redundant but correct beats broken: an unexpected event name must still be routable.
    assert.equal(
      subject('shipment', 'SomethingElseHappened'),
      'zipzap.shipment.something_else_happened',
    );
  });

  test('requires a word boundary — cod must not match CodeDelivered', () => {
    assert.equal(subject('cod', 'CodeDelivered'), 'zipzap.cod.code_delivered');
  });

  test('is deterministic', () => {
    assert.equal(subject('rider', 'RiderAssigned'), subject('rider', 'RiderAssigned'));
  });
});
