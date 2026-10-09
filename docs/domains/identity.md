# identity

Who is acting, and are they allowed to. Phase 1.

---

## Owns

**Roles**, as code: `apps/backend/src/modules/identity/rules/roles.ts` maps each of seven role names
to a bundle of scopes. A guard checks scopes and never a role name, so the bundles are the only
place a role name means anything.

**`users` and `user_merchants`** — a person, and their role inside one merchant each. Both added in
migration 0036. identity registers a TypeORM connection because of them; before that it owned no
tables and read a person's credential out of `merchant.merchants`, which is precisely why one login
could not hold two businesses.

`sessions` remain `merchant`'s table — see [merchant](merchant.md). A session authenticates a
person, so it carries `user_id`, but its lifecycle is merchant's business. The seam runs both ways
and that is the point: identity exposes `UserService`, merchant calls it to resolve the credential,
and identity calls `FindCredentialService` to verify an API key. Neither reads the other's tables.

## Two kinds of principal

| Principal   | Authenticates with   | Used by                          |
| ----------- | -------------------- | -------------------------------- |
| **Human**   | bearer session token | every web console, the rider app |
| **Machine** | API key + secret     | merchant integrations, webhooks  |

They are separate for a reason: a merchant's API key must never be able to open a browser session,
and a support agent's session must never be usable as an integration credential.

## Roles

Seven bundles, all defined in `rules/roles.ts`:

| Role                 | Holds                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `PLATFORM_ADMIN`     | every scope; the only role permitted outside a merchant tenancy                          |
| `OPERATIONS_MANAGER` | reads across merchants; moves parcels; sees that a COD exists, cannot settle it          |
| `HUB_OPERATOR`       | scans and manifests; **no money scope at all**                                           |
| `SUPPORT_AGENT`      | read-only; deliberately **no `cod:read`** — a read is the easiest permission to escalate |
| `MERCHANT_OWNER`     | every scope within one merchant                                                          |
| `MERCHANT_OPERATOR`  | the owner's scopes **minus `settlements:approve` and `keys:manage`**                     |
| `RIDER`              | own job feed; cannot read merchant shipments or COD                                      |

The two scopes withheld from `MERCHANT_OPERATOR` are the two that are irreversible if abused:
`settlements:approve` moves money off the platform, and `keys:manage` mints a credential that acts
with full merchant scope. An operator who can do either can empty the account.

**The role lives on the membership, not on the user and not on the session.** It moved off
`sessions.role` in migration 0036 for two reasons: a role per user cannot express "operator at one
store, owner at another", which is the ordinary case for anyone running two shops; and a second copy
of the role on a session could disagree with the membership and nothing would notice.

A membership is therefore the unit of permission, and **permissions are resolved per request** —
`AuthenticateApiKeyService` re-reads the memberships on every call rather than trusting a copy on the
token. That is stricter than the old "revoke on privilege change" behaviour and it is deliberate: a
membership revoked mid-session stops working on the very next request, with no re-login, so a
legitimately-revoked employee cannot keep using a live token.

## Multi-business

A login is a **person**; a **membership** is that person's role in one merchant. One person may hold
several, and `ApiPrincipal` carries both:

| Field         | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `merchantId`  | the ACTIVE business — the one this request acts inside                 |
| `merchantIds` | every business this principal may act inside, one entry per membership |
| `scopes`      | the ACTIVE membership's role bundle — never a union across businesses  |

`assertTenant` checks **membership**, not equality: a principal holding `[m-1, m-2]` may act in
either and a third gets the same 404 as one that does not exist. A business outside the set is
never a 403, because a 403 confirms it exists.

The active business is chosen at login (`POST /v1/auth/login` takes an optional `merchantId`) and
resolved **deterministically** — the first membership by `merchantId`, so two people with identical
memberships never get different defaults. A `merchantId` the user does not hold **fails the login**
rather than falling back to the default: falling back would serve the wrong store's data with a
200, which is a cross-tenant read wearing a success code.

