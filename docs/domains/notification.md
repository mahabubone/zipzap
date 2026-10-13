# notification

Asynchronous customer and operator messaging. Phase 4.

---

## Owns

`notification` schema: `templates`, `messages`, `deliveries`, `preferences`.

## Channels

SMS · email · push · WhatsApp-compatible integration · in-app · webhook

## Rules

1. **Never send inside a request or a NATS consumer.** Consume the event, enqueue a BullMQ job,
   send from the worker. A provider outage must not affect the operation that triggered it.
2. **Every send is idempotent on `(eventId, channel, recipient)`.** A customer receiving the same
   SMS twice is a real, visible failure — worse than a late one.
3. **Templates are versioned.** A message sent last month must be reproducible for a dispute.
   Store the template version on the delivery row, not just the text.
4. **The merchant may silence any parcel event, and absence means send.** Transactional
   messages about a parcel in motion are not marketing; the distinction is real and must be
   explicit in the template type. See [Merchant opt-out](#merchant-opt-out).
5. **Delivery status is recorded per channel attempt**, success and failure alike.

## Pipeline

```
Domain event → NATS → notification consumer → BullMQ → provider
```

Failure ladder: retry, retry, retry, then a dead-letter / failed state that is **visible**.

A notification that silently failed is worse than one that visibly did — the recipient never
learns their parcel is coming, and nobody notices the system is broken.

## Timeline

```
Shipment created → Pickup scheduled → Picked up → Arrived at hub
                → Out for delivery → Rider approaching → Delivered
```

Plus `DeliveryFailed`, `ReturnInitiated`, `SettlementCompleted`.

Language: English and Bangla. Content lives in templates, never in code.

## Rate and cost

SMS is metered per message. Per-recipient throttling and quiet hours matter more than they first
appear — a misconfigured trigger can cost real money at national volume in minutes.

Cap sends per event type. A retry loop that re-enqueues a notification without a dedupe key is a
billing incident.

## Delivery failure is usually the carrier's to retry

MiMSMS publishes a DLR table where every failure carries the **operator's** retry count. The
common failures — `Absent subscriber for SM`, `Subscriber Busy`, `System failure` — all carry
**retry policy 3**, meaning the carrier will retry the handset itself.

`Absent subscriber for SM` means the phone was switched off or out of coverage. It is the single
most common real failure, and it is **not** a permanent failure.

**So a first-attempt delivery failure must not dead-letter.** Retry policy `0` —
`Barred subscriber`, `Undelivered`, `Illegal subscriber` — is the only genuine
permanent-failure signal. Dead-lettering everything that is not `Delivered` discards messages
the carrier was about to retry, which for a parcel notification means a customer is never told
their parcel arrived.

Our own ladder still applies on top: it exists for the case where the carrier has exhausted its
retries and _we_ try later, not as a replacement for them.

## Transactional, not promotional

Every parcel notification is sent as MiMSMS `transactionType: "T"`:

- `"T"` allows **exactly one** recipient and ignores DND
- `"P"` allows up to 1000 and is DND-restricted

Never batch parcel notifications into one promotional call. Per-recipient personalisation goes
through the provider's dynamic-SMS endpoint, which is a different path with different semantics.
See [../architecture/provider-adapters.md](../architecture/provider-adapters.md).

## Merchant opt-out

`GET`/`PUT /v1/notification-preferences`, scope `notifications:manage`. The merchant comes from
the principal, never from the body.

Three events can notify a customer today: `ShipmentCreated`, `DeliveryOutForDelivery`,
`DeliveryCompleted`. The list is `Object.keys(TEMPLATE_OF)` in
[`rules/preferences.ts`](../../apps/backend/src/modules/notification/rules/preferences.ts) — one
map from event to template, read by the consumer, the DTO and the migration's `CHECK`.

Two rules that are easy to get backwards:

**A merchant is opted out by writing a row.** No row means send. The alternative — a row per
merchant per event, defaulted off — is the more "complete" design and it fails silently and
completely: every merchant stops being told where their parcels are, and no counter moves,
because counters measure sends and there are simply none. `PUT enabled=true` therefore deletes
the row rather than storing "on".

**An unknown event type is sent, not refused.** `isEnabled` returns `true` for anything outside
the vocabulary. Reaching that branch means the consumer learned about an event this file did
not, and the two honest answers are "send" or "silently drop real notifications". Sending is
recoverable; dropping is invisible.

The gate runs in the consumer, **after** the dedupe check and **before** any write, so an opted-out
event leaves no message row and costs nothing to send.

`notifications:manage` is deliberately _not_ `shipments:write`. An operator who can create
shipments should not be able to silence every delivery notification for the merchant they work
for — see [identity.md](identity.md).

`scripts/verify-notification-preferences.mjs` asserts the whole path against a running stack,
including the assertion that matters: a muted event produces **no** message row, and unmuting it
produces one addressed to the customer.

## Must not touch

Every other schema. It holds identifiers and its own delivery records. The notification is a
consequence of an event, never a participant in the transaction that produced it.

## Emits

`NotificationQueued`, `NotificationSent`, `NotificationFailed`, `NotificationDeadLettered`.

---

Related: [support](support.md) · [../architecture/eventing.md](../architecture/eventing.md) ·
[merchant](merchant.md)
