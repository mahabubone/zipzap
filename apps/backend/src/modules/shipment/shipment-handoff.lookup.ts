/**
 * ShipmentHandoffLookup — the rider boundary's read contract for what is on a parcel.
 *
 * Rule 2: `delivery` owns `delivery.delivery_jobs` and `shipment` owns `shipment.shipments`, so a
 * rider's job list cannot join the parcel it is delivering to find out what to collect or who to
 * call. The rider module asks this, and nothing else.
 *
 * This exists because of a gap that cost a rider money: the delivery job carried a shipment id and
 * nothing else, so a rider was asked to collect cash without being told how much, and to call a
 * customer whose number had never reached the device. Both fields live on the shipment.
 *
 * One accessor over a set of ids rather than one row per call, because the home feed is twenty rows
 * and a per-row round trip would be twenty. Missing ids are simply absent from the map — a caller
 * that gets no entry knows the parcel is gone and can say so, which is the honest answer when a
 * shipment was cancelled while the rider was offline.
 *
 * Sits in the `shipment` module, not `rider`: the entity is shipment's, and a `rider` file
 * importing `shipment.entity.ts` is exactly the ADR-0002 violation the boundary checker exists for.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ShipmentEntity } from './shipment.entity.ts';

export const SHIPMENT_HANDOFF_LOOKUP = Symbol('SHIPMENT_HANDOFF_LOOKUP');

/** The part of a shipment a rider needs at the door. Read-only and deliberately small. */
export interface ShipmentHandoff {
  readonly shipmentId: string;

  /**
   * Cash on delivery in integer minors (poisha), or 0 for a prepaid parcel.
   *
   * A number rather than a nullable field: "prepaid" and "nothing due" are the same instruction to
   * a rider collecting cash, and a nullable amount is a field the screen has to interpret on every
   * render.
   */
  readonly codAmountMinor: number;

  readonly codCurrency: string;

  /** Who to ring. Absent only when the shipment carries no number, which is a data problem. */
  readonly recipientPhone: string | null;

  /** Where it is going, so a rider can confirm they are at the right door. */
  readonly recipientName: string | null;

  readonly recipientAddress: string | null;
}

/**
 * The chunk size for one query. Large enough that the default feed of twenty is a single round
 * trip, small enough that one statement stays cheap. Postgres takes a bound array, so this is a
 * safety rail rather than a correctness requirement.
 */
const CHUNK = 200;

@Injectable()
export class ShipmentHandoffLookup {
  constructor(@InjectDataSource('shipment') private readonly shipmentDataSource: DataSource) {}

  /**
   * The handoffs for `shipmentIds`, keyed by shipment id. Ids with no shipment are omitted.
   *
   * Chunked so a caller cannot build an unbounded `IN (...)` list from a page size somebody else
   * raises. A caller that asks for more than `CHUNK` ids gets them, in several trips.
   */
  async forShipments(shipmentIds: readonly string[]): Promise<Map<string, ShipmentHandoff>> {
    const wanted = [...new Set(shipmentIds)].filter((id) => id.length > 0);
    const result = new Map<string, ShipmentHandoff>();
    if (wanted.length === 0) return result;

    for (let start = 0; start < wanted.length; start += CHUNK) {
      const chunk = wanted.slice(start, start + CHUNK);
      const rows: ShipmentEntity[] = await this.shipmentDataSource.transaction((manager) =>
        manager
          .createQueryBuilder(ShipmentEntity, 's')
          .where('s.id IN (:...ids)', { ids: chunk })
          .getMany(),
      );

      for (const row of rows) {
        result.set(row.id, this.toHandoff(row));
      }
    }
    return result;
  }

  private toHandoff(row: ShipmentEntity): ShipmentHandoff {
    return {
      shipmentId: row.id,
      // The column is bigint and the repository normalises it; Number() is the last line of
      // defence, because a bigint crossing as a string would make a rider's addition silently
      // wrong.
      codAmountMinor: Number(row.codAmountMinor),
      codCurrency: row.codCurrency,
      recipientPhone: row.recipientPhone,
      recipientName: row.recipientName,
      recipientAddress: row.recipientAddress,
    };
  }
}
