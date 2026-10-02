# ADR-0014: Service extraction is a decision, not a plan

**Status** proposed · 2026-10-02

## Context

[ADR-0001](0001-modular-monolith.md) chose a monolith with enforced module boundaries. The
boundaries exist so extraction is possible later.

That creates a risk worth naming: the presence of boundaries is easily read as permission to
extract. It is not. Boundaries make extraction _possible_; they do not make it _warranted_.

Splitting `delivery → cod → finance` — one transaction today — into three services turns it into
a Saga with compensating actions. That is a real cost, adopted for speculative benefit.

## Decision

**Extraction happens only when a specific, measured trigger fires — and the decision gets its own
ADR at that time.**

Triggers: independent scaling · independent deployment · team ownership · fault isolation ·
technology isolation · a materially different workload.

**Not** a trigger: microservices are modern, a blog post recommends it, or the module "feels
big".

### Candidates, with honest triggers

| Module       | Trigger                                             |
| ------------ | --------------------------------------------------- |
| Tracking     | public tracking load degrades transactional latency |
| Analytics    | projections need resources the API must not share   |
| Notification | provider latency affects other work                 |
| Pricing      | pricing changes block backend deploys               |
| Warehouse    | warehousing becomes a real product                  |
| Search       | PostgreSQL search is measurably insufficient        |

### Preconditions, all of which must already hold

- events on NATS with stable schemas
- no module querying its tables directly (CI grep green)
- consumers referencing only payloads and identifiers
- a separable schema with no cross-schema foreign keys
- an independent read/write profile

Missing any one means the boundary is aspirational. **Fix the boundary, not the deployment.**

## Consequences

### Positive

- No speculative distribution cost while there is no scale problem to solve.
- `delivery → cod → finance` stays one transaction, which is where the correctness is.
- Extraction is still available, and is a deployment change rather than a rewrite.
- The "when" question has an answer that is not "as soon as possible".

### Negative

- Some scaling problems will be solved crudely at first — one process contended between
  analytics and tracking. Accepted; the entrypoints already separate the roles.
- A team under deadline pressure may reach for extraction to feel productive. This ADR exists to
  make that a documented no.
- Growth to a genuinely large operation will eventually require it, and it will be more work
  than doing it first would have been.

## Alternatives considered

**Plan for extraction now; extract when needed.** Rejected: "plan for it" reliably turns into
"extract the easy one first", and extracting only some of a strongly-connected group leaves a
worse architecture than either extreme.

**Microservices-ready frameworks** — enforced contracts, per-module deploys, shared databases with
ownership metadata. Rejected: the enforcement this ADR needs is a module boundary plus a CI grep.
The rest is a lot of machinery for a problem that does not exist yet.

**Extract one module deliberately now, to prove it works.** The most tempting option, and worth
stating why it is wrong: the one module that is easiest to extract alone — tracking — is the one
that benefits least. The hard cases are the tightly coupled ones, and splitting the easy ones
proves nothing about them while adding a network boundary to a working system.
