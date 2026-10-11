---
title: The control tower, and what the colour means
description: 'Reading the network-wide view: what is live, what is stale, and which colour means "do nothing".'
order: 1
audience: operator
---

## What is on the tower

The **control tower** is the network-wide view: parcels by state, riders by availability, and
shipments that have not moved in a while. It is an operations surface, not a reporting one — the
question it answers is "where is something stuck", not "how did last month go".

## Live versus stale

Parcels refresh on a cycle and a stale row is shown with its age. **A count that has not updated in
a while is not a count.** Treat the age as part of the number: a stale "12 out for delivery" on a
Wednesday afternoon is probably riders whose devices are in a dead zone, not riders who are lost.

## Colour

| Colour | Means                                                                               |
| ------ | ----------------------------------------------------------------------------------- |
| Green  | moving normally                                                                     |
| Amber  | at risk — a shipment that has not moved within its expected window, a rider offline |
| Red    | needs action now                                                                    |

Amber is not a queue of work. It is a queue of _attention_: something drifting. A red that has been
red for a while with no new rows usually means a dependency, not the parcels.

## What to do with a stuck shipment

1. **Look at the last scan.** Every state change is recorded, and the last scan's location and time
   says more than the current state does.
2. **Check the rider's position history**, if it is populated — a rider who stopped reporting while
   the shipment moved is a different problem from a rider who moved while the shipment did not.
3. **Check the worker.** The tracking timeline is a **projection**, not a table. If `/track/:code`
   404s for a shipment that exists, the worker is down — that is the first thing to check and the
   first thing to rule out.
