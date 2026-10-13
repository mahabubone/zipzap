---
title: The daily flow — pickup, delivery, proof
description: What a rider does in the app from taking a job to closing it, including the COD step.
order: 2
audience: rider
---

## Taking a job

Jobs arrive in the **Jobs** tab, newest first. Pickups and deliveries are merged into one list, and
the kind is shown in the row — `PICKUP` or `DELIVERY` — because they lead to different screens.

Tap a job to open it. That is a real navigation, so the hardware back button pops back to the list.

## Pickup

Open a pickup, type or scan the shipment id, and **Queue pickup scan**. The confirmation tells you
the device sequence, which is the number the server will match on — useful when you are reporting a
problem.

## Delivery

A delivery moves forward one **edge** at a time:

| Action   | What changes                 |
| -------- | ---------------------------- |
| Accept   | the job becomes yours to run |
| Dispatch | you are on the way           |
| Complete | delivered, with proof        |

Each of these changes the job's state through the state machine, and an **illegal edge is refused**
— you cannot dispatch a job you have not accepted, and you cannot complete a dispatched one without
proof.

## A failed attempt

When the customer is not available, record an attempt with a reason. The reasons matter:

- **`CUSTOMER_UNAVAILABLE`** and similar are **retryable** — the job returns to `OUT_FOR_DELIVERY`
  and is scheduled for another try
- A **terminal** reason, or a **third failure**, ends the job at `FAILED` and hands the parcel to
  returns

## Cash on delivery

At collection, the app shows the COD amount the shipment was quoted with, and what you actually
took. The quote is **frozen at creation** — collecting less does not change it. The gap between the
two is a **shortfall**, and it is recorded rather than smoothed over, which is what the
reconciliation queue exists to resolve.

Money is integer poisha. A decimal amount is refused, never rounded.

## Proof of delivery

Proof needs two things: the **delivery code** the customer reads out (minted by the server, so this
step needs signal) and a **photo**. The code arrives from **Send code to customer** and is a 4-digit
number. Queue the proof once both are present — the button stays disabled until they are.
