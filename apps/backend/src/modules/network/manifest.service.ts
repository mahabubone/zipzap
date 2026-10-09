/**
 * Manifest lifecycle — trip scheduling, cargo lists, the five edges, and the
 * reconciliation check that is the point of the whole table.
 *
 * Every transition is the same shape: lock the row, assert the pure machine,
 * save, write the outbox event — one transaction (rule 6 + rule 7). Nothing
 * ever updates `status` directly.
 *
 * `reconcile` is conditional: before allowing RECEIVED → RECONCILED it asks
 * SHIPMENT_LOOKUP whether every cargo item has actually arrived. A missing
 * shipment raises ManifestIncompleteError (422) and the status does not move —
 * silence is never the answer, and neither is reconciling a manifest whose
 * parcel nobody can find.
 *
 * Tenant note: manifests are internal operations artefacts, not merchant
 * resources — there is no merchantId and no merchant HTTP surface here.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  ManifestIncompleteError,
  ResourceNotFoundError,
  ValidationFailedError,
} from '../../common/domain-error.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { SHIPMENT_LOOKUP, type ShipmentLookup } from '../shipment/shipment.lookup.ts';
import { assertManifestTransition, type ManifestStatus } from './rules/manifest.ts';

interface ManifestRow {
  id: string;
  code: string;
  trip_id: string;
  status: string;
}

export interface ManifestView {
  readonly id: string;
  readonly code: string;
  readonly tripId: string;
  readonly status: ManifestStatus;
}

/** A manifest with its cargo list resolved — what the console renders on the manifest screen. */
export interface ManifestDetail extends ManifestView {
  readonly itemCount: number;
  readonly items: ReadonlyArray<{ readonly shipmentId: string; readonly arrived: boolean }>;
  /** Zero before RECEIVED: nobody has looked yet, which is not the same as nothing missing. */
  readonly missingCount: number;
}

function toView(row: ManifestRow): ManifestView {
  return { id: row.id, code: row.code, tripId: row.trip_id, status: row.status as ManifestStatus };
}

@Injectable()
export class ManifestService {
  constructor(
    @InjectDataSource('network') private readonly network: DataSource,
    @Inject(SHIPMENT_LOOKUP) private readonly shipments: ShipmentLookup,
  ) {}

  /** A trip is one actual movement of a seeded route. */
  async scheduleTrip(routeCode: string): Promise<{ tripId: string; routeId: string }> {
    return this.network.transaction(async (manager) => {
      const routes = (await manager.query(`SELECT id FROM network.routes WHERE code = $1`, [
        routeCode,
      ])) as { id: string }[];
      const route = routes[0];
      if (!route) throw new ResourceNotFoundError(`Route "${routeCode}" not found.`);

      const tripId = randomUUID();
      await manager.query(`INSERT INTO network.trips (id, route_id) VALUES ($1, $2)`, [
        tripId,
        route.id,
      ]);
      await appendOutbox(manager, {
        type: 'TripScheduled',
        aggregateType: 'trip',
        aggregateId: tripId,
        payload: { routeId: route.id, routeCode },
      });
      return { tripId, routeId: route.id };
    });
  }

  /** Seal the cargo list: DRAFT manifest with at least one shipment. */
  async createManifest(tripId: string, shipmentIds: readonly string[]): Promise<ManifestView> {
    if (shipmentIds.length === 0) {
      throw new ValidationFailedError([
        { path: 'shipmentIds', message: 'a manifest needs at least one shipment' },
      ]);
    }
    if (new Set(shipmentIds).size !== shipmentIds.length) {
      throw new ValidationFailedError([{ path: 'shipmentIds', message: 'duplicate shipment id' }]);
    }

    return this.network.transaction(async (manager) => {
      const trips = (await manager.query(`SELECT id FROM network.trips WHERE id = $1`, [
        tripId,
      ])) as { id: string }[];
      if (!trips[0]) throw new ResourceNotFoundError('Trip not found.');

      const manifestId = randomUUID();
      const code = `MNF-${randomBytes(5).toString('hex').toUpperCase()}`;
      await manager.query(
        `INSERT INTO network.manifests (id, code, trip_id, status) VALUES ($1, $2, $3, 'DRAFT')`,
        [manifestId, code, tripId],
      );
      for (const shipmentId of shipmentIds) {
        await manager.query(
          `INSERT INTO network.manifest_items (id, manifest_id, shipment_id) VALUES ($1, $2, $3)`,
          [randomUUID(), manifestId, shipmentId],
        );
      }
      await appendOutbox(manager, {
        type: 'ManifestCreated',
        aggregateType: 'manifest',
        aggregateId: manifestId,
        payload: { code, tripId, shipmentCount: shipmentIds.length },
      });
      return { id: manifestId, code, tripId, status: 'DRAFT' as const };
    });
  }

  /**
   * Manifests, newest first, optionally filtered by status.
   *
   * Exists because the hub console needs a work list and the transitions need a target. Ordered by
   * `(created_at, id)` both DESC — `created_at` alone is not unique, and a console that skips a
   * manifest when two share a timestamp is a console that loses cargo.
   *
   * A null status means no filter. An unrecognised one matches nothing rather than everything:
   * `status=SHIPED` from a typo should show an empty list the operator notices, not every manifest
   * in the network.
   */
  async list(status: string | null = null): Promise<ManifestView[]> {
    return this.network.transaction(async (manager) => {
      const rows = (await manager.query(
        status === null
          ? `SELECT id, code, trip_id, status FROM network.manifests
              ORDER BY created_at DESC, id DESC`
          : `SELECT id, code, trip_id, status FROM network.manifests
              WHERE status = $1
              ORDER BY created_at DESC, id DESC`,
        status === null ? [] : [status],
      )) as ManifestRow[];
      return rows.map(toView);
    });
  }

