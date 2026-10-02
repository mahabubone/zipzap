# Eventing

Events say what happened. Jobs do the work. Keeping these separate is most of the architecture.

---

## NATS says what happened

A domain event is a business fact, already true, stated in the past tense.

```
ShipmentDelivered   not   RowUpdated
ShipmentPickupRequested   not   ShipmentInserted
```

If subscribers need to know your table layout to consume your event, you have published a
database change and coupled every consumer to your migrations.

An event carries identifiers and amounts, not row snapshots:

```ts
{
  type: 'ShipmentDelivered',
  version: 1,
  aggregateId: 'b3f1...',         // shipment
  occurredAt: '2026-10-02T10:15:00Z',
  data: {
    merchantId: 'a71c...',
    trackingCode: 'ZP-8F32A1',
    deliveredAt: '2026-10-02T10:14:22Z',
    codAmount: { amountMinor: 125050, currency: 'BDT' },
    collectedAmount: { amountMinor: 125050, currency: 'BDT' },
  },
}
```

`metadata` and `request_id` ride along in an envelope for tracing. What is _not_ in the payload
is the point: a recipient's name is not, a merchant's internal notes are not, and the full
shipment row definitely is not.

## BullMQ does the work

```
NATS event  →  BullMQ job  →  send SMS, deliver webhook, generate report
```

Sending an SMS inside a NATS consumer couples consumer availability to a third party's uptime.
Enqueueing the job does not.

Retries, backoff, concurrency limits, and dead-letter handling are BullMQ's job, and it does
them better than a hand-rolled consumer loop.

## The outbox

Publishing to NATS inside a database transaction has two problems: NATS has no idea how to join
your transaction, and you cannot roll back a message you already sent. Either order loses data.

```
BEGIN
  UPDATE shipment.shipments SET status = 'delivered' WHERE id = $1;
  INSERT INTO tracking.events      (...) VALUES (...);
  INSERT INTO system.outbox_events (...) VALUES (...);
COMMIT
```

then, separately, the publisher drains the outbox to NATS.

```sql
CREATE TABLE system.outbox_events (
  id            bigserial PRIMARY KEY,
  event_type    text        NOT NULL,
  event_version int         NOT NULL,
  aggregate_type text       NOT NULL,
  aggregate_id  uuid        NOT NULL,
  payload       jsonb       NOT NULL,
  occurred_at   timestamptz NOT NULL,
  published_at  timestamptz,
  attempts      int         NOT NULL DEFAULT 0,
  last_error    text
);

CREATE INDEX ON system.outbox_events (id) WHERE published_at IS NULL;
```

Every mutation writes an outbox row **in the same transaction**. Not after. Not from a decorator
that runs later. In the same transaction.

## The publisher

`publisher.ts`. The only process permitted to publish to NATS.

```
SELECT ... WHERE published_at IS NULL ORDER BY id LIMIT 100
FOR UPDATE SKIP LOCKED      -- several publishers may run
  → publish to JetStream
  → UPDATE published_at = now()
```

`SKIP LOCKED` means multiple publisher replicas do not block each other and a crashed publisher
does not lose rows — an unpublished row is simply picked up again.

Ordering: JetStream gives per-subject ordering. Aggregates that need strict ordering get
per-aggregate ordering via subject partitioning. Across aggregates, order does not matter — a
delivery cannot precede its own dispatch, because that is enforced by the state machine, not by
the message stream.

## At-least-once, so consumers must be idempotent

The outbox guarantees a row is _eventually_ published. It cannot guarantee exactly-once delivery
across a database and a message broker. Assume every event arrives twice.

```
publisher crashes after NATS accepts, before published_at is written
  → same event republished on restart
```

This is not a bug to engineer away; it is the shape of the problem. The answer is consumer-side
idempotency: record the event id, skip if seen.

```sql
CREATE TABLE system.consumed_events (
  consumer text NOT NULL,
  event_id  bigint NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
```

