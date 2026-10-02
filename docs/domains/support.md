# support

Operational problem solving. Phase 4.

---

## Owns

`support` schema: `tickets`, `messages`, `assignments`, `status_history`, `attachments`.

## Ticket state

```
OPEN → IN_PROGRESS → WAITING_CUSTOMER ⇄ IN_PROGRESS
     → WAITING_MERCHANT → ESCALATED → RESOLVED → CLOSED
```

## Categories

`DELIVERY` · `PAYMENT` · `COD` · `RETURN` · `ACCOUNT` · `API` · `RIDER` · `DAMAGED` · `LOST` ·
`OTHER`

## Entities

`Ticket` · `TicketMessage` · `TicketAssignment` · `TicketStatusHistory` · `TicketAttachment`

## Rules

1. **A ticket references the thing it is about** — a `shipmentId`, a `merchantId`, a
   `riderId`. A ticket about "a parcel" with no identifier is unactionable.
2. **Status history is append-only.** When did it escalate, who escalated it, and why — that is
   the whole value of a support system.
3. **Support reads across modules; it owns nothing in them.** This is the case the module
   boundary was designed for: an agent needs the shipment, the rider, and the COD record
   together, and gets them through explicit, permissioned, **audited** per-module queries —
   never by joining their tables.
4. **Attachments are sensitive.** Screenshots contain addresses and phone numbers. Store in
   object storage, control access, apply retention.
5. **Escalation is a state, not a comment.** It changes who is responsible and what the SLA is.

## Cross-domain reads

| Agent needs                | Obtained from                                                     |
| -------------------------- | ----------------------------------------------------------------- |
| Shipment state and history | [tracking](tracking.md) public timeline + [shipment](shipment.md) |
| Rider movements            | [rider](rider.md)                                                 |
| Hub handling               | [hub](hub.md)                                                     |
| COD outcome                | [cod](cod.md)                                                     |
| Ledger position            | [finance](finance.md)                                             |
| Customer contact history   | [customer](customer.md)                                           |

Six modules, six explicit contracts. The alternative — one query joining six schemas — is
precisely the coupling that makes extraction impossible and audits impossible.

## Escalation to a ticket that matters

`LOST`, `DAMAGED`, and `COD_RECONCILIATION_EXCEPTION` should be able to open a ticket
automatically. An exception nobody is looking at is an exception that stays unhandled.

---

Related: [identity](identity.md) · [notification](notification.md) ·
[../architecture/module-boundaries.md](../architecture/module-boundaries.md)
