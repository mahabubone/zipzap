# Observability

Logs explain, metrics alert, traces connect. Knowing which one to reach for is the skill.

---

## Traces

OpenTelemetry. Instrumented: HTTP · PostgreSQL · Redis · NATS · BullMQ · outbound providers.

The trace that matters:

```
POST /v1/shipments
  └─ CreateShipment
       ├─ SELECT merchant (pg)
       ├─ SELECT pricing rules (pg)
       ├─ INSERT shipment (pg)
       ├─ INSERT tracking event (pg)
       └─ INSERT outbox event (pg)
            ↓
       zipzap.shipment.created → NATS
            ↓
       ShipmentCreated consumer → INSERT analytics projection (pg)
            ↓
       ShipmentCreated consumer → enqueue webhook job
            ↓
       WebhookDelivery → POST merchant endpoint (external)
```

One trace, crossing six stores and one external call. When a merchant says "the webhook was
late", that span boundary is the answer — you can see whether the event was slow to publish,
the consumer was backed up, or the merchant's endpoint took four seconds.

## Logs

Structured pino. One line per event, JSON, to stdout.

```json
{
  "level": "info",
  "msg": "shipment.transitioned",
  "request_id": "req_123",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "event_type": "ShipmentDelivered",
  "merchant_id": "a71c…",
  "shipment_id": "b3f1…",
  "rider_id": "c9d2…",
  "hub_id": "d4e8…",
  "duration_ms": 47
}
```

Fields: `request_id` · `trace_id` · `merchant_id` · `shipment_id` · `rider_id` · `hub_id` ·
`event_type` · `duration_ms`.

Every log answers: **what happened, to which entity, by whom, when, and where?** A line that
cannot answer all five is noise.

Never logged: password · API secret · token · webhook signing secret · full payment credential.
Redact at the serialiser, so a new call site cannot leak by accident.

## Metrics

**Application**

```
http_requests_total          counter   by route, method, status
http_request_duration        histogram by route
db_query_duration            histogram by operation
db_pool_active               gauge
outbox_pending               gauge     ← the lag alarm
outbox_publish_total         counter   by outcome
outbox_publish_duration      histogram
nats_consumer_lag            gauge     per consumer ← the freshness alarm
queue_depth                  gauge     per BullMQ queue
job_failure_total            counter   by queue
event_consumed_total         counter   by consumer, outcome
event_duplicate_total        counter   by consumer
```

**Business**

```
shipments_created_total      counter
shipments_delivered_total    counter
deliveries_failed_total      counter   by reason
cod_collected_total          counter   amount, by currency
settlements_completed_total  counter   amount, by currency
```

Business metrics matter because an infrastructure dashboard tells you the system is up while the
business is on fire. COD collection dropping to zero is an outage that no 5xx rate will show.

## Dashboards

| Dashboard  | For                                                                   |
| ---------- | --------------------------------------------------------------------- |
| API        | latency percentiles, error rate, throughput, by route                 |
| Database   | pool, query duration, lock waits, connection count, slow queries      |
| Eventing   | outbox depth and publish rate, consumer lag, duplicates, dead letters |
| Workers    | queue depth, job duration, failure rate, worker count                 |
| Business   | shipments, deliveries, COD collected, settlement volume               |
| Operations | hub backlog, rider utilisation, exceptions, return rate               |

Six dashboards is one too many. Merge the first five into "Platform" with tabs.

## Alerts

| Alert          | Condition                          | Why it matters                             |
| -------------- | ---------------------------------- | ------------------------------------------ |
| Outbox backlog | `outbox_pending` > 1,000 for 5 min | events are late; every projection is stale |
| Consumer lag   | `nats_consumer_lag` growing 10 min | a consumer is stuck or down                |
| Error rate     | 5xx > 1% of requests, 5 min        | customer-facing                            |
| DB saturation  | pool active > 90% for 5 min        | about to fall over                         |
| Job failures   | `job_failure_total` rising 10 min  | webhooks or notifications silently failing |
| COD collection | drops to ~0 in an hour             | business outage the 5xx rate will not show |

The last one is why business metrics belong in the same alerting system as technical ones.

Alert on symptoms a human cares about, not on causes. "Outbox backlog" is a cause; "no COD
collected in an hour during business hours" is a symptom. Page on symptoms.

## Cardinality

Prometheus falls over on unbounded label values. Never label by `shipment_id`, `rider_id`,
`request_id`, `tracking_code`, or any URL containing an id.

Labels by route **template** (`/v1/shipments/:id`), not by concrete path. Per-entity counts
belong in a table or a log query, not a metric label.

## Dashboards before alerts

Every alert needs a dashboard link in the annotation. An alert without a dashboard costs more
than it saves — whoever is paged at 3am should not have to reconstruct the query.

---

Related: [../architecture/eventing.md](../architecture/eventing.md) ·
[performance.md](performance.md) · [reliability.md](reliability.md) ·
[../domains/analytics.md](../domains/analytics.md)