An API key principal has exactly one entry in `merchantIds`. A key is issued to one merchant, and a
machine carrying a membership set would be a credential that could reach a second tenant.

`ponytail:` there is no role-assignment UI, no invitation flow and no password reset. Every
membership in the database was written by the seed or by migration 0036's backfill. Add the write
path when a human other than the seed has to create one — an admin surface is the trigger, not a
date. There is also no "switch business" endpoint yet: a second login with `merchantId` reaches the
other business today, which is enough to prove the model and not enough to be a good console.

## Rules

1. **Permissions, not role names, are the enforcement unit.** `shipment:create`,
   `settlement:approve`, `hub:manage`. A role is a bundle of permissions. Code checks
   permissions; it never checks a role name.
2. **Passwords are hashed with scrypt** at N=2^15, r=8, p=1, from `node:crypto`. Never MD5, SHA-1,
   or unsalted SHA-256. The stored form is versioned (`scrypt$N$r$p$salt$hash`) so parameters can be
   raised later without invalidating existing credentials.

   This doc originally specified argon2id; the code uses scrypt and this line is the correction, not
   a deviation. scrypt is memory-hard, ships in the standard library, and costs no native
   dependency. Argon2's edge is GPU resistance, and a login endpoint is not a stolen-credential-
   database target — it is an online guessing surface, where the ~70 ms KDF cost **is** the defence.
   That cost is spent deliberately: every attempt pays it, so credential stuffing pays 70 ms per
   guess. Move to argon2id if this ever authenticates against a breached credential store.

3. **API secrets are hashed.** Compared, never stored raw. See [merchant](merchant.md).
4. **Every permission check happens at the application boundary**, in a guard — not in a
   controller, and never only in the UI.
5. **A privilege change takes effect on the next request.** Permissions are resolved from the
   membership per request, so revoking a membership or changing a role needs no session rotation.
6. **Tenant scoping is derived, never accepted.** The merchant is a property of the credential —
   and for a human, a property of their memberships. A client-supplied `merchantId` is a _request_
   for a scope, checked against the membership set, never an assertion of one.
