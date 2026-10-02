# identity

Who is acting, and are they allowed to. Phase 1.

---

## Owns

`identity` schema: `users`, `identities`, `sessions`, `credentials`, `devices`, `roles`,
`permissions`, `role_permissions`.

## Two kinds of principal

| Principal   | Authenticates with  | Used by                          |
| ----------- | ------------------- | -------------------------------- |
| **Human**   | session cookie, JWT | every web console, the rider app |
| **Machine** | API key + secret    | merchant integrations, webhooks  |

They are separate for a reason: a merchant's API key must never be able to open a browser session,
and a support agent's session must never be usable as an integration credential.

## Rules

1. **Permissions, not role names, are the enforcement unit.** `shipment:create`,
   `settlement:approve`, `hub:manage`. A role is a bundle of permissions. Code checks
   permissions; it never checks a role name.
2. **Passwords are hashed with argon2id.** Never MD5, SHA-1, or unsalted SHA-256.
3. **API secrets are hashed.** Compared, never stored raw. See [merchant](merchant.md).
4. **Every permission check happens at the application boundary**, in a guard — not in a
   controller, and never only in the UI.
5. **Sessions rotate on privilege change.** A role change invalidates existing sessions.
6. **Tenant scoping is derived, never accepted.** The merchant is a property of the credential.
7. **Authentication is audited.** Login, failed login, logout, credential rotation, credential
   revocation.

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
