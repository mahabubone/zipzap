import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';

/**
 * HubRepository — reads on the `hub` schema, which this module owns.
 *
 * The `hubs` table came from raw SQL (migration 0025) and the module holds no TypeORM entity for
 * it, so every query here is direct SQL. All of it is for the CONSOLE: what hubs exist, and what is
 * sitting at one waiting to be scanned.
 *
 * `parcelsAt` is the load-bearing read. A hub console without it is a scanner with no work list,
 * and the operator has to already know a tracking code to type — which is the thing gloves and a
 * scanning gun make impossible. It reads `hub.parcel_presence`, not `shipment.shipments`: this
 * module owns the presence table and must not reach into another module's tables for a list
 * (rule 2).
 */
@Injectable()
export class HubRepository {
  /** All hubs registered in the network. */
  countHubs(manager: EntityManager): Promise<number> {
    return manager
      .query('SELECT COUNT(*) AS count FROM hub.hubs')
      .then((rows: any[]) => Number(rows[0].count));
  }

  /** Hubs grouped by their kind (e.g. district, regional). */
  countHubsByKind(manager: EntityManager): Promise<Map<string, number>> {
    return manager
      .query('SELECT kind, COUNT(*) AS count FROM hub.hubs GROUP BY kind')
      .then((rows: any[]) => new Map(rows.map((r) => [r.kind, Number(r.count)])));
  }

  /**
   * Every hub, for the console's picker, each with how many parcels are waiting there.
   *
   * The count is 0 for an empty hub rather than null, because "nothing waiting" and "we could not
   * find out" are different answers and only one of them is routine. The count is a correlated
   * subquery rather than a LEFT JOIN + GROUP BY: it is one index lookup per hub, and a hub list is
   * six to forty rows, so the join would cost more in planning than the lookup does in work.
   */
  listWithLoad(manager: EntityManager): Promise<HubSummary[]> {
    return manager
      .query(
        `SELECT h.id,
                h.code,
                h.name,
                h.kind,
                h.network_zone AS "networkZone",
                ST_X(h.location::geometry) AS lng,
                ST_Y(h.location::geometry) AS lat,
                (SELECT count(*)::int FROM hub.parcel_presence p WHERE p.hub_id = h.id)
                  AS "countAtHub"
           FROM hub.hubs h
          ORDER BY h.name`,
      )
      .then((rows: any[]) => rows.map((row) => ({ ...row, countAtHub: Number(row.countAtHub) })));
  }

  /** One hub by code. Null for an unknown code — the caller decides whether that is an error. */
  findByCode(manager: EntityManager, code: string): Promise<HubRow | null> {
    return manager
      .query(
        `SELECT id, code, name, kind, network_zone AS "networkZone",
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat
           FROM hub.hubs
          WHERE code = $1`,
        [code],
      )
      .then((rows: HubRow[]) => rows[0] ?? null);
  }

  /**
   * Everything waiting at one hub, most recently scanned first.
   *
   * `nextScan` is computed in SQL from `last_scan` rather than stored: it is a projection of the
   * scan order, and a stored copy would be a second thing to keep in step with `rules/scan.ts`.
   * The CASE repeats the order deliberately rather than calling into the app, because a list query
   * that needs a rule table loaded to sort is a list query that can be wrong in two places.
   */
  parcelsAt(manager: EntityManager, hubId: string, limit = 100): Promise<ParcelPresence[]> {
    return manager.query(
      `SELECT shipment_id AS "shipmentId",
              tracking_code AS "trackingCode",
              hub_code AS "hubCode",
              last_scan AS "lastScan",
              scanned_at AS "scannedAt",
              CASE last_scan
                WHEN 'INBOUND'  THEN 'SORT'
                WHEN 'SORT'     THEN 'OUTBOUND'
                WHEN 'OUTBOUND' THEN 'DEPARTED'
                WHEN 'DEPARTED' THEN 'ARRIVED'
                WHEN 'ARRIVED'  THEN NULL
              END AS "nextScan"
         FROM hub.parcel_presence
        WHERE hub_id = $1
        ORDER BY scanned_at DESC
        LIMIT $2`,
      [hubId, limit],
    );
  }