7. **Authentication is audited.** Login, failed login, logout, credential rotation, credential
   revocation — written to `system.audit_events`, see [Audit trail](#audit-trail).

## Audit trail

`system.audit_events`, append-only, enforced **by trigger** — `UPDATE` and `DELETE` are rejected by
the database, not by convention.

The table lives in `system`, not `identity`, and that is the load-bearing decision. An audit row is
written by identity (a login), merchant (a key minted), shipment (a hold released) and support (a
customer record read). Putting it in `identity` would make every other module call identity to
report what it did — coupling dressed as security. `system` is already home to the cross-cutting
mechanism (`outbox_events`, `idempotency_keys`, `consumed_events`); an audit trail is the same kind
of thing.

| Column                    | Meaning                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `actor_type` / `actor_id` | `human`/`machine`/`system` and the subject. Never a role name — roles change, the actor does not |
| `merchant_id`             | Tenant scope, so a merchant-scoped read is a `WHERE` and not a `JOIN`. Null on a failed login    |
| `action`                  | Past-tense dotted verb: `auth.login.failed`, `credential.minted`                                 |
| `request_id`              | Joins to the log line and error envelope — see [observability](../operations/observability.md)   |
| `metadata`                | Ids, counts, states. **Checked, not trusted.**                                                   |

### Secrets cannot reach it

`metadata` is walked against a denylist (`password`, `secret`, `token`, `api_key`, `authorization`,
`cookie`, `signing_secret`, `hash`, …) at any depth, and a match **throws rather than redacting**. A
caller trying to record a password has a bug, and a redacted row hides it; a 500 tells them at once.
It cannot lose data, because the caller's own write is what failed.

Matching is on **key names, not values**. A caller can still smuggle a secret into
`{note: "sk_live_…"}`. The contract is that callers pass identifiers and counts, never prose — and
that is stated at the writer rather than discovered later.

### Audited events

| Action                 | When                                     | Atomic with the write?                     |
| ---------------------- | ---------------------------------------- | ------------------------------------------ |
| `auth.login.succeeded` | session issued                           | no — there is no business write            |
| `auth.login.failed`    | bad password, unknown email, or none set | no, and deliberately so                    |
| `auth.session.revoked` | logout                                   | after the `UPDATE` commits                 |
| `credential.minted`    | `POST /v1/api-keys`                      | **yes** — same transaction as the insert   |
| `customer.record_read` | `GET /v1/shipments/:id`                  | no — a read has no write to be atomic with |

A read audit exists for exactly **one** endpoint, because that endpoint is the only read that
returns PII. `GET /v1/shipments` returns ids, status and money; the public tracker reads a
projection selecting `sequence, event_type, occurred_at` and cannot carry a phone number even by
accident. Auditing those would be volume for no investigative value — the public tracker is the
highest-traffic read in the system.

The row records the four field **names** (`senderName`, `senderPhone`, `recipientName`,
`recipientPhone`), never their values. Copying the contact details into a second table that outlives
the shipment's own retention policy would defeat the point of restricting them.

`customer.record_read` names the shipment, which resolves to the recipient, so the trail answers
"who looked up this customer's phone number, and when" without storing the number again.

A failed login records `reason` and **no** `merchant_id`: the email is unauthenticated input, so
writing it against a merchant would let anyone append rows to a competitor's trail. Three distinct
reasons (`unknown_email`, `no_password_set`, `bad_password`) make "is this an enumeration attempt"
answerable from the trail alone.

The failure row is written **after** the KDF runs, so its cost is noise against the ~70 ms scrypt —
an unauthenticated attacker cannot make the audit write the expensive part.

`ponytail:` the audit trail is **write-only** today. There is no query endpoint, because the only
reader would be a support or admin surface that does not exist yet — building the read path before
its reader is how an unaudited admin API gets shipped.

## Permissions

```
shipment:create   shipment:read   shipment:update   shipment:cancel
pickup:create     pickup:assign
delivery:assign   delivery:complete
settlement:read   settlement:approve
merchant:manage   hub:manage      rider:manage
customer:read     audit:read      support:manage
```

Roles bundle these: `PLATFORM_ADMIN`, `OPERATIONS_MANAGER`, `HUB_OPERATOR`, `SUPPORT_AGENT`,
`MERCHANT_OWNER`, `MERCHANT_OPERATOR`, `RIDER`.

## Scope rules

Two kinds, and the difference is the security-relevant part.

**Role-based** — can this user view this page at all?

**Tenant-scoped** — can this user view _this merchant's_ data? Enforced by deriving `merchantId`
from the principal on every query. A permission without a scope is how one merchant reads
another's COD records.

Both are required. `settlement:read` without tenant scope is a data breach waiting for a missing
`WHERE`.

## Support agent access

Support reads across domains by nature. That access is explicit and audited rather than
convenient — a logged, permissioned read of customer contact data, visible in the audit log.

## Devices

A rider device is a first-class entity, not a session. It carries the `device_id` that offline
commands are keyed on, and it can be revoked to cut off a stolen phone. See
[../api/idempotency.md](../api/idempotency.md).

## Emits

`UserAuthenticated`, `SessionRevoked`, `CredentialRotated`, `CredentialRevoked`,
`PermissionChanged`.

## Must not touch

Every other schema. Identity is referenced by `userId` everywhere and owns nothing outside
`identity`.

`identity.user_merchants.merchant_id` is a bare uuid with a CHECK on `role`, **not** a foreign key:
merchant is another module's table, and a cross-schema FK is the coupling
[ADR-0002](../../ADR/0002-postgresql-schema-boundaries.md) exists to prevent. `sessions.user_id` is
the same deal in the other direction.

---

Related: [merchant](merchant.md) · [support](support.md) · [../api/auth.md](../api/auth.md)
