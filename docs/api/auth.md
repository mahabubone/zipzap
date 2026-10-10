# Authentication

Three credential forms resolving to two kinds of principal, never interchangeable.

|            | Human                                     | Machine               |
| ---------- | ----------------------------------------- | --------------------- |
| Credential | session token (`merchant.sessions`)       | API key + secret      |
| Endpoint   | `POST /v1/auth/login` or `/v1/auth/token` | `POST /v1/api-keys`   |
| Used by    | every console, rider app                  | merchant integrations |
| Stored     | hashed password (scrypt), hashed token    | hashed secret         |
| Scoped to  | the merchant + the role's scopes          | a merchant + scopes   |
| Expiry     | 12h idle, 168h absolute, revocable        | until revoked         |

`argon2id` was the stated plan; scrypt is what the code actually ships everywhere already
(`common/secret.ts`). One KDF, versioned hash format, parameters raiseable later — that was
the 2026-10-07 call.

A merchant API key must never open a browser session, and a support agent's session must never
work as an integration credential. Separate mechanisms, separate storage, separate revocation.

Human scopes are the role's bundle, not the vocabulary. A successful login returns
`scopesForRole(role)` for the role the person holds in the ACTIVE business — so a merchant admin
does not silently carry `keys:manage` or `settlements:approve` it was never granted.

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

Implemented 2026-10-10 — see [../ADR/0016-http-only-sessions.md](../ADR/0016-http-only-sessions.md).
Before that the consoles held a bearer token in `sessionStorage`, which any script on the page could
read, so an XSS got a replayable credential rather than a session.

### Two login endpoints, because one cannot serve both callers

| Endpoint              | Returns                                    | Sets a cookie | For                                        |
| --------------------- | ------------------------------------------ | ------------- | ------------------------------------------ |
| `POST /v1/auth/login` | expiry + business membership, **no token** | yes           | browser consoles                           |
| `POST /v1/auth/token` | the token in the body                      | no            | native (Expo) and server-side integrations |

`/auth/login` deliberately omits the token from its response body: script reads bodies, so
returning it there would set a lock and hand out the key. Both endpoints cost the same, audit the
same, and are rate-limited the same.

### Lifetime

A 12-hour idle window that slides on activity, under a 168-hour absolute ceiling. Renewal writes
only when more than half the idle window has gone, so it is not a write on every request.

### Credential forms

Three sources resolve to the same principal — `Cookie: zipzap_session`, `Authorization: Bearer`, and
`Authorization: ApiKey`. The chain is strict: an `Authorization` header naming neither recognised
scheme is rejected rather than falling through to the cookie.

### Same origin, not cross-origin

The consoles proxy `/api` to this server, so the browser sees one origin and the cookie is
first-party. `SameSite=Lax` is sufficient for that. It is also why `WEB_ORIGIN` is pinned rather
than reflected — an unset `WEB_ORIGIN` used to mean "allow any origin", which is an allowlist
maintained by the caller.

### What is still owed

- **Rotate on privilege change.** `revokeSessionsForUser` exists and is tested, but has no caller:
  this API has no membership-mutation endpoint, so there is currently no way to remove someone from
  a business at all. That gap is larger than the session one.
- **Session fingerprinting.** Nothing is stored today.
- **argon2id.** Still scrypt.

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
