/**
 * EnsureCodRecord — seeds the COD promise at shipment creation.
 *
 * Called from CreateShipment inside the same transaction, through the injected contract.
 * Shipment never touches cod.records; COD never touches shipment.shipments. The promise
 * (expectedMinor, from the frozen quote) is written once, here, and never overwritten —
 * the gap between promise and collection is exactly what reconciliation measures.
 *
 * Zero-COD shipments get no record: there is nothing to promise, nothing to collect, and
 * nothing to reconcile. A collect call against a shipment with no record is a 404, not an
 * empty collection — "never existed" and "collected nothing" are different facts.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';

export interface EnsureCodRecordCommand {
  readonly shipmentId: string;
  readonly merchantId: string;
  readonly expectedMinor: number;
  readonly currency: string;
}

@Injectable()
export class EnsureCodRecordService {
  constructor(@InjectDataSource('cod') private readonly codDataSource: DataSource) {}

  /**
   * Raw SQL through the caller's manager, mirroring AppendTrackingEventService. An entity
   * repository call here would resolve metadata against the *caller's* connection — which
   * knows shipment tables, not cod tables — and fail with EntityMetadataNotFoundError.
   * The confirmed alternative (separate cod transaction + compensating delete) is documented
   * in ensureStandalone below.
   */
  async ensure(manager: EntityManager, command: EnsureCodRecordCommand): Promise<string | null> {
    if (command.expectedMinor <= 0) return null;

    const existing = await manager.query(`SELECT id FROM cod.records WHERE shipment_id = $1`, [
      command.shipmentId,
    ]);
    if (existing.length > 0) return existing[0].id as string;

    const id = randomUUID();
    const now = new Date();
    await manager.query(
      `INSERT INTO cod.records
         (id, shipment_id, merchant_id, expected_minor, collected_minor, currency, status,
          failure_note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, $5, 'COD_EXPECTED', NULL, $6, $6)`,
      [id, command.shipmentId, command.merchantId, command.expectedMinor, command.currency, now],
    );
    return id;
  }

  /** Standalone entry point for tooling and backfill. Opens its own transaction. */
  async ensureStandalone(command: EnsureCodRecordCommand): Promise<string | null> {
    return this.codDataSource.transaction((manager) => this.ensure(manager, command));
  }
}
