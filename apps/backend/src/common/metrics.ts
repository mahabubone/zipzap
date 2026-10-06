/**
 * ZipZap observability metrics (Prometheus).
 *
 * Phase 6, rung 2 — /metrics on all three entrypoints.
 *
 * Plain TypeScript with zero Nest / TypeORM / BullMQ coupling: metric
 * definitions, a per-datasource instrumentation registry (wired through
 * database/module-connection.ts across all 20 domain schemas), and scrape
 * handlers wired into main.ts, worker.ts and publisher.ts.
 *
 * Cardinality contract (docs/operations/observability.md): never label by
 * entity id (shipment_id, rider_id, request_id, tracking_code) and never by
 * a concrete URL path containing an id. Labels are route templates, method,
 * status, schema, operation, queue, consumer, subject and outcome.
 */

import * as promClient from 'prom-client';
import { SUBSCRIPTIONS, type SubscriptionConsumer } from '../subscriptions';
import type { DataSource } from 'typeorm';

/** Datasources keyed by their schema / connection name. Instrumented at creation. */
export const DatasourceRegistry = new Map<string, DataSource>();

// ----------------------------------------------------------------------------
// Registry
// ----------------------------------------------------------------------------

export const registry = new promClient.Registry();
registry.setDefaultLabels({ app: 'zipzap' });

/** Bounded process metrics with a ZipZap prefix. */
export function registerProcessMetrics(): void {
  promClient.collectDefaultMetrics({
    prefix: 'zipzap_process_',
    eventLoopMonitoringPrecision: 1000,
    register: registry,
  });
}

// ----------------------------------------------------------------------------
// HTTP — main.ts wires the middleware and the GET /metrics route
// ----------------------------------------------------------------------------

export const httpRequestsTotal = new promClient.Counter({
  name: 'zipzap_http_requests_total',
  help: 'Total HTTP requests by route template, method and status',
  labelNames: ['route', 'method', 'status'],
  registers: [registry],
});

