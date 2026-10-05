/**
 * ShipmentAdvanceService — the ONLY validated write path for
 * `shipment.shipments.status`.
 *
 * Rule 6: a status column is never UPDATEd directly; it changes through a
 * transition that validates the current state. Pickup, hub scans and delivery
 * each cause the parcel to move, and each runs in its OWN transaction — so
 * this contract takes the caller's EntityManager and writes with qualified
 * SQL (`shipment.…`), exactly like AppendTrackingEventService does for
 * `tracking.…`. The SQL lives here, in the owning module, which is what keeps
 * `check-boundaries` honest while any connection can run it.
 *
 * It writes the status column only — no tracking event, no outbox row. The
 * operation that caused the movement (a scan, a dispatch, a pickup) announces
 * the fact; a second event here would say the same thing twice.
 */

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { assertTransition, type ShipmentStatus } from './rules/state-machine.ts';

@Injectable()
export class ShipmentAdvanceService {
  /**
   * Lock, assert, save — inside the CALLER's transaction. A shipment the
   * caller's tenant does not own is still advanceable here: the caller's
   * operation (pickup, delivery, hub scan) is what proved ownership; this
   * contract deliberately takes no merchantId so ops-side flows can use it.
   */
  async advance(
    manager: EntityManager,
    shipmentId: string,
    to: ShipmentStatus,
  ): Promise<ShipmentStatus> {
    const rows = (await manager.query(
      `SELECT id, status FROM shipment.shipments WHERE id = $1 FOR UPDATE`,
      [shipmentId],
    )) as { status: string }[];
    const row = rows[0];
    if (!row) throw new ResourceNotFoundError('Shipment not found.');

    assertTransition(row.status as ShipmentStatus, to);
    await manager.query(
      `UPDATE shipment.shipments SET status = $2, updated_at = now() WHERE id = $1`,
      [shipmentId, to],
    );
    return to;
  }

  /**
   * Same-transaction visibility of current statuses, for completeness checks
   * (e.g. "has every parcel in this pickup been scanned yet?"). Reads on the
   * caller's manager see the advances this transaction has already made —
   * a lookup through a second connection could not.
   */
  async statuses(
    manager: EntityManager,
    shipmentIds: readonly string[],
  ): Promise<Record<string, string>> {
    if (shipmentIds.length === 0) return {};
    const rows = (await manager.query(
      `SELECT id, status FROM shipment.shipments WHERE id = ANY($1::uuid[])`,
      [[...shipmentIds]],
    )) as { id: string; status: string }[];
    return Object.fromEntries(rows.map((row) => [row.id, row.status]));
  }
}
