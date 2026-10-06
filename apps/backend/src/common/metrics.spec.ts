/**
 * Metrics: SQL classification, NATS lag arithmetic, registry surface.
 *
 * The lag gauge reads two in-process maps (never the registry — that recurses),
 * so the published/consumed arithmetic is unit-testable without NATS.
 * Cardinality is a design-time contract: labels are bounded enums, route
 * templates and currency codes only — no entity ids anywhere.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyQuery,
  getNatsConsumerLag,
  incEventConsumed,
  incEventPublished,
  registry,
} from './metrics';

describe('classifyQuery', () => {
  it('labels the five DML and DDL statements', () => {
    expect(classifyQuery('SELECT * FROM shipments')).toBe('select');
    expect(classifyQuery('insert into shipment.shipments (id) values ($1)')).toBe('insert');
    expect(classifyQuery('  UPDATE cod.records SET status = $1')).toBe('update');
    expect(classifyQuery('DELETE FROM system.idempotency_keys')).toBe('delete');
    expect(classifyQuery('CREATE TABLE x (id serial)')).toBe('create');
    expect(classifyQuery('ALTER TABLE x ADD COLUMN y int')).toBe('alter');
    expect(classifyQuery('DROP TABLE x')).toBe('drop');
    expect(classifyQuery('TRUNCATE x')).toBe('truncate');
  });

  it('labels transaction control and everything else as bounded buckets', () => {
    expect(classifyQuery('BEGIN')).toBe('transaction');
    expect(classifyQuery('COMMIT')).toBe('transaction');
    expect(classifyQuery('ROLLBACK')).toBe('transaction');
    expect(classifyQuery('EXPLAIN SELECT 1')).toBe('select');
    expect(classifyQuery('SELECT 1; SELECT 2')).toBe('select');
    expect(classifyQuery('SHOW something')).toBe('other');
  });
});

describe('nats consumer lag', () => {
  it('equals published minus processed, floored at zero', () => {
    incEventPublished('zipzap.shipment.created');
    incEventPublished('zipzap.shipment.created');
    incEventConsumed('tracking', 'zipzap.shipment.created', 'processed');
    incEventConsumed('webhook', 'zipzap.shipment.created', 'ignored');

    // tracking has 1 pending (2 published - 1 handled on its subscription)
    expect(getNatsConsumerLag('tracking')).toBe(1);
    // webhook handled only 1 of the 2 published copies (its own subscription)
    expect(getNatsConsumerLag('webhook')).toBe(1);
    // notification received none of its copies yet
    expect(getNatsConsumerLag('notification')).toBe(2);
  });

  it('counts ignored and duplicate as handled, errors as backlog', () => {
    incEventPublished('zipzap.cod.collected');
    incEventConsumed('finance', 'zipzap.cod.collected', 'duplicate');
    expect(getNatsConsumerLag('finance')).toBe(0);

    incEventPublished('zipzap.cod.collected');
    incEventConsumed('finance', 'zipzap.cod.collected', 'error');
    expect(getNatsConsumerLag('finance')).toBe(1);
  });
});

describe('registry surface', () => {
  it('exposes every contract metric from docs/operations/observability.md', async () => {
    const names = (await registry.getMetricsAsJSON()).map((m) => m.name);
    for (const expected of [
      'zipzap_http_requests_total',
      'zipzap_http_request_duration_seconds',
      'zipzap_db_query_duration_seconds',
      'zipzap_db_pool_active_connections',
      'zipzap_outbox_pending_total',
      'zipzap_outbox_publish_total',
      'zipzap_outbox_publish_duration_seconds',
      'zipzap_nats_consumer_lag_total',
      'zipzap_queue_depth',
      'zipzap_job_failure_total',
      'zipzap_event_consumed_total',
      'zipzap_event_duplicate_total',
      'zipzap_shipments_created_total',
      'zipzap_shipments_delivered_total',
      'zipzap_deliveries_failed_total',
      'zipzap_cod_collected_total',
      'zipzap_settlements_completed_total',
    ]) {
      expect(names).toContain(expected);
    }
  });
});