export const httpRequestDuration = new promClient.Histogram({
  name: 'zipzap_http_request_duration_seconds',
  help: 'HTTP request duration in seconds by route template',
  labelNames: ['route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// ----------------------------------------------------------------------------
// PostgreSQL — registered in database/module-connection.ts
// ----------------------------------------------------------------------------

export const dbQueryDuration = new promClient.Histogram({
  name: 'zipzap_db_query_duration_seconds',
  help: 'PostgreSQL query duration in seconds by schema and operation',
  labelNames: ['schema', 'operation'],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const dbPoolActive = new promClient.Gauge({
  name: 'zipzap_db_pool_active_connections',
  help: 'Active (checked-out) connections in each schema-scoped pool',
  labelNames: ['schema'],
  async collect() {
    for (const [schema, ds] of DatasourceRegistry) {
      try {
        // TypeORM stores the pg Pool at driver.master (createPool in
        // PostgresDriver); it exposes totalCount / idleCount directly.
        const pool = (ds as { driver?: { master?: { totalCount?: number; idleCount?: number } } })
          .driver?.master;
        if (!pool || typeof pool.totalCount !== 'number') continue;
        const active = Number(pool.totalCount) - Number(pool.idleCount ?? 0);
        dbPoolActive.labels({ schema }).set(Math.max(0, active));
      } catch {
        // pool unavailable while draining; ignore rather than poison the scrape
      }
    }
  },
  registers: [registry],
});

/**
 * Register one schema-scoped DataSource in the instrumentation registry.
 *
 * The logger and maxQueryExecutionTime are attached where the DataSource is
 * built (moduleDataSourceOptions in database/module-connection.ts) so the
 * mapping stays a plain registration here.
 */
export function registerDataSource(schema: string, ds: DataSource): void {
  DatasourceRegistry.set(schema, ds);
}

/** Classify raw SQL into a bounded operation label. */
export function classifyQuery(query: string): string {
  const upper = query.trim().toUpperCase();
  if (upper.startsWith('PRAGMA')) return 'pragma';
  const m =
    upper.match(/^(?:EXPLAIN\s+(?:VARIABLE\s+)?(?:ANALYZE\s+)?)(\w+)/) ?? upper.match(/^(\w+)/);
  const top = m?.[1] ?? '';
  if (['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(top)) return top.toLowerCase();
  if (['CREATE', 'ALTER', 'DROP', 'TRUNCATE'].includes(top)) return top.toLowerCase();
  if (['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT'].includes(top)) return 'transaction';
  return 'other';
}

/**
 * Framework-free logger that captures query duration with zero console noise.
 * TypeORM calls these by name; providing the full surface keeps it safe when
 * logging is enabled at other levels.
 */
export const MetricsLogger = {
  logQuery(_query: string, _parameters: unknown[], _queryRunner?: unknown): void {
    // duration is captured by logQuerySlow; silence the verbose console write
  },

  logQueryError(
    _error: unknown,
    _query: string,
    _parameters: unknown[],
    _queryRunner?: unknown,
  ): void {
    // surfaced elsewhere; keep the metrics stream silent
  },

  logQuerySlow(time: number, query: string, _parameters: unknown[], _queryRunner?: unknown): void {
    const schema =
      (_queryRunner as { dataSource?: { options?: { schema?: string } } })?.dataSource?.options
        ?.schema ?? 'unknown';
    dbQueryDuration.labels({ schema, operation: classifyQuery(query) }).observe(time / 1000);
  },

  logSchemaBuild(_message: string, _queryRunner?: unknown): void {
    // schema build events are captured as "other" queries
  },

  logMigration(_message: string, _queryRunner?: unknown): void {
    // migrations run against system; their schema is picked up by other queries
  },

  log(_level: string, _message: unknown, _queryRunner?: unknown): void {
    // silence: nothing to surface
  },
} as const satisfies {
  logQuery(query: string, parameters: unknown[], queryRunner?: unknown): void;
  logQueryError(error: unknown, query: string, parameters: unknown[], queryRunner?: unknown): void;
  logQuerySlow(time: number, query: string, parameters: unknown[], queryRunner?: unknown): void;
  logSchemaBuild(message: string, queryRunner?: unknown): void;
  logMigration(message: string, queryRunner?: unknown): void;
  log(level: string, message: unknown, queryRunner?: unknown): void;
};

// ----------------------------------------------------------------------------
// Outbox — publisher.ts instruments publishBatch; gauge is refreshed per scrape
// ----------------------------------------------------------------------------

export const outboxPending = new promClient.Gauge({
  name: 'zipzap_outbox_pending_total',
  help: 'Outbox rows waiting to be published (lag alarm)',
  labelNames: ['schema'],
  async collect() {
    for (const [schema, ds] of DatasourceRegistry) {
      try {
        const res = await ds.query(
          'SELECT COUNT(*) FROM system.outbox_events WHERE published_at IS NULL',
        );
        outboxPending.labels({ schema }).set(Number(res[0]?.count ?? 0));
      } catch {
        // schema has no outbox table — skip it
      }
    }
  },
  registers: [registry],
});

export const outboxPublishTotal = new promClient.Counter({
  name: 'zipzap_outbox_publish_total',
  help: 'Outbox event publish attempts by outcome',
  labelNames: ['outcome'],
  registers: [registry],
});

export const outboxPublishDuration = new promClient.Histogram({
  name: 'zipzap_outbox_publish_duration_seconds',
  help: 'Time to publish one outbox event to NATS in seconds',
  labelNames: ['outcome'],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const eventPublishedTotal = new promClient.Counter({
  name: 'zipzap_event_published_total',
  help: 'Events published to NATS by subject',
  labelNames: ['subject'],
  registers: [registry],
});

// ----------------------------------------------------------------------------
// NATS consumer — worker.ts updates per message
// ----------------------------------------------------------------------------

export const eventConsumedTotal = new promClient.Counter({
  name: 'zipzap_event_consumed_total',
  help: 'NATS events consumed by consumer and outcome',
  labelNames: ['consumer', 'subject', 'outcome'],
  registers: [registry],
});

export const eventDuplicateTotal = new promClient.Counter({
  name: 'zipzap_event_duplicate_total',
  help: 'NATS events skipped as duplicates (at-least-once) by consumer',
  labelNames: ['consumer'],
  registers: [registry],
});

/**
 * In-process counters for NATS lag computation.
 *
 * The lag gauge must not read registry.getMetricsAsJSON() during its own
 * collection (that would re-trigger collection of itself and recurse).
 * These maps are updated by the same call sites that bump the Prometheus
 * counters, so the lag stays consistent with the published metrics.
 *
 * Handled counts are per consumer+subject: each queue-group subscription gets
 * its own copy of every event, so one consumer's 'processed' must not drain
 * another consumer's lag. Any outcome except 'error' counts as handled —
 * 'ignored' and 'malformed' are deliberate acknowledgements, not backlog.
 */
const eventPublishedCounts = new Map<string, number>();
const eventHandledCounts = new Map<string, number>();

/** Publish + track published-per-subject in one place. */
export function incEventPublished(subject: string): void {
  eventPublishedCounts.set(subject, (eventPublishedCounts.get(subject) ?? 0) + 1);
  eventPublishedTotal.labels({ subject }).inc();
}

/** Consume + track per-consumer handled counts in one place. */
export function incEventConsumed(
  consumer: SubscriptionConsumer,
  subject: string,
  outcome: string,
): void {
  if (outcome !== 'error') {
    const key = `${consumer}|${subject}`;
    eventHandledCounts.set(key, (eventHandledCounts.get(key) ?? 0) + 1);
  }
  eventConsumedTotal.labels({ consumer, subject, outcome }).inc();
}

/** Computed lag = published but not yet handled by this consumer, per subject. */
export function getNatsConsumerLag(consumer: SubscriptionConsumer): number {
  const subjects = SUBSCRIPTIONS.filter((s) => s.consumer === consumer).map((s) => s.subject);
  return subjects.reduce(
    (sum, subject) =>
      sum +
      Math.max(
        0,
        (eventPublishedCounts.get(subject) ?? 0) -
          (eventHandledCounts.get(`${consumer}|${subject}`) ?? 0),
      ),
    0,
  );
}

export const natsConsumerLag = new promClient.Gauge({
  name: 'zipzap_nats_consumer_lag_total',
  help: 'NATS events published but not yet handled, per consumer',
  labelNames: ['consumer'],
  collect() {
    for (const c of ['tracking', 'finance', 'webhook', 'notification'] as const) {
      natsConsumerLag.labels({ consumer: c }).set(getNatsConsumerLag(c));
    }
  },
  registers: [registry],
});

// ----------------------------------------------------------------------------
// BullMQ — worker.ts owns a Redis client for depth; modules wire job failures
// ----------------------------------------------------------------------------

/** Shared Redis client provided by worker.ts so depth can be read without
 * opening a new connection on every scrape. */
let queueClient: import('ioredis').Redis | null = null;

/** Tell worker.ts which Redis client to use; it then updates depth periodically. */
export function registerQueueClient(client: import('ioredis').Redis): void {
  queueClient = client;
  // warm the values and keep them fresh even if Prometheus scrapes fall behind.
  (async () => {
    try {
      await client.connect();
      for (const q of ['webhooks', 'notifications', 'bulk-import'] as const) {
        const prefix = 'bull';
        const wait = Number(await client.llen(`${prefix}:${q}:wait`)) ?? 0;
        const delayed = Number(await client.zcard(`${prefix}:${q}:delayed`)) ?? 0;
        const prioritized = Number(await client.llen(`${prefix}:${q}:prioritized`)) ?? 0;
        queueDepth.labels({ queue: q }).set(wait + delayed + prioritized);
      }
      await client.disconnect();
    } catch {
      // Redis down — leave depths at their last value
    }
  })();
  setInterval(() => {
    (async () => {
      try {
        if (!queueClient) return;
        await queueClient.connect();
        for (const q of ['webhooks', 'notifications', 'bulk-import'] as const) {
          const prefix = 'bull';
          const wait = Number(await queueClient.llen(`${prefix}:${q}:wait`)) ?? 0;
          const delayed = Number(await queueClient.zcard(`${prefix}:${q}:delayed`)) ?? 0;
          const prioritized = Number(await queueClient.llen(`${prefix}:${q}:prioritized`)) ?? 0;
          queueDepth.labels({ queue: q }).set(wait + delayed + prioritized);
        }
        await queueClient.disconnect();
      } catch {
        // Redis down — leave depth at its last value
      }
    })();
  }, 15_000);
}

export const queueDepth = new promClient.Gauge({
  name: 'zipzap_queue_depth',
  help: 'Jobs queued (waiting + delayed + prioritized) per BullMQ queue',
  labelNames: ['queue'],
  async collect() {
    if (!queueClient) return;
    try {
      for (const q of ['webhooks', 'notifications', 'bulk-import'] as const) {
        const prefix = 'bull';
        const wait = Number(await queueClient.llen(`${prefix}:${q}:wait`)) ?? 0;
        const delayed = Number(await queueClient.zcard(`${prefix}:${q}:delayed`)) ?? 0;
        const prioritized = Number(await queueClient.llen(`${prefix}:${q}:prioritized`)) ?? 0;
        queueDepth.labels({ queue: q }).set(wait + delayed + prioritized);
      }
    } catch {
      // Redis down during scrape — leave depth at its last value
    }
  },
  registers: [registry],
});

export const jobFailureTotal = new promClient.Counter({
  name: 'zipzap_job_failure_total',
  help: 'Failed BullMQ jobs by queue',
  labelNames: ['queue'],
  registers: [registry],
});

// ----------------------------------------------------------------------------
// Business — injected at mutation hooks across domain services
// ----------------------------------------------------------------------------

export const shipmentsCreatedTotal = new promClient.Counter({
  name: 'zipzap_shipments_created_total',
  help: 'Total shipments created',
  registers: [registry],
});

export const shipmentsDeliveredTotal = new promClient.Counter({
  name: 'zipzap_shipments_delivered_total',
  help: 'Total shipments delivered',
  registers: [registry],
});

export const deliveriesFailedTotal = new promClient.Counter({
  name: 'zipzap_deliveries_failed_total',
  help: 'Total failed delivery jobs by reason',
  labelNames: ['reason'],
  registers: [registry],
});

export const codCollectedTotal = new promClient.Counter({
  name: 'zipzap_cod_collected_total',
  help: 'Total COD amount collected (integer minor units), by currency',
  labelNames: ['currency'],
  registers: [registry],
});

export const settlementsCompletedTotal = new promClient.Counter({
  name: 'zipzap_settlements_completed_total',
  help: 'Total settlement amount paid out (integer minor units), by currency',
  labelNames: ['currency'],
  registers: [registry],
});
