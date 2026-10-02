# Retention and privacy

Retention is a policy decision with a schema consequence. Getting it backwards means either
deleting financial evidence or keeping customer data indefinitely. Both are failures.

---

## The asymmetry

**Operational data is high-volume and low-value. Financial and audit data is low-volume and
irreplaceable.**

| Data                      | Volume    | Disputable? | Retention                               |
| ------------------------- | --------- | ----------- | --------------------------------------- |
| `tracking.events`         | very high | rarely      | short — 12 months                       |
| `notification.deliveries` | high      | no          | short — 6 months                        |
| webhook delivery logs     | high      | **yes**     | medium — 24 months                      |
| `rider` device telemetry  | high      | no          | short — 3 months                        |
| audit events              | medium    | **yes**     | long — statutory minimum, 7 years       |
| `finance.ledger_entries`  | low       | **yes**     | long — statutory minimum                |
| settlements               | low       | **yes**     | permanent                               |
| proof of delivery media   | medium    | **yes**     | medium, with financial linkage retained |

Tracking events may outnumber everything else combined by orders of magnitude. They are also
the data nobody disputes three months later. Deleting them early costs almost nothing; deleting a
ledger entry costs a merchant the right to contest a payment.

**Retention is not uniform, and a single global policy is always wrong for someone.**

## The real limit

Legal and contractual requirements vary by jurisdiction and by merchant agreement. Concrete
periods above are placeholders to be confirmed against applicable law and contract.

The schema must support the policy before the policy is enforced. Partition operational tables by
time so a retention window is `DROP TABLE` on a partition — instant, no `DELETE` storm, no
vacuum debt. See [../architecture/database.md](../architecture/database.md#retention).

## Deletion mechanics

```
1. legal or contractual check        ← may forbid deletion entirely
2. cascade through owned data
3. pseudonymise, where deletion would break a financial record
4. record that deletion happened
```

Step 1 is not a formality. Deleting a ledger entry to satisfy a privacy request destroys the
merchant's right to dispute it, and that is a real conflict with a real answer: pseudonymise the
customer reference, keep the money, retain evidence of the request.

Resolve it explicitly, per case, in writing. Never by accident.

## Privacy

Customer data — name, phone, address, phone numbers, delivery photos, GPS — is the most
sensitive thing in the system.

```
minimise        do not store what is not needed
restrict        access per role, tenant-scoped
audit           every read of customer contact data is logged
don't log       never in application logs — see ../AGENTS.md rule 10
encrypt         at rest where the platform provides it
restrict media  proof-of-delivery photos are private data with a physical risk
retain          define it, and delete on request
```

**Audit access, not just restrict it.** An unlogged read of customer contact data is
indistinguishable from a breach, and when it is one you will want the log to already exist.

### Proof-of-delivery media

A photo taken at a customer's home is sensitive beyond its obvious content: it shows the
customer's address, their household, their vehicle, their neighbours. Treat it as customer data
with a shorter retention window than the delivery record it supports.

---

## What is a decision and what is a placeholder

**Decided:** operational data has a shorter retention than financial and audit data; operational
tables are time-partitioned; financial records are never deleted to satisfy a privacy request;
access to customer data is audited.

**Placeholder:** every specific period above, pending legal review and merchant contract terms.

Conflating the two is how a placeholder ends up quoted as policy. Keep them separated.
