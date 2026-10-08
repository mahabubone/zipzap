# identity

Who is acting, and are they allowed to. Phase 1.

---

## Owns

**Roles**, as code: `apps/backend/src/modules/identity/rules/roles.ts` maps each of seven role names
to a bundle of scopes. A guard checks scopes and never a role name, so the bundles are the only
place a role name means anything.

`sessions` are `merchant`'s table, not identity's — see [merchant](merchant.md). identity registers
no TypeORM connection and owns no tables; it calls merchant's service to authenticate and to
resolve a session. The `identity` schema (`users`, `identities`, `devices`, `permissions`,
`role_permissions`) is **not built**; see the deferred table in [the plan](../../product/competition/plan.md).

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

**The role is stored on the session, not on a user.** A privilege change therefore _revokes_
sessions rather than widening them, so a live token can never carry permissions its bearer did not
have at login. The cost is that a role change forces a re-login — the correct failure mode for an
authorization change. Add `identity.users` when one merchant has more than one human and that
re-login stops being acceptable.

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
5. **Sessions rotate on privilege change.** A role change invalidates existing sessions.
6. **Tenant scoping is derived, never accepted.** The merchant is a property of the credential.
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

---

Related: [merchant](merchant.md) · [support](support.md) · [../api/auth.md](../api/auth.md)
