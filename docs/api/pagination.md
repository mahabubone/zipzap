# Pagination

Cursor pagination for everything that can grow without bound.

## Why not offset

`OFFSET 50000 LIMIT 50` makes the database count and discard 50,000 rows, gets slower the deeper
you go, and — because rows are inserted while a merchant is paging — can skip or repeat rows
between requests.

On a shipment list that a merchant pages through while shipments are being created all day, that
is a visible correctness problem, not just a slow query.

## Request

```
GET /v1/shipments?limit=50&cursor=eyJpZCI6IjNiZi4uLiJ9
```

`limit` defaults to 50, max 200.

## Response

```json
{
  "data": [/* … */],
  "pagination": {
    "next_cursor": "eyJpZCI6IjNiZi4uLiJ9",
    "has_more": true
  }
}
```

`next_cursor` is `null` and `has_more` is `false` on the last page. **An empty `data` with
`has_more: true` is a valid page** — do not treat it as the end.

## Cursors

Opaque, base64url, and versioned.

```ts
interface ShipmentCursor {
  v: 1;
  id: string;
  createdAt: string; // the tiebreaker — ids are not unique in sort order
}
```

Opaque means the client cannot parse it, which means we can change its contents without breaking
anyone. Versioned means we can.

Signed or encrypted? Neither — deliberately. A forged cursor buys nothing: every list
query is scoped to the caller's `merchant_id`, so a hand-crafted cursor only repositions
within your own list. The merchant scope is the security boundary, not the cursor — signing
would add a secret for no threat. What the cursor must do is fail cleanly: a malformed or
non-UUID cursor produces a 400 with a named reason, never a SQL error. (Proven live 2026-10-05
on `GET /v1/shipments`: forged non-UUID → 400, foreign UUID → empty page.)

## Ordering must be total

```
ORDER BY created_at DESC, id DESC
```

`created_at` alone is not unique — two shipments created in the same millisecond have an
arbitrary relative order, and the cursor then repeats or skips one.

Adding `id` as a tiebreaker makes the order total, so "after this cursor" is well defined. This
is the detail that separates a correct cursor from one that very nearly is.

## Consistency under writes

Cursor pagination gives you a **stable view of a changing set**, not a snapshot. A shipment
created after you started paging will not appear; one that changes state may appear with its new
state. This is the right trade — snapshots are expensive and usually unnecessary.

Offer `sort` and explicit `created_after` filters for a merchant who needs a bounded window.

## Not paginated

Small, bounded, owned sets: an API's own webhooks, a settlement's items (bounded by the
settlement), a hub's staff. Paginating these adds a wrapper for no benefit.

The rule is about unbounded growth, not uniformity.

## Summary responses

Endpoints that return aggregates return one object plus small nested arrays — never a paginated
envelope. A shipment is one thing with a bounded set of parcels; wrapping it in `data` with
`pagination` is noise.

Paginate **collections**, not objects.

---

Related: [errors.md](errors.md) · [versioning.md](versioning.md) ·
[../domains/analytics.md](../domains/analytics.md)