  /**
   * One manifest with its cargo list and each parcel's arrival resolved.
   *
   * The console renders `missingCount` as the exception badge, so it is resolved here rather than
   * left to the client — a client that counted the list itself would have to ask the same question
   * twice and could disagree with `reconcile`, which is the authority.
   *
   * `missingCount` is 0 before RECEIVED even when nothing has arrived, because nobody has looked
   * yet. "Not checked" and "nothing missing" must not render as the same number.
   */
  async detail(manifestId: string): Promise<ManifestDetail> {
    return this.network.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT id, code, trip_id, status FROM network.manifests WHERE id = $1`,
        [manifestId],
      )) as ManifestRow[];
      const manifest = rows[0];
      if (!manifest) throw new ResourceNotFoundError('Manifest not found.');

      const items = (await manager.query(
        `SELECT shipment_id FROM network.manifest_items WHERE manifest_id = $1 ORDER BY created_at`,
        [manifestId],
      )) as { shipment_id: string }[];

      const checked = manifest.status === 'RECEIVED' || manifest.status === 'RECONCILED';
      const arrived = checked
        ? await Promise.all(items.map((item) => this.shipments.hasArrived(item.shipment_id)))
        : items.map(() => false);

      return {
        ...toView(manifest),
        itemCount: items.length,
        items: items.map((item, index) => ({
          shipmentId: item.shipment_id,
          arrived: arrived[index] === true,
        })),
        missingCount: checked ? arrived.filter((a) => !a).length : 0,
      };
    });
  }

  async seal(manifestId: string): Promise<ManifestView> {
    return this.transition(manifestId, 'SEALED', 'ManifestSealed');
  }

  async dispatch(manifestId: string): Promise<ManifestView> {
    return this.transition(manifestId, 'DISPATCHED', 'ManifestDispatched');
  }

  async receive(manifestId: string): Promise<ManifestView> {
    return this.transition(manifestId, 'RECEIVED', 'ManifestReceived');
  }

  /**
   * RECEIVED → RECONCILED, but only if every cargo item has arrived.
   *
   * The check runs inside the transaction, before the status moves: a missing
   * shipment throws, the transaction rolls back, and the manifest stays
   * RECEIVED — visibly un-reconciled — until the parcel shows up or the
   * exception is resolved. The same retry then passes.
   */
  async reconcile(manifestId: string): Promise<ManifestView> {
    return this.network.transaction(async (manager) => {
      const manifest = await this.lock(manager, manifestId);
      assertManifestTransition(manifest.status as ManifestStatus, 'RECONCILED');

      const items = (await manager.query(
        `SELECT shipment_id FROM network.manifest_items WHERE manifest_id = $1 ORDER BY created_at`,
        [manifestId],
      )) as { shipment_id: string }[];
      const arrived = await Promise.all(
        items.map((item) => this.shipments.hasArrived(item.shipment_id)),
      );
      const missing = items.filter((_, index) => !arrived[index]).map((item) => item.shipment_id);
      if (missing.length > 0) {
        throw new ManifestIncompleteError(missing);
      }

      const saved = await this.save(manager, manifest, 'RECONCILED');
      await appendOutbox(manager, {
        type: 'ManifestReconciled',
        aggregateType: 'manifest',
        aggregateId: manifestId,
        payload: { code: manifest.code, tripId: manifest.trip_id, itemCount: items.length },
      });
      return toView(saved);
    });
  }

  private async transition(
    manifestId: string,
    to: ManifestStatus,
    eventType: string,
  ): Promise<ManifestView> {
    return this.network.transaction(async (manager) => {
      const manifest = await this.lock(manager, manifestId);
      assertManifestTransition(manifest.status as ManifestStatus, to);
      const saved = await this.save(manager, manifest, to);
      await appendOutbox(manager, {
        type: eventType,
        aggregateType: 'manifest',
        aggregateId: manifestId,
        payload: { code: manifest.code, tripId: manifest.trip_id, status: to },
      });
      return toView(saved);
    });
  }

  private async lock(
    manager: { query: (sql: string, params: unknown[]) => Promise<unknown[]> },
    id: string,
  ): Promise<ManifestRow> {
    const rows = (await manager.query(
      `SELECT id, code, trip_id, status FROM network.manifests WHERE id = $1 FOR UPDATE`,
      [id],
    )) as ManifestRow[];
    const row = rows[0];
    if (!row) throw new ResourceNotFoundError('Manifest not found.');
    return row;
  }

  private async save(
    manager: { query: (sql: string, params: unknown[]) => Promise<unknown[]> },
    manifest: ManifestRow,
    status: ManifestStatus,
  ): Promise<ManifestRow> {
    await manager.query(
      `UPDATE network.manifests SET status = $2, updated_at = now() WHERE id = $1`,
      [manifest.id, status],
    );
    return { ...manifest, status };
  }
}
