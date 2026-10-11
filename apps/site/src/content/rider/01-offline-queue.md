---
title: What queues offline, and what the sync does
description: The offline queue's guarantees — what survives a dead zone, how it replays, and when a scan is refused.
order: 1
audience: rider
---

## The one thing to know

A scan performed in a basement, a lift, or a building with no signal is **kept**. It is queued on
the device and flushed the moment connectivity returns. You do not have to find signal, open the
Sync tab, or press anything.

That is the whole point of the design, and it is why the app feels different from a form that
submits.

## How the queue is ordered

Each scan is given a **device sequence** — a number minted on the phone, incremented per scan, and
persisted **in the same write** as the scan itself. One write, not two: a crash between them would
mint a sequence the store never saw, and the same number would be reused on the next boot, and the
server would treat a new scan as a replay of the old one.

Replay order is **`createdAt` then `deviceSequence`**, not the device's clock alone. Phones drift,
and a rider with a fast clock would otherwise have their scans applied out of order. The sequence
is the tiebreak the clock cannot provide.

## What a fulfilled delivery needs

One step cannot be offline: the **delivery code**. It is minted by the server, read out by the
customer, and typed into the app. Everything else — the pickup scan, the failed attempt, the COD
amount, the proof photo reference — queues.

## When a scan is refused

If the queue fills (the cap), new scans are **refused rather than silently dropped**. You see an
explicit error and the Sync tab shows "QUEUE NEARLY FULL" before it gets there. Refusing is the
safe direction: losing a scan you thought was accepted is far worse than telling you the device is
full.

## If the server rejects a command

A command can be refused at replay time — most often because the parcel was cancelled while you
were offline. That is **not a failure of the queue**, and your other scans still apply. The Sync
tab lists the rejection with its reason, and a rejected command stays listed rather than vanishing.

Because replay uses the same device sequence every attempt, a request that was sent but whose
response was lost is safe to retry: the server sees a replay and returns the original result.