  /** Record a parcel as present at a hub. Called inside the scan's transaction. */
  async upsertPresence(
    manager: EntityManager,
    row: {
      readonly shipmentId: string;
      readonly hubId: string;
      readonly hubCode: string;
      readonly trackingCode: string;
      readonly lastScan: string;
    },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO hub.parcel_presence
         (shipment_id, hub_id, hub_code, tracking_code, last_scan, scanned_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (shipment_id) DO UPDATE
         SET hub_id = EXCLUDED.hub_id,
             hub_code = EXCLUDED.hub_code,
             tracking_code = EXCLUDED.tracking_code,
             last_scan = EXCLUDED.last_scan,
             scanned_at = now(),
             updated_at = now()`,
      [row.shipmentId, row.hubId, row.hubCode, row.trackingCode, row.lastScan],
    );
  }

  /**
   * A parcel has left the network's custody. The row is deleted, not flagged.
   *
   * DEPARTED deletes; ARRIVED re-inserts at the destination hub on the next scan. So "at a hub" is
   * always exactly true rather than true unless someone cleared the flag.
   */
  async clearPresence(manager: EntityManager, shipmentId: string): Promise<void> {
    await manager.query(`DELETE FROM hub.parcel_presence WHERE shipment_id = $1`, [shipmentId]);
  }

  // --- staff assignments -----------------------------------------------------

  /**
   * The one hub a user is currently assigned to, or null.
   *
   * The partial unique index (`uq_hub_staff_user_active`) guarantees at most one row where
   * `revoked_at IS NULL`, so this never returns more than one hub. Null means "not assigned" —
   * which is a normal state for a person between hubs, and the console renders a dedicated screen
   * for it rather than a login redirect.
   */
  findMyHub(manager: EntityManager, userId: string): Promise<StaffedHubRow | null> {
    return manager
      .query(
        `SELECT h.id, h.code, h.name, h.kind, h.network_zone AS "networkZone",
                ST_X(h.location::geometry) AS lng,
                ST_Y(h.location::geometry) AS lat,
                s.role AS "staffRole"
           FROM hub.staff s
           JOIN hub.hubs h ON h.id = s.hub_id
          WHERE s.user_id = $1 AND s.revoked_at IS NULL`,
        [userId],
      )
      .then((rows: StaffedHubRow[]) => rows[0] ?? null);
  }

  /** Every active staff member at one hub, oldest assignment first. */
  listStaff(manager: EntityManager, hubId: string): Promise<StaffRow[]> {
    return manager.query(
      `SELECT id, user_id AS "userId", hub_id AS "hubId", role, assigned_at AS "assignedAt",
              assigned_by AS "assignedBy", revoked_at AS "revokedAt"
         FROM hub.staff
        WHERE hub_id = $1 AND revoked_at IS NULL
        ORDER BY assigned_at ASC`,
      [hubId],
    );
  }

  /**
   * Assign a user to a hub. The partial unique index rejects a second active assignment for the
   * same user at the database level, so a race between two managers still produces one row.
   *
   * Returns the inserted row so the caller can report what it created.
   */
  async assignStaff(
    manager: EntityManager,
    params: {
      readonly userId: string;
      readonly hubId: string;
      readonly role: HubStaffRole;
      readonly assignedBy: string;
    },
  ): Promise<StaffRow> {
    const rows = (await manager.query(
      `INSERT INTO hub.staff (user_id, hub_id, role, assigned_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id AS "userId", hub_id AS "hubId", role, assigned_at AS "assignedAt",
                 assigned_by AS "assignedBy", revoked_at AS "revokedAt"`,
      [params.userId, params.hubId, params.role, params.assignedBy],
    )) as StaffRow[];
    // INSERT ... RETURNING always yields exactly one row for a VALUES insert, so `rows[0]` is
    // never undefined here. The non-null assertion documents that the DB guarantees the row.
    return rows[0]!;
  }

  /**
   * Revoke a user's active assignment at a hub. Sets `revoked_at` rather than deleting, so the
   * history of who worked where survives.
   *
   * Returns the number of rows touched — 0 if the user had no active assignment at this hub, which
   * the caller turns into a 404 (not a 403: a 403 would confirm the assignment existed).
   */
  async revokeStaff(manager: EntityManager, hubId: string, userId: string): Promise<number> {
    const result = (await manager.query(
      `UPDATE hub.staff SET revoked_at = now()
        WHERE hub_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [hubId, userId],
    )) as { affected: number } | undefined;
    return typeof result?.affected === 'number' ? result.affected : 0;
  }
}

export type HubStaffRole = 'MANAGER' | 'OPERATOR';

/** A hub row joined with the staff role the caller holds there. */
export interface StaffedHubRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly networkZone: string | null;
  readonly lng: number | null;
  readonly lat: number | null;
  readonly staffRole: HubStaffRole;
}

/** One row from `hub.staff`. */
export interface StaffRow {
  readonly id: string;
  readonly userId: string;
  readonly hubId: string;
  readonly role: HubStaffRole;
  readonly assignedAt: Date;
  readonly assignedBy: string;
  readonly revokedAt: Date | null;
}

export interface HubRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly networkZone: string | null;
  readonly lng: number | null;
  readonly lat: number | null;
}

/** A hub as the console's picker sees it: the row plus its current load. */
export interface HubSummary extends HubRow {
  readonly countAtHub: number;
}

/** One parcel waiting at a hub, and the gesture it is waiting for. */
export interface ParcelPresence {
  readonly shipmentId: string;
  readonly trackingCode: string;
  readonly hubCode: string;
  readonly lastScan: string;
  readonly scannedAt: Date;
  /** Null once it has arrived — there is no further hub gesture for this parcel. */
  readonly nextScan: string | null;
}
