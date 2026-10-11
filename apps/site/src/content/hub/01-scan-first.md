---
title: Scan first, ask questions later
description: 'The dock console is organised around one action: scanning. Everything else is a consequence.'
order: 1
audience: hub
---

## Why scan-first

The hub console is not a screen with a scan button. **The scan is the primary action**, and the
console is the thing that shows you what a scan did. That is deliberate: on a dock, one person with
a device and a stack of parcels needs an interaction measured in seconds, and a form-per-parcel is
an interaction measured in minutes at volume.

## The two scan kinds

A scan either **records** that a parcel arrived at your hub or that it **left**. The kind is
inferred from what you scan and the hub state — you do not pick it.

Scanning a parcel that is not expected is refused, with the reason. A parcel that is already
elsewhere is refused too, and says where. Neither is a silent no-op.

## Reconciling a manifest

Cargo is reconciled at receive, not after. A manifest that arrives with parcels you did not expect
**fails with `MANIFEST_INCOMPLETE`** and stays in `RECEIVED` — the unmatched lines are named rather
than the whole manifest being marked bad, and the manifest stays receiving until it matches.

That matters on a line-haul: a truck that leaves with something you have not accounted for is the
failure this prevents. A sealed manifest cannot be un-sealed, so a mismatch at receive is the last
point the error is cheap.

## Jobs list

The **Jobs** tab lists the work assigned to you, newest first. Pickups and deliveries are merged,
because at a dock both are "a parcel I need to do something with", and the kind is on the row.
