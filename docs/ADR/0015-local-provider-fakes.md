# ADR-0015: Local provider fakes over real sandbox accounts

**Status** accepted · 2026-10-02

## Context

ZipZap integrates with payment gateways (PayStation, Moneybag), domestic SMS providers
(MiMSMS), email, and object storage. Every one of them is outside our control:

- **Sandbox access requires a merchant application.** PayStation's sandbox exists but needs an
  account; Moneybag's is behind onboarding.
- **SMS costs money per message** and needs prepaid credit, in a currency, from a vendor.
- **Both are unavailable in CI** without credentials, and flaky in CI even with them.
- **Provider outages would fail our tests**, which is the worst possible coupling: our
  correctness signal should depend only on our code.

Without a local substitute, the settlement and notification paths — the parts where a bug costs
real money — cannot be tested at all until Phase 3.

## Decision

**Simulate the external providers locally, and keep the seam narrow enough that a real
integration is a one-line binding change.**

`infra/fakes` runs one Hono service standing in for PayStation, Moneybag, and the SMS
provider. It is never deployed and `apps/backend` has no knowledge of it.

### Requirements the fakes must satisfy

A fake that returns `200 OK` tests nothing. The failure paths are where this product breaks, so:

1. **Scriptable failure** — "fail the next two SMS sends, then succeed" is deterministic and
   assertable.
2. **Recorded calls** — assert what the product actually sent, with raw bodies preserved so an
   HMAC signature can be verified. Re-serialising a parsed body changes key order and breaks
   the signature.
3. **Retrying delivery** — the payment IPN dispatcher re-POSTs on non-2xx, so the _receiver_
   half of the idempotency contract is testable.
4. **Honest about fidelity** — see below.

### Fidelity is labelled per provider, not assumed

| Provider   | Status                                                             |
| ---------- | ------------------------------------------------------------------ |
| PayStation | **verified** against published documentation                       |
| MiMSMS     | **verified** against a published Postman collection (SMS API v2.1) |
| Moneybag   | **⚠️ shape-accurate only** — no public API reference is reachable  |

Unverified shapes are marked in the source file, in `infra/fakes/README.md`, and in the
service's own index response.

### What verification actually bought us

Two of the three providers turned out to contradict assumptions that a guessed fake would have
locked in:

- **MiMSMS rejects `+8801844909020`.** It wants `8801XXXXXXXXX`, no plus and no leading zero. The
  "normalise everything to E.164" reflex — which most integrations reach for automatically —
  is _wrong for this provider_. A guessed fake built on E.164 would have passed every test and
  failed on the first real send.
- **MiMSMS publishes the carrier's own retry policy per DLR code.** The most common real
  failure, `Absent subscriber for SM`, carries retry policy `3` — the carrier will retry. A fake
  that only reported "failed" would have hidden a rule that changes when we dead-letter.

Neither was findable by reasoning about what a bulk SMS API plausibly looks like. Both came from
reading the provider's own documentation. That is the argument for paying the cost of
retrieving it.

**This is the part that matters.** A fake that looks authoritative but is invented is worse
than no fake: it passes CI, and the first real integration fails on a field name nobody
checked. A labelled guess is a useful default; an unlabelled one is a trap.

### Email and object storage are real, not faked

Mailpit is a genuine SMTP server and MinIO is a genuine S3 implementation. They are real local
implementations of real protocols — no reason to reimplement either. Only payment and SMS are
simulated, because those are where a public sandbox costs money or does not exist.

## Consequences

### Positive

- Payment, COD, settlement, and notification paths are testable **now**, not in Phase 3.
- CI needs no credentials and no vendor account.
- Our test suite cannot fail because a provider had an incident.
- Retry ladders, dead-lettering, idempotent callbacks, and money conversion all become
  executable assertions rather than review arguments.
- Failure demos for the portfolio are reproducible on demand.

### Negative

- **Unverified shapes will not match the real API.** Accepted, and labelled. The adaptation
  cost is one adapter file, by design.
- **A fake that passes tells you nothing about the real integration.** Contract tests against
  a real sandbox are still required before go-live, and are tracked separately.
- **Money conversion is a live bug surface.** Providers speak decimal major units
  (`"1250.50"`); the domain speaks integer minor units (125050). The adapter must reject
  unexpected precision rather than truncate silently — see
  [../architecture/provider-adapters.md](../architecture/provider-adapters.md).
- **Another moving part.** `infra/fakes` is a service to run, though it is a single process with
  in-memory state and no database.

## Alternatives considered

**Real sandbox credentials in CI.** Rejected: secrets in CI, vendor coupling, flakiness, and
SMS that costs money per run.

**Mock at the adapter boundary** (jest/nock against the interface). Rejected as the _only_
strategy: it cannot test the IPN retry ladder, because nothing is actually on the other end to
retry against, and it cannot verify our outgoing payloads against a real HTTP contract.

Worth keeping as a complement for pure unit tests. Not a substitute.

**Testcontainers for providers.** No suitable image exists for PayStation or the BD SMS
providers, and they are not open source.

**One fake per provider as separate services.** Rejected: three processes to run for three
route groups, no isolation benefit, and a harder local story. One service with namespaced
routes wins.

**Defer until Phase 3.** Rejected: it means the settlement design is built and reviewed without
ever being executed, and the bugs found only at Phase 3 are architectural rather than local.

## Revisit when

- A real sandbox account exists → keep the fakes for CI, add contract tests against the real
  sandbox alongside them
- A provider's public API reference becomes available → replace the labelled shape and delete
  the "this is a guess" marker
- More than two providers per category need faking → split the service
