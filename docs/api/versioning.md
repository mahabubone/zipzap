# Versioning and compatibility

`/v1` in the path. Simple, visible, and impossible to misinterpret.

## Rule

```
GET /v1/shipments/:id
```

A breaking change gets `/v2` alongside `/v1`. Not a header, not a query parameter, not a
content negotiation dance. A version in the path is readable in a log, in a browser, and in a
support conversation.

## What is breaking

Breaking: removing or renaming a field · changing a field's type · adding a required request
field · removing or narrowing an enum value · changing a status code · changing a `code` in an
error · changing authentication requirements · changing pagination shape.

Non-breaking: adding a new optional response field · adding a new endpoint · adding a new enum
value _to a response_ · adding a new webhook event · loosening validation.

Adding an enum value to a response is non-breaking **only** if clients were told not to
exhaustively switch. Document that expectation, or it is a trap you have set.

## Adding a required request field

Adding a required field to a request is breaking regardless of what the clients send today —
their next deploy breaks in production.

```
POST /v1/shipments
{ "merchantId": "…", "recipient": { … } }
```

Adding `serviceLevel` breaks every existing integration. Instead: make it optional with a
documented default, deprecate the absence, and require it in `/v2`.

## Timeline

```
1. Ship the change on /v1
2. Announce the deprecation date — and give a real one
3. Instrument usage; know exactly who is still on the old shape
4. On the date, remove it
```

Step 3 is what most projects skip, and it is the only way step 4 is safe. A deprecation with no
usage data is a guess.

## What is generated

`packages/api-client` is generated from the backend's OpenAPI output, which is generated from
controller decorators. Both are outputs.

Hand-editing either is a bug, for a specific reason: the next regeneration silently discards the
edit, and the change exists in the client but not the server. That failure surfaces as a 404 in
production and a confusing diff in review.

Regenerate and commit both together, in the same commit as the controller change.

## Contract tests

A change to request shape, response shape, status codes, authentication, metadata, pagination, or
errors requires:

1. a regenerated OpenAPI spec
2. a regenerated api-client
3. a contract test asserting the new behaviour

The spec is a promise. Without a test it is a comment.

## Webhook versioning

Webhook payloads carry `version` in the envelope and `event_type` naming the event. Receivers
must ignore unknown fields and unknown event types.

Webhooks cannot be versioned in the path, so the rule is: **additive only**. Removing or
reinterpreting a webhook field is a breaking change that cannot be announced through the URL —
which is why the delivery log is retained, so a receiver can see exactly what was sent when
disputing a payload.

---

Related: [_index.md](_index.md) · [errors.md](errors.md) · [webhooks.md](webhooks.md)
