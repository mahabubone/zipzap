---
title: Receive events without polling
description: Register a webhook, verify the signature, and survive a retry.
order: 3
audience: merchant
---

## Register an endpoint

```bash
curl -X POST https://api.zipzap.com/v1/webhooks \
  -H "Authorization: ApiKey $KEY_ID.$SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://shop.example/zipzap",
    "events": ["shipment.delivered", "cod.collected", "settlement.completed"]
  }'
```

The event names are **dotted**, not the internal `ShipmentDelivered` CamelCase — a receiver
hard-codes these strings, so they are a public contract and additions to the list are additive
only.

The response carries a **signing secret**. It is returned here and at rotate, and nowhere else.
Store it with the care you would store a password: it is what lets you prove a payload came from
us.

## Verify the signature

Every request carries four headers:

| Header             | Meaning                                 |
| ------------------ | --------------------------------------- |
| `ZipZap-Signature` | `t=<unix-seconds>,v1=<hmac-sha256 hex>` |
| `ZipZap-Delivery`  | Delivery id — **deduplicate on it**     |
| `ZipZap-Event`     | The event type                          |
| `ZipZap-Attempt`   | 1-based attempt number                  |

The signature is `HMAC-SHA256` over `{timestamp}.{raw_body}` with the signing secret. Two things
matter more than the library you pick:

- **Compare in constant time.** `hmac === expected` leaks timing.
- **Sign the bytes exactly as they arrived.** Do not parse and re-serialise first — field order and
  number formatting are both part of the signed string, and any reformatting breaks it.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, { signature, deliverySecret }) {
  const [timestamp, provided] = signature.split(',');
  const t = timestamp.slice(2);
  const expected = createHmac('sha256', deliverySecret).update(`${t}.${rawBody}`).digest('hex');
  return timingSafeEqual(Buffer.from(provided.slice(3)), Buffer.from(expected));
}
```

## Retries and deduplication

Attempts run `1m → 5m → 15m → 1h → 6h → 24h`, then go terminal. Retried on timeout, connection
refused, `5xx`, and `429` (honouring `Retry-After`). **Not** retried on any other `4xx` — the
payload will not become valid by being sent again.

Because we retry, you must deduplicate. Use `ZipZap-Delivery`: it is unique per delivery attempt
family, and a replay of the same logical event carries a **fresh** one — so a receiver that
deduplicates on it would otherwise drop the replay we intended to deliver. Record the delivery id
against the shipment, not the event.

## Rotate and pause

- `POST /v1/webhooks/:id/rotate` — new signing secret, old one invalidated immediately
- `POST /v1/webhooks/:id/pause` and `/resume` — stop and start deliveries without losing history

The full delivery log, with the response we got and whether each attempt is terminal, is at
`GET /v1/webhooks/deliveries`, and a single delivery can be replayed from
`POST /v1/webhooks/deliveries/:deliveryId/replay`.
