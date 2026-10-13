# PLAN — Hub assignment model + desktop + rider R6/R7

Locked 2026-10-12. Each phase unlocks the next.

## Phase A — Hub assignment model (backend)

`HUB_OPERATOR` currently sees every hub; the picker exists because there's no
"this person works at this hub" in the model.

1. **Migration `hub.staff`** — `user_id`, `hub_id`, `role` ('MANAGER'|'OPERATOR'),
   `assigned_at`, `assigned_by`, `revoked_at` (nullable). Partial unique index on
   `user_id` where `revoked_at IS NULL` → one active hub per person, enforced at
   the DB, not app code. No cross-schema FKs (ADR-0002).
2. **Scopes**: add `hub:manage` (PLATFORM_SCOPES) — assign/revoke staff, approve
   discrepancies, view capacity. `HUB_MANAGER` role = `HUB_OPERATOR` + `hub:manage`.
3. **Endpoints** (hub module):
   - `GET /v1/hubs/my-hub` — the caller's one assigned hub (404 if none).
   - `GET /v1/hubs/:hubCode/staff` (manager/admin)
   - `POST /v1/hubs/:hubCode/staff` (manager/admin)
   - `DELETE /v1/hubs/:hubCode/staff/:userId` (manager/admin)
   - `GET /v1/hubs` unchanged for PLATFORM_ADMIN; operators use `/my-hub`.
4. **Seed**: assign the seeded hub operator to one hub.

## Phase B — Hub console UI (no picker)

- `/` redirects to `/hubs/$hubCode` after `GET /v1/hubs/my-hub`.
- 404 → "not assigned to a hub — contact your manager" screen.
- New `/hubs/$hubCode/staff` route (manager/admin only).
- Work list, manifests, scan flow unchanged.

## Phase C — Desktop app for hub staff

- `apps/desktop/` Electron shell loading the hub-console web app.
- Kiosk mode (`--kiosk`): no chrome, no devtools, no right-click.
- HttpOnly cookies persisted in Electron's cookie store.

## Phase D — Rider R6: COD amount + customer contact on jobs

- Extend rider jobs query with `codAmountMinor` and `customerPhone`.
- Job detail shows COD amount; call-customer becomes a real `tel:` link.

## Phase E — Rider R7: server-truthful earnings

- `GET /v1/rider/:id/earnings` — projection from the ledger (delivery fees + COD),
  labelled `asOf`.
- Home screen headline = server number; device cash-in-hand stays secondary.

## Phase F — Native bundle fix (separate, optional)

`react-native-screens` build failure blocks R8 (map), R9 (barcode), R10 (push).
Treated as a separate effort; does not hold up A–E.

## Out of scope (deliberately)

- No capacity/scheduling tables yet.
- No batch/inbound-outbound workflow redesign.
- No native bundle fix in this plan.
