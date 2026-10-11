---
title: Create your account and get your first credential
description: Sign up, find your business, and mint an API key with the scopes your integration actually needs.
order: 1
audience: merchant
---

## Sign up

The console is at **app.zipzap.com**. Sign in with an email and password; the first person to sign
up for a business becomes its `MERCHANT_OWNER`.

A business is not a user. One person may hold memberships in several businesses — a logistics
aggregator running three shops would have one login and three memberships — and the role is on the
membership, not on the user. So being an owner of one business says nothing about your role in
another.

## Get your credential

Two credential forms resolve to the same principal, and they are **not interchangeable**.

|           | Browser session                         | API key                        |
| --------- | --------------------------------------- | ------------------------------ |
| Endpoint  | `POST /v1/auth/login`                   | `POST /v1/api-keys`            |
| Used by   | the console, anything you drive by hand | a server integration           |
| Stored    | an `HttpOnly` cookie the browser holds  | you, wherever you keep secrets |
| Scoped to | your role's scope bundle                | the exact scopes you pick      |

For an integration, create an API key from the console (**Settings → API keys**) or:

```bash
curl -X POST https://api.zipzap.com/v1/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "production", "scopes": ["shipments:write", "shipments:read"]}'
```

The secret is returned **once, at creation**, alongside the key id. It is stored hashed, so it
cannot be recovered — losing it means creating a new key. Format the pair as the API expects:

```
Authorization: ApiKey <key-id>.<secret>
```

## Choose scopes, not all of them

`shipments:write` and `shipments:read` cover most of a shop's early life. Three scopes are
**owner-only** and worth knowing about before you ask for them:

- `settlements:approve` — moves money out of your account
- `keys:manage` — mints a credential that acts with full merchant scope
- `members:manage` — enrols people into your business

A holder of any of the three can grant themselves the other two, which is why they stop at the
owner. If your integration does not approve settlements, it should not carry the scope.

## Next

Now that you have a credential, price a shipment and create it — see
[Normalize a shipment with a rate card](/api-reference), then come back for
[Idempotency keys](/merchant-onboarding/02-idempotency) before you go live.
