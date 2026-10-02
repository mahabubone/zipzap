# Reliability

How the system behaves when a dependency is down, and what that behaviour must be.

The interesting property is not "it keeps running". It is **which operations keep running, and
which fail loudly**. A system that degrades silently is worse than one that is plainly down,
because the damage accumulates before anyone notices.

## The dependency matrix

| Failure                      | Effect                       | Correct behaviour                                                     |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| Postgres down                | everything that writes       | requests fail `503`. Nothing acknowledged, nothing lost.              |
| Redis down                   | rate limiting, cache, BullMQ | **writes fail closed**, reads fail open. Mutations queue in Postgres. |
| NATS down                    | events                       | mutations keep succeeding. Outbox accumulates.                        |
| Publisher down               | events                       | same. Outbox accumulates. This is the outbox working.                 |
| Worker down                  | jobs                         | jobs queue in Redis. Work is late, not lost.                          |
| Webhook endpoint down        | delivery                     | retries 1m → 5m → 15m → 1h → 6h → 24h, then a visible failed state.   |
| SMS provider down            | notifications                | retry, then dead-letter, visible in the console.                      |
| Process crash mid-work       | the work                     | job retries. No partial effect.                                       |
| Duplicate event              | consumer                     | skipped via `system.consumed_events`.                                 |
| Duplicate HTTP request       | mutation                     | original response replayed.                                           |
| Rider reconnects             | offline queue                | duplicates rejected, commands applied once.                           |
| Duplicate settlement request | settlement                   | one settlement.                                                       |

## The load-bearing decisions

**Outbox accumulation is success, not failure.** If NATS is down and the outbox grows, that is
the system protecting its transactions. An implementation that fails mutations when NATS is
unavailable has coupled a broker outage to order processing — and NATS is exactly the dependency
you least want controlling whether a merchant can create a shipment.

**Rate limiting fails closed on writes.** Redis is down; unlimited writes would push load onto
Postgres, the shared expensive resource the limit exists to protect. Availability of an API call
is worth less than availability of the database behind it.

**Redis is never authoritative.** No correctness decision reads from it. Losing it costs
performance and throttling, not data.

**NATS is never authoritative.** Same. Losing it costs freshness. The outbox is the durable
record.

## Degradation order

What should stop first when the system is under strain?

```
1. analytics projections     discardable
2. notification sends         deferrable
3. webhook deliveries         deferrable, retried for 24h
4. dashboard queries          expensive, read-only
5. bulk imports               heavy, deferrable
6. shipment creation          the product
7. tracking reads             the product
```

Analytics before transactions. Always. A slow projection is a stale chart; a slow transaction is
a merchant who cannot ship.

## Idempotency is what makes retry safe

Every row in the matrix involving "duplicate" or "retry" is handled by the same mechanism:
[../api/idempotency.md](../api/idempotency.md). That is why it is mandatory on COD collection
and settlement approval — those are the retries that move money.

## Recovery

**Postgres.** Fail fast on connection acquisition, return 503 with `Retry-After`. Do not queue
mutations in memory: a process that accepts writes it cannot persist is a system that loses them
on restart, and it lies to the client about it.

**Outbox.** The publisher resumes on restart and drains oldest-first. No reconciliation step, no
manual repair — the rows were never acknowledged anywhere else.

**Redis.** BullMQ jobs persist in Redis; if Redis is lost, in-flight jobs are lost. Accept it,
and make every job idempotent so a lost job is re-triggerable rather than a lost effect.

**Partial transaction.** PostgreSQL DDL and DML are both transactional. A rolled-back
transaction leaves nothing — which is why the outbox row is written _inside_ it and not after.

## Chaos testing

Deliberately induce each failure and assert the table above. Not once at the end — regularly, in
CI where possible, and against a seeded environment.

The questions worth asking:

- did the request fail, or did it silently do nothing?
- is the failure visible to a human without reading logs?
- is anything acknowledged that was not committed?
- after recovery, is the state exactly what it would have been with no outage?

That last question is the one that matters. Not "did it come back" — "is it correct now".

---

Related: [observability.md](observability.md) · [../architecture/eventing.md](../architecture/eventing.md) ·
[../testing/strategy.md](../testing/strategy.md)