Insert first, process second. If the insert conflicts, skip — you have already handled it.

## Subjects

```
zipzap.shipment.created
zipzap.shipment.pickup_requested
zipzap.shipment.picked_up
zipzap.shipment.arrived_at_hub
zipzap.shipment.dispatched
zipzap.shipment.arrived_at_destination_hub
zipzap.shipment.out_for_delivery
zipzap.shipment.delivered
zipzap.shipment.delivery_failed
zipzap.return.requested
zipzap.return.approved
zipzap.return.completed
zipzap.cod.collected
zipzap.cod.reconciled
zipzap.settlement.created
zipzap.settlement.approved
zipzap.settlement.completed
zipzap.merchant.created
zipzap.merchant.verified
zipzap.rider.assigned
zipzap.rider.location_updated
zipzap.webhook.delivery_succeeded
zipzap.webhook.delivery_failed
```

Dotted, lowercase, past tense. `zipzap.<aggregate>.<fact>`.

Version in the payload (`version: 1`), not the subject — adding a field is then a compatible
change and adding `zipzap.shipment.delivered.v2` is not something you have to think about.

## Consumers

| Consumer       | Does                                  | Must be idempotent because                     |
| -------------- | ------------------------------------- | ---------------------------------------------- |
| `tracking`     | appends public timeline entries       | events replay after a restart                  |
| `notification` | enqueues SMS/email/push jobs          | a customer receiving two SMS is a real failure |
| `analytics`    | updates projections                   | projections rebuild from scratch               |
| `finance`      | writes ledger entries from COD events | reconciliation re-reads events                 |
| `webhook`      | enqueues webhook deliveries           | merchants count duplicates as incidents        |

Every one of them. The rule has no exceptions, which is why it is a rule.

## Failure behaviour

| Failure                    | Behaviour                                                                         |
| -------------------------- | --------------------------------------------------------------------------------- |
| PostgreSQL down            | Requests fail 503. Nothing is lost; nothing was acknowledged.                     |
| Redis down                 | Rate limiting fails **closed** on mutations. Cache misses are fine.               |
| NATS down                  | Outbox rows accumulate. Mutations keep succeeding — correctly. Publisher retries. |
| Publisher down             | Same. Rows accumulate, nothing is lost. This is the outbox working.               |
| Worker down                | Jobs queue in Redis. No work is lost; it is late.                                 |
| Webhook endpoint down      | Retries 1m → 5m → 15m → 1h → 6h → 24h, then a visible failed state.               |
| Duplicate event            | Consumer skips via `system.consumed_events`.                                      |
| Event arrives out of order | Consumers ignore events that do not apply; the state machine rejected the write.  |

The last row matters most. Event ordering is best-effort per aggregate; **correctness comes from
the state machine**, which rejects an invalid transition regardless of arrival order. A
`Delivered` event arriving before `ArrivedAtHub` is discarded, not applied.

## Observable

Every event logs `event_id`, `event_type`, `aggregate_id`, `trace_id`, and outcome. Metrics:

```
outbox_pending            gauge   rows not yet published — the lag alarm
outbox_publish_total      counter by outcome
outbox_publish_duration   histogram
nats_consumer_lag         gauge   per consumer — the freshness alarm
event_consumed_total      counter by consumer, outcome
event_duplicate_total     counter by consumer
```

`outbox_pending` climbing is the system telling you events are late. That is the signal to page
on, and it exists only because of the outbox.

## Consumer placement

A consumer belongs in whichever process suits its workload, and the choice is per-consumer:

| Consumer                  | Process                          | Why                              |
| ------------------------- | -------------------------------- | -------------------------------- |
| `tracking`, `finance`     | `worker.ts`                      | correctness-critical             |
| `notification`, `webhook` | `worker.ts`                      | queue-driven, high volume        |
| `analytics`               | `worker.ts`, scalable separately | heaviest, most tolerant of delay |

All three processes import the same modules. Never duplicate a domain module per process.
