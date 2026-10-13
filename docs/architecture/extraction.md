# Extraction

Rule 5: microservices are an extraction strategy, not a starting architecture.

This page exists so that extraction, when it is justified, is a deployment change rather than a
rewrite — and so that it is _not_ done before then.

---

## What makes extraction possible today

Nothing about the monolith prevents it. Three properties do the work:

1. **A module owns its schema.** Extracting `tracking` means moving `tracking.events` and its
   consumers' interest. No other module reads that table, so no other module needs changing.
2. **Modules talk through contracts.** Synchronously, an injected service. Asynchronously, an
   event over NATS. Both already cross a process boundary in the microservice world — the
   interface does not change, only where it is hosted.
3. **The outbox already decouples publishing.** Events leave the database through NATS, not
   through in-process function calls. A consumer in another process is not a new mechanism.

## What extraction would actually require

Not a rewrite. A checklist:

- the module's events are already on NATS with stable schemas
- no module queries its tables directly (verified by `pnpm boundaries:check`)
- its consumers reference nothing but event payloads and identifiers
- its schema is separable — no cross-schema foreign keys (none exist by rule)
- it has an independent read and write load, or an independent team

Missing any of these means the boundary is aspirational, not real. Fix the boundary first.

## Candidates, with honest triggers

| Module           | Why it might be extracted                                 | Trigger                                             |
| ---------------- | --------------------------------------------------------- | --------------------------------------------------- |
| **Tracking**     | highest read volume by far; a natural read replica        | public tracking load degrades transactional latency |
| **Analytics**    | heaviest compute; entirely eventual                       | projections need resources the API must not share   |
| **Notification** | bursty, external-provider bound                           | provider latency affects other work                 |
| **Pricing**      | changes often; rule-driven; needs its own release cadence | pricing iterations block backend deploys            |
| **Warehouse**    | genuinely different workload and lifecycle                | warehousing becomes a real product                  |
| **Search**       | only once PostgreSQL is insufficient                      | search measurably insufficient                      |

Extraction is justified by a real reason: independent scaling, independent deployment, team
ownership, fault isolation, technology isolation, or a materially different workload.

It is not justified by "microservices are modern".

## Shape after extraction

```
              NATS
               │
   ┌───────────┼───────────┐
   ▼           ▼           ▼
Monolith   Tracking    Analytics
```

The contracts do not change. The module keeps explicit ownership of its data. The monolith gets
smaller, not different.

## What does not survive extraction

Being honest about the cost:

- **Cross-module transactions.** `delivery → cod → finance` is one transaction today. Split it
  and it becomes Saga with compensating actions. The failure modes multiply.
- **Synchronous calls become network calls.** Latency, timeouts, partial failure — all new.
- **Local debugging becomes distributed debugging.** A stack trace stops being an answer.
- **Cost goes up.** More deployables, more pipelines, more on-call surface.

This is why the monolith is the default. The savings from extraction have to be worth that bill.

## The decision, when it comes

Write an ADR. It needs: the trigger that fired, the measured numbers, the modules affected, the
transaction boundaries being broken, the migration sequence, and what happens to data during
the cutover.

That ADR will be a long document. This page is short because the decision has not been made yet,
and nothing here should make it easy to make prematurely.
