# Webhooks

Outbound events to merchant endpoints, signed and retried.

---

## Subscribed events

```
shipment.created            shipment.picked_up
shipment.in_transit         shipment.out_for_delivery
shipment.delivered          shipment.delivery_failed
shipment.return_initiated   shipment.returned
cod.collected
settlement.created          settlement.completed
```

Dotted, lowercase, past tense — the wire format for webhooks, whatever the internal event name.

Note the difference from internal events: `ShipmentDelivered` internally becomes
`shipment.delivered` externally. Webhook payloads are a public contract with their own naming and
their own stability guarantees.

## Pipeline

```
Event → Outbox → Publisher → NATS → Webhook consumer → BullMQ job → Merchant endpoint
```

The webhook is a BullMQ job, never a synchronous call inside a request or a NATS consumer. A
merchant endpoint that hangs for 30 seconds must not hold up a NATS consumer.

## Signature

```
ZipZap-Signature: t=1759387200,v1=<hmac-sha256 hex>
ZipZap-Delivery:  <delivery_id>
ZipZap-Event:     shipment.delivered
ZipZap-Attempt:   3
```

HMAC-SHA256 over `{timestamp}.{raw_body}` with the endpoint's signing secret, comparing in
constant time.

**Sign the raw body, not re-serialised JSON.** Key order and whitespace change when a payload is
parsed and re-stringified, and the signature will not match. This is the most common webhook
integration bug, and the docs must say so explicitly — receivers cannot debug a signature that
was never going to match.

## Receiver obligations

1. Verify the timestamp is within tolerance (5 minutes). Reject replays.
2. Verify the signature in constant time.
3. **Deduplicate on `ZipZap-Delivery`.** Retries mean the same id arrives more than once.
4. Respond `2xx` quickly. Do the work asynchronously.
5. Return a non-2xx to trigger a retry. There is no other signal.

Point 4 matters: a receiver that takes 10 seconds to respond will exhaust our timeout and be
retried, receiving the same event again while still processing the first. Fast acknowledgement
is not an optimisation, it is what makes delivery reliable.

## Retries

```
1m → 5m → 15m → 1h → 6h → 24h
```

Then a terminal failed state, visible to the merchant, replayable on demand. The maximum is
configurable per endpoint.

| Failure            | Retry?                                     |
| ------------------ | ------------------------------------------ |
| Timeout            | yes                                        |
| Connection refused | yes                                        |
| 5xx                | yes                                        |
| 429                | yes, honouring `Retry-After`               |
| 4xx (other)        | **no** — the payload will not become valid |

Retrying a 400 forever is how a webhook queue becomes a denial-of-service tool against your own
infrastructure. 4xx is a permanent failure and should surface to the merchant immediately.

## Delivery log

Every attempt is an immutable row: delivery id, endpoint, event type, attempt number, status
code, response body (truncated), duration, error, timestamp.

Never updated, never deleted. This is the merchant's evidence when a payload is disputed, and
yours when a webhook is claimed to have been delivered.

Delivery logs are how you answer "you said you never got the event" — and they are why webhook
secret rotation has a grace period rather than a hard cutover.

## Endpoint management

Per endpoint: URL · subscribed events · signing secret · status (active / paused / failing) ·
last success · last failure · consecutive failures.

**Pausing matters more than deleting.** A merchant with a broken integration pauses the endpoint,
fixes it, and replays — rather than missing every event during the outage and having to reconcile
them by hand.

Deleting an endpoint discards its delivery log. Soft-delete, or the dispute evidence is gone.

## Onboarding

1. Create the endpoint, get the signing secret **once**
2. Verify a test event
3. Enable live events

Self-service, with the docs inline. A merchant who cannot verify a signature in five minutes will
open a support ticket instead of integrating.

---

Related: [auth.md](auth.md) · [errors.md](errors.md) ·
[../domains/merchant.md](../domains/merchant.md) ·
[../architecture/eventing.md](../architecture/eventing.md)
