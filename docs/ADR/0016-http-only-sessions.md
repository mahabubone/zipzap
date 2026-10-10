# ADR-0016: Web sessions as HttpOnly cookies behind a same-origin proxy

**Status** accepted · 2026-10-10

## Context

The three consoles — merchant-web, control-tower, hub-console — authenticated by POSTing an email
and password, receiving a bearer token in the response body, and storing it in `sessionStorage`.
Every request then attached `Authorization: Bearer …` by hand.

That design has one consequence that outranks the rest: **`sessionStorage` is readable by any
script running on the page.** An XSS therefore does not get a session it must use carefully — it
gets a credential it can replay from anywhere, for the twelve hours the token is valid, and there is
nothing the server can do about it because it cannot tell the attacker's request from the user's.

It also had a structural consequence that blocked the fix. The app talked to `http://localhost:3000`
as a _different origin_, which required CORS. A cookie cannot cross origins without
`SameSite=None; Secure`, and `SameSite=None` is a third-party cookie — deprecated in Chrome, and
subject to no CSRF protection at all. So the token-in-JS design was load-bearing for cross-origin
deployment, not merely a shortcut.

`docs/api/auth.md` already specified the `HttpOnly; Secure; SameSite=Lax` session cookie, including
rotation on privilege change. None of it was implemented: the shipped reality was a 12-hour bearer
token with no refresh, no rotation, and nothing that stopped a revoked membership's sessions.

## Decision

**Web sessions are server-side sessions carried in an `HttpOnly; Secure; SameSite=Lax` cookie,
reached through a same-origin proxy. Bearer and `ApiKey` remain for native and machine clients.**

### Three credential sources, one principal

| Source                                | Who uses it                                | Where the token lives                    |
| ------------------------------------- | ------------------------------------------ | ---------------------------------------- |
| `Cookie: zipzap_session`              | browser consoles                           | `HttpOnly` cookie; script cannot read it |
| `Authorization: Bearer`               | native (Expo) and server-side integrations | wherever the client keeps secrets        |
| `Authorization: ApiKey <id>.<secret>` | machine principals                         | the integrator's own keystore            |

The chain is strict, not a preference order. An `Authorization` header naming neither recognised
scheme is **rejected**, not ignored. Falling through to the cookie would let a caller who can send a
bogus header be silently answered by whatever session their browser happens to be holding, which
turns a malformed header into a credential switch.

### Two login endpoints, because one cannot serve both callers

- `POST /v1/auth/login` sets the cookie and returns expiry and business membership. The token is
  **not** in the response body: script reads bodies, so returning it there would set a lock and hand
  out the key.
- `POST /v1/auth/token` returns the token in the body and sets no cookie, for a client with nowhere
  to put one. Same service call, same audit row, same scrypt cost.

### Same-origin by proxy, not by CORS

Each console's server forwards `/api/*` to the backend. One origin in the browser, so the cookie is
first-party, `SameSite=Lax` is sufficient, and the CSRF surface shrinks to a header check. CORS is
pinned to `WEB_ORIGIN` and never sets `credentials` — the session is same-origin, so there is no
cross-origin request to authorise.

### Lifetime

12-hour idle window that slides on activity, under a 168-hour absolute ceiling. Renewal writes only
when more than half the idle window has elapsed: a write per request would put a row update in the
hot path of all 84 operations to save a handful near expiry.

## Consequences

### Positive

- An XSS gets a room and no key. The token is unreachable from the page.
- The guard runs on the server, so an unauthenticated visitor gets a 307 and no console in the HTML.
  The old `useEffect` guard rendered, shipped and hydrated a full page first.
- No CORS credentials, no third-party cookie, no `SameSite=None` deprecation path.
- One principal regardless of transport, so scope decisions cannot diverge by how a caller
  authenticated.

### Negative

- Each console is now a tier, not a static bundle, and needs something forwarding `/api` in every
  environment.
- A cookie cannot be cleared by client code, so a logout that must clear it needs a server round
  trip. `logout` is therefore not purely local, and a 401 from a revoked session still returns 204
  (see below).
- The dev proxy must rewrite `Origin` and strip `sec-fetch-*`, because the backend's CSRF check
  compares origins and a proxied request is otherwise cross-site by construction.
- `logout` returning 204 for a revoked session is indistinguishable from a successful one. That is
  deliberate — it removes an oracle for testing whether a guessed token is valid — but it means a
  real failure to log out is silent.

## Alternatives considered

**Keep the bearer token, move it to `httpOnly` storage.** Not available: there is no `httpOnly`
JavaScript-accessible storage, by definition. The only `httpOnly` mechanism is a cookie.

**BFF with access + refresh tokens and reuse detection.** The strongest session design, and the one
a payments product would ship. Rejected as the next step rather than the first because it is
another table, another state machine, and another class of bug to test, for a system that currently
has no rotation at all. `revokeSessionsForUser` is the seam that would adopt it.

**`SameSite=Strict`.** Stronger CSRF posture than `Lax`. Rejected: it blocks the cookie on
top-level navigations from an email or an OAuth redirect, so a merchant following a link to the
console arrives signed out. This is a defect users report as "it never keeps me logged in".

**Cross-origin with `credentials: true` and an origin allowlist.** Rejected: it requires
`SameSite=None`, and both the CSRF surface and the third-party-cookie deprecation path are worse.

## What this does not solve

- **There is no membership-mutation endpoint.** No `change-role`, no `invite-member`, no way to
  remove someone from a business at all. `revokeSessionsForUser` therefore has no caller today; it
  is written and tested for the endpoint that does not yet exist. The session bug and the missing
  endpoint are both real, and the second is the larger one.
- **No session fingerprinting.** `docs/api/auth.md` records user agent and IP range on issue;
  nothing binds to them on use, so a stolen cookie that outlives its window works anywhere.
- **Password hashing is still scrypt.** `docs/domains/identity.md` promises argon2id; it is not
  upgraded.
