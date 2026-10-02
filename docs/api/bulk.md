# Bulk processing

A 10,000-row CSV must not be a 40-second HTTP request.

## Rule

> A bulk job never performs thousands of synchronous inserts inside one HTTP request.

An upload that times out has already created an unknown number of shipments, and the merchant
does not know whether to retry. That is worse than failing immediately, because the retry
compounds it.

## Flow

```
Upload → Create job → Return job id → Worker processes
      → Progress → Completion → Result file
```

```
POST /v1/shipments/bulk
Content-Type: text/csv

<file>

→ 202 Accepted
{ "job_id": "job_9f2c", "status": "PENDING" }
```

`202`, not `201`. The work has been accepted; the shipments do not exist yet.

## Stages

```
PENDING → VALIDATING → PREVIEW → PROCESSING → COMPLETED
                                       → FAILED
                                       → COMPLETED_WITH_ERRORS
```

`VALIDATING` → `PREVIEW` is a **human checkpoint**. The merchant downloads a preview of what
_would_ be created, with per-row validation errors, and accepts it.

A preview is not a nicety. Every bulk-import product needs it, because the first upload always
has column-mapping mistakes, and 10,000 mis-mapped shipments is a support incident.

## Idempotency

On the **merchant invoice reference**, not the row number and not the upload.

```
invoice
recipient_name
recipient_phone
recipient_address
destination_area
cod_amount
parcel_weight
item_description
delivery_note
```

Re-uploading a corrected file must update the merchant's intent, not create a second set of
10,000 parcels. Either the reference matches an existing shipment — skip it and report it as
`SKIPPED_DUPLICATE` — or create it.

The row-level outcome matters as much as the job outcome:

```
row 412  invoice=ABC-001  SKIPPED_DUPLICATE  "shipment already exists"
row 887  invoice=ABC-002  FAILED            "recipient_phone invalid"
```

## Result file

Downloadable, with every row and its outcome. Not an email, not a summary in the response body.

A merchant needs to reconcile their own records against ours, and that requires the row-level
detail. "2,847 of 3,000 succeeded" tells them nothing they can act on.

## Formats

CSV and XLSX. Accept both; generate CSV for export — it is universally parseable and needs no
library on the reader side.

## Progress

```
GET /v1/shipments/bulk/:jobId

{
  "status": "PROCESSING",
  "total": 3000,
  "processed": 1847,
  "succeeded": 1831,
  "failed": 16,
  "skipped": 0
}
```

Poll it. A websocket is nicer, but polling a job status every few seconds is a solved problem
and does not hold a connection open for a ten-minute import.

## Execution

BullMQ, in chunks. A 10,000-row import is 100 batches of 100, each in its own transaction.

Chunking bounds two things: transaction duration and lock hold time. One 10,000-row transaction
holds locks on 10,000 rows and blocks anything else touching them — including the merchant's own
dashboard reading their shipments.

Partial failure is therefore normal and expected. `COMPLETED_WITH_ERRORS` is a success state,
not a failure state, and the result file explains exactly which rows and why.

---

Related: [idempotency.md](idempotency.md) · [errors.md](errors.md) ·
[../domains/shipment.md](../domains/shipment.md)
