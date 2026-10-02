# Vision

ZipZap is a logistics operating system for e-commerce fulfillment and last-mile delivery.

## The problem

A merchant running an online shop in Bangladesh has to stitch together a courier that is a
black box. They call or email to find out where a parcel is. They maintain a spreadsheet to
reconcile cash collected on their behalf. They learn that a delivery failed only when a rider
gives up. There is no shared language between the merchant, the courier, and the rider — the
handoff is a phone number and a signature on paper.

That gap is not a UI problem. It is an information problem: no single system holds the facts
about a parcel from creation through settlement.

## What ZipZap is

One system that holds those facts end to end:

```
Merchant ─► Order ─► Shipment ─► Pickup ─► Origin hub ─► Line-haul
                ─► Destination hub ─► Last mile ─► Delivered ─► COD ─► Settlement
```

Every physical handover is a recorded scan. Every state change is a validated transition. Every
rupee of cash collected is a ledger entry. Every one of those facts is an event, so every
surface — merchant dashboard, operations console, rider app, public tracking page, financial
report — is a projection of the same history rather than a separate copy of the truth.

## Reference model

Inspired by the publicly documented capabilities of major Bangladesh courier operators:
nationwide pickup and hub routing, scans at each operational stage, tracking, COD, merchant
dashboards, APIs and plugins, bulk order upload, fraud checking, returns, packaging,
warehousing, and merchant reporting. Public materials describe coverage across 8 divisions,
64 districts, and hundreds of upazilas.

ZipZap reproduces that **business-domain complexity** with independently designed
implementations. It does not clone proprietary software, and it does not claim to represent any
real courier's actual network.

## Positioning

Not "a courier clone." The courier vertical is the first application of a broader idea:

> A logistics operating system prototype for e-commerce fulfillment and last-mile delivery.

Adjacent products this generalises toward — fulfillment, warehousing, merchant APIs, routing,
delivery networks — are listed in [roadmap.md](roadmap.md) as directions, not commitments.

## Non-goals

ZipZap will not become:

- a payment processor or banking platform — payment providers sit behind an interface
- a national ERP, marketplace, or social network
- a maps provider — PostGIS stores and queries our own boundaries
- an AI platform, or a replacement for government postal infrastructure

The value is in the operational model and its correctness under failure, not in reimplementing
adjacent industries badly.

## First market

Bangladesh. Currency BDT, timezone Asia/Dhaka, English and Bangla, local phone formats, and the
real administrative hierarchy (division → district → upazila → union → ward). Coverage is data,
not hardcoded logic — see [architecture/database.md](../architecture/database.md) on the
geographic model.

Later markets are a test of whether the model is genuinely general or merely local.
