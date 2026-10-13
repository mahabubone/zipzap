# Database

PostgreSQL 16+ with PostGIS. The only source of truth in the system.

---

## Schemas

One schema per module. The schema _is_ the boundary.

| Schema         | Module       | Owns                                                                                |
| -------------- | ------------ | ----------------------------------------------------------------------------------- |
| `identity`     | identity     | users, user_merchants (roles are code; sessions and API credentials are merchant's) |
| `merchant`     | merchant     | merchants, branches, addresses, contracts, api_credentials, sessions, webhooks      |
| `customer`     | customer     | customers, phones, addresses                                                        |
| `shipment`     | shipment     | shipments, parcels, scans, bulk_jobs, bulk_rows                                     |
| `pickup`       | pickup       | pickup requests, batches, assignments, attempts                                     |
| `hub`          | hub          | hubs, staff, capacity, schedules                                                    |
| `network`      | network      | geo hierarchy (division→…→delivery point), service areas, routes, manifests, trips  |
| `rider`        | rider        | riders, devices, availability, performance, command_queue (offline sync)            |
| `delivery`     | delivery     | delivery jobs, attempts, proof                                                      |
| `tracking`     | tracking     | tracking events (append-only)                                                       |
| `pricing`      | pricing      | pricing rules, quotes, contracts                                                    |
| `cod`          | cod          | COD records, collection attempts                                                    |
| `finance`      | finance      | ledger accounts, entries, settlements                                               |
| `returns`      | returns      | return requests, approvals                                                          |
| `notification` | notification | templates, messages, deliveries, merchant_preferences                               |
| `support`      | support      | tickets, messages, status history                                                   |
| `warehouse`    | warehouse    | warehouses, bins, inventory, movements                                              |
| `analytics`    | analytics    | projections only                                                                    |
| `dashboard`    | dashboard    | none — read-only control-tower surface, no tables                                   |
| `system`       | system       | outbox, idempotency keys, consumed events, audit events (append-only)               |

No foreign keys across schemas. A `rider_id` in `delivery` is a bare identifier — an
application-level reference, not a constraint. See
[module-boundaries.md](module-boundaries.md).

## Migrations only

```ts
TypeOrmModule.forRoot({ synchronize: false }); // permanently
```

`synchronize: true` is forbidden in every environment. It has silently dropped columns in
production deployments of countless projects, and it makes the schema on disk diverge from the
schema in version control.

Rules:

- Every schema change is a reviewed migration.
- Never edit a migration that has been applied anywhere. Write a new one.
- Migrations are code — reviewed, ordered, and shipped like code.
- Generated types from TypeORM are not a schema. The migration is.

```bash
pnpm --filter @zipzap/backend db:migrate   # apply
pnpm --filter @zipzap/backend db:revert    # roll back the last one
```

## Identity and multi-business

A login is a **person** (`identity.users`); a **membership** (`identity.user_merchants`) is that
person's role inside one merchant. One person may hold several, which is why tenancy is a set rather
than a single id: `ApiPrincipal.merchantId` is the active business, `merchantIds` is every business
the principal may act inside, and `assertTenant` checks membership. A business outside the set gets
the same 404 as one that does not exist.

`role` sits on the **membership**, not on the user and not on the session, so one person can be an
operator in one store and an owner in another. It is a `text` column with a CHECK rather than a
Postgres enum, for the same reason the session role was: the vocabulary is code
(`identity/rules/roles.ts`) and an enum needs a migration every time a role is added.

`user_merchants.merchant_id` and `sessions.user_id` are **bare uuids, never foreign keys** — the
counterpart table belongs to another module, and a cross-schema FK is the coupling
[ADR-0002](../ADR/0002-postgresql-schema-boundaries.md) exists to prevent.

Migration 0036 moved the password hash off `merchant.merchants` onto `identity.users` and dropped
`sessions.role`, backfilling one user and one `MERCHANT_OWNER` membership per merchant that had a
password. Both columns were **dropped, not nulled**: each now has one source of truth, and leaving a
second copy of a credential in the database is one more thing to rotate and one more place to leak
from.

The membership table has been **writable since 2026-10-11** (migration 0048 added the `members:manage`
scope). `user_merchants.merchant_id` still has no foreign key, so a membership can name a business
that does not exist — the write path checks through `MERCHANT_LOOKUP` rather than by querying across
the boundary, and a membership for a business that has since been deleted is left alone rather than
cascaded, because `merchant` owns that decision.

## Naming

Entities `PascalCase`, fields `camelCase`, columns `snake_case` via the shared naming strategy.
Do not hand-name columns — the strategy exists so that it is impossible to forget.

Migrations use TypeORM's `Table`/`TableColumn` API, which emits explicit column names. That
output is expected; do not "clean it up".

## Types that matter

**Money is `bigint`.** Minor units plus a currency column. `125050` poisha. Never `numeric`
for money, never `float`, never a JS `number` past 2^53.

```sql
cod_amount       bigint  NOT NULL,
cod_currency     char(3) NOT NULL,
```

See [money-and-ledger.md](money-and-ledger.md).

**Geometry is `geography`, not `geometry`.** Distance in metres, not degrees.

```sql
location   geography(Point, 4326)   NOT NULL,
area       geography(MultiPolygon, 4326)
```

The 4326 SRID is deliberate. Bangladesh spans roughly 20.5°N–26.6°N, where a degree of
longitude is ~97 km and a degree of latitude ~111 km. Plane math would be meaningfully wrong
over a district. `geography` uses a spheroid and is correct at this scale.

Indexes: `GIST` on every geometry column. Coverage and service-area lookups are the hottest
queries in the system.

**Identifiers.** `uuid` primary keys, generated by Postgres (`gen_random_uuid()`), not by the
application. Tracking codes are a separate, human-facing, collision-checked value — never the
primary key.

## The reviewer's decision is its own columns

`cod.records` carries `review_note text`, `reviewed_by uuid` and `reviewed_at timestamptz`, added by
`1759000000038-CodExceptionReview`.

It also still carries `failure_note`, which is never written. **That is deliberate, and the reason
is the difference in shape.** A failure note describes a problem; a reviewer note records a
decision. One nullable text column cannot honestly hold both, and the second is the one the
reconciliation queue is built around — it is what tells the next person that somebody already looked
at this parcel and concluded the rider was right.

The partial index below is what makes the queue cheap, and it is written to be usable:

```sql
CREATE INDEX records_open_exceptions_idx
  ON cod.records (merchant_id, created_at DESC)
  WHERE status = 'RECONCILIATION_EXCEPTION';
```

`exceptionsFor` therefore pins `status = 'RECONCILIATION_EXCEPTION'` in its `WHERE` rather than
filtering in application code — filtering afterwards would not use the index, and the queue is the
one COD query an operator waits on.

`merchant.merchants.plan text NOT NULL DEFAULT 'standard'` came from `1759000000039-MerchantPlan`.
The plan used to be a **request body field** on both `POST /v1/pricing/quote` and
`POST /v1/shipments`, which meant any caller could name `"growth"` and be quoted the 1000bps
discount. It is a column now, read through `MERCHANT_PLAN_LOOKUP` (rule 2: pricing may not open
`merchant`). The backfill is `standard` — 0bps — so no existing merchant's price changed.

## Projections are re-grained, never duplicated

`analytics.cod_summary` is keyed `(merchant_id, day, currency)` since migration `0047`. It used
to be `(day, currency)` — network-wide, so a merchant had nowhere to read their own money from.
Re-grained rather than copied beside a network table: two tables holding the same collections
must agree, and the sum silently stopping equaling the whole is a bug you find by accident.
Summing the merchant rows reproduces the network figure exactly.

`analytics.merchant_daily_shipments` is keyed `(merchant_id, day)`. Both are projections —
rebuildable from the outbox, never authoritative ([../domains/analytics.md](../domains/analytics.md)).

## A preference is a row, and its absence is the answer

`notification.merchant_preferences` (migration `1759000000045`) is `(merchant_id, event_type,
enabled, updated_at)` keyed on `(merchant_id, event_type)`. Two decisions in it are not the
obvious ones:

**Absent means send.** A merchant is opted out by _writing_ a row. There is no `is_default`
column and no row for a merchant who has never touched the screen. Defaulting off would silently
stop every merchant being told where their parcels are, and nothing anywhere would report it —
a failure with no symptom. Re-enabling **deletes** the row rather than storing `enabled = true`,
so absence stays the single way to say "default" and the table never accumulates rows that say
nothing.

**The event vocabulary is imported, not retyped.** The `CHECK (event_type IN (...))` list is
built from `NOTIFIABLE_EVENTS` in `modules/notification/rules/preferences.ts` — the same array the
consumer reads and the DTO validates against. Hand-maintaining a second copy in SQL is how a
fourth event ends up configurable in the UI and rejected by the database, or sent for everyone
with no way to opt out.

## Append-only tables

`tracking.events`, `finance.ledger_entries`, `audit.events`, webhook delivery logs, and a
`VERIFIED` row in `delivery.delivery_proofs` are never updated or deleted. Not by application
code, not by a backfill, not by hand.

`delivery.delivery_proofs` is the one table that is append-only _from a point_: a `PENDING` row is
live challenge state and takes counter writes, and the trigger freezes it the moment it becomes
`VERIFIED`. See [../domains/delivery.md](../domains/delivery.md#proof-of-delivery).

Correct a mistake by writing a new row that references the original. That is what makes the
history defensible in a dispute over a COD collection six weeks ago.

```sql
REVOKE UPDATE, DELETE ON tracking.events FROM zipzap_app;
```

Enforce it in the database, not just in review.

One nuance learned live (migration `0019`): a status guard on a working table must allow
_counter-only_ updates. `shipment.bulk_jobs` moves forward through its lifecycle, but the chunk
processor also bumps `processed_rows` / `succeeded_rows` without moving status — the first
version of the trigger rejected those as `PROCESSING → PROCESSING` and killed a 10k import.
Same-status updates are counter writes, not lifecycle moves; the guard allows them and still
rejects every illegal status change.

## Idempotency

```sql
CREATE TABLE system.idempotency_keys (
  scope         text        NOT NULL,
  key           text        NOT NULL,
  merchant_id   uuid,
  request_hash  text        NOT NULL,   -- detects key reuse with a different body
  response_code int,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
```

Store the response, not just a "seen" flag — a retried request must return the _original_
response, not a bare 409. Hashing the request body catches a client reusing a key for a
different payload, which is a client bug worth surfacing.

Expiry is a retention decision, not a correctness one: keys must outlive any plausible client
retry window. See [../api/idempotency.md](../api/idempotency.md).

## Isolation

Default `READ COMMITTED`. Where a decision depends on more than one row, lock explicitly:

```sql
SELECT * FROM cod.records WHERE id = $1 FOR UPDATE;
```

Cod collection and settlement approval take row locks. Shipment transitions serialise on the
shipment row, so two riders scanning simultaneously cannot both advance the state machine.

Never escalate to `SERIALIZABLE` as a default. Name the conflict instead.

## Indexing

Index what is queried, not what is modelled.

Always: primary keys, foreign keys within a schema, every `status` + `created_at` pair that
backs a list endpoint, every geometry column (`GIST`), every partial index marking "active".

Never: index a low-cardinality boolean, or add an index to avoid writing a better query.

Every index has a write cost. An unused index is a permanent tax on every insert.

### GIN needs its operator classes, and `btree_gin` is not optional

`ILIKE '%term%'` has a leading wildcard, so no btree can serve it. `pg_trgm` supplies
`gin_trgm_ops`. But a composite GIN over `(merchant_id, tracking_code, …)` also needs an operator
class for `merchant_id`, and **a plain GIN index has no default operator class for `uuid`** — the
migration fails with `data type uuid has no default operator class for access method "gin"`.
`btree_gin` supplies `gin_uuid_ops`.

Both extensions must be created **inside the migration, before the index**. Installing them by hand
to get past the error locally is how this hides indefinitely: an already-migrated database has the
extension, so the statement passes there, and only a database that has never been migrated reproduces
the failure. `1759000000037-ShipmentZone` was verified by creating a scratch database and running
every migration from scratch.

## Retention

Retention is policy, not implementation — but the schema must support it.

| Data                                                               | Shorter retention | Reason                                      |
| ------------------------------------------------------------------ | ----------------- | ------------------------------------------- |
| Tracking events, notification logs, webhook logs, device telemetry | yes               | Operational, high volume, low dispute value |
| Ledger entries, settlements, audit events                          | **no** — long     | Financial and legal record                  |

Financial and audit data outlives the operational data around it. Deleting a tracking event to
save space must never put a ledger entry at risk. Partition by time, drop whole partitions, keep
the ledger.

Concretely defined periods live in [../operations/retention-privacy.md](../operations/retention-privacy.md).

## Privacy

Customer data — name, phone, address — is the most sensitive thing in the database.

- minimise what is stored; do not keep a copy "for later"
- restrict access per role
- never log it (see [overview.md](overview.md) rule 10)
- encrypt at rest where the platform provides it
- audit every read of customer contact data
- delete on request, and record that you did

Access is audited, not merely restricted. An unlogged read is indistinguishable from a breach.

## Privacy and correctness together

A privacy deletion request that would break a ledger balance is a real conflict, and it has a
real answer: pseudonymise the customer reference in the ledger, keep the money intact, and
retain the deletion evidence. Erasing a financial record to satisfy a privacy request destroys
the merchant's right to dispute it. Resolve it explicitly, in writing, per case — never by
accident.
