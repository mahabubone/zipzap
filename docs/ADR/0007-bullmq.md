# ADR-0007: BullMQ for background work

**Status** accepted · 2026-10-02

## Context

Sending an SMS, delivering a webhook, generating a report, and importing 10,000 rows must not
happen inside a request or inside a NATS consumer.

The reason is availability coupling. A merchant endpoint that hangs for 30 seconds must not hold
a NATS consumer, and an SMS provider outage must not prevent a shipment from being created.

## Decision

**NATS says what happened. BullMQ does the work. Never both in the same handler.**

```
Domain event → NATS → consumer → enqueue BullMQ job → worker → provider
```

Jobs: `SendSMS` · `SendEmail` · `SendWebhook` · `GenerateCSV` · `ProcessBulkImport` ·
`GenerateSettlementReport` · `RecalculateAnalytics` · `ExpirePickupRequest` ·
`RetryNotification`.

Workers run in `worker.ts`, separately scalable from the API.

Supporting decisions:

- Every job is **idempotent** on its natural key, because BullMQ retries.
- Retries with backoff, then a **dead-letter state that is visible**.
- Concurrency limits per queue, so a bulk import cannot starve a webhook delivery.
- Business payloads in the job, not a row id that may change underneath it.

## Consequences

### Positive

- Provider latency and provider outages stop affecting the operation that triggered the work.
- Retries, backoff, concurrency, and dead-lettering are solved rather than hand-rolled.
- Worker throughput scales independently of request throughput.
- A job that fails is visible with a reason, not silently dropped.

### Negative

- **Redis backs the queue**, so losing Redis loses in-flight jobs. Every job must therefore be
  re-triggerable and idempotent — a lost job must not become a lost effect.
- At-least-once execution, so every handler must be idempotent.
- Two async systems (NATS and Redis) to operate and reason about.
- Debugging a failure means looking in two places.

## Alternatives considered

**Do the work directly in the NATS consumer.** Rejected: couples consumer availability to provider
availability, and no natural retry or dead-letter story.

**NestJS `@nestjs/bullmq` vs raw BullMQ.** Chose the NestJS integration for DI and module
integration, while keeping handlers framework-free so the domain stays testable.

**Temporal.** A stronger durability model, and the right answer for long-running workflows like
multi-day settlement. Rejected as disproportionate now: significant operational overhead for
retries and backoff that BullMQ handles. Revisit if workflows become multi-day or
compensating.

**In-database job table plus polling.** Rejected: re-implements a queue, competes with
transactional queries, and is harder to operate than an off-the-shelf one.

**AWS SQS / SQS + Lambda.** Rejected: ties the deployment to a cloud provider for no benefit at
this stage.
