# Authentication

Two principals, two mechanisms, never interchangeable.

|            | Human                                      | Machine               |
| ---------- | ------------------------------------------ | --------------------- |
| Credential | bearer session token (`merchant.sessions`) | API key + secret      |
| Endpoint   | `POST /v1/auth/login` (email + password)   | `POST /v1/api-keys`   |
| Used by    | every console, rider app                   | merchant integrations |
| Stored     | hashed password (scrypt), hashed token     | hashed secret         |
| Scoped to  | the merchant, all scopes                   | a merchant + scopes   |
| Expiry     | 12h absolute, revocable server-side        | until revoked         |

`argon2id` was the stated plan; scrypt is what the code actually ships everywhere already
(`common/secret.ts`). One KDF, versioned hash format, parameters raiseable later — that was
the 2026-10-07 call. `ponytail:` roles granularity comes when a non-merchant human principal
(support agent) has a table to hang them on.

A merchant API key must never open a browser session, and a support agent's session must never
work as an integration credential. Separate mechanisms, separate storage, separate revocation.

Human tokens carry no role granularity yet: a successful login returns a principal with every
scope in the current vocabulary, including `keys:manage`. That only holds while the first
console is the merchant's own; the first non-merchant human is the trigger to constrain it.

---

## API keys

```
Authorization: ApiKey <key_id>.<secret>
```

Split on the dot. `key_id` selects the row — it is an identifier and is safe to log. The secret
is verified against a hash and **never logged, never stored raw, never returned again**.

```
key_id:  ak_live_9f2c1e4a
secret:  shown once at creation, never retrievable
```

Store both a hash (to verify) and an encrypted copy (to display once, immediately after
creation, if the merchant did not save it). Rotate and revoke independently.

### Rotation

Two keys may be active at once. That is the point — rotation without overlap forces a merchant
to deploy and rotate in the same instant, and they will get it wrong.

```
1. merchant creates key B
2. B is active, A still works
3. merchant deploys with B
4. merchant confirms B is receiving traffic
5. merchant revokes A
```

`last_used_at` on every key, so step 4 is evidence-based rather than a guess.

### Revocation

Immediate, audited, terminal. There is no un-revoke, by design.

Every rotation and revocation is an audit event. See [../domains/merchant.md](../domains/merchant.md).

---

## Scopes

```
shipments:read    shipments:write    tracking:read
returns:write     settlements:read   webhooks:manage
```

Scope is checked per route. A credential with `shipments:write` cannot read settlements, and
cannot delete a webhook.

Scope without tenant scope is a data breach waiting for a missing `WHERE`. The merchant is
derived from the credential, never from the request body — a client-supplied `merchantId` is
ignored, not trusted.

---

## Sessions

Opaque server-side sessions in Postgres, referenced by an `HttpOnly`, `Secure`, `SameSite=Lax`
cookie. The session id is the only thing in the cookie; nothing is encoded in it that could be
tampered with.

Rotate on privilege change. A role change invalidates existing sessions — otherwise a demoted
admin keeps admin until logout.

Store a session fingerprint (user agent, IP range). A session from a different fingerprint is
suspicious and worth re-authenticating.

---

## Webhook authentication

Outbound deliveries are signed, not authenticated with the key:

```
ZipZap-Signature: t=1759387200,v1=<hmac-sha256>
ZipZap-Delivery:  <delivery_id>
```

HMAC-SHA256 over `{timestamp}.{raw_body}` with the endpoint's signing secret. Receivers verify:

1. the timestamp is within tolerance (reject replays)
2. the signature matches, comparing in constant time
3. `ZipZap-Delivery` is deduplicated — deliveries are retried, so the same `delivery_id` arrives
   more than once

The signature covers the **raw** body. Re-serialising the parsed JSON to verify will fail,
because key order and whitespace change. This is the most common webhook bug, and it is ours to
document clearly.

---

## Never logged

Passwords · API secrets · session tokens · webhook signing secrets · full payment credentials.

Not at debug level, not in error reports, not in traces. Redact at the serialiser, so the value
cannot leak through a new call site you forgot.

---

Related: [../domains/identity.md](../domains/identity.md) ·
[../domains/merchant.md](../domains/merchant.md) · [webhooks.md](webhooks.md)
