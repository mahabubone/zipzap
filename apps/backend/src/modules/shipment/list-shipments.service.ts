/**
 * ListShipments: one merchant-scoped, cursor-paginated page.
 *
 * Read-only: no transaction, no locks, no outbox. The merchant scope is the
 * security boundary — a stranger's cursor only repositions within your own
 * list, so cursors are opaque but unsigned. A malformed cursor is a 400 with
 * a named reason, never a SQL error.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ValidationFailedError } from '../../common/domain-error.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { clampLimit, decodeCursor, encodeCursor } from './rules/pagination.ts';
import { parseShipmentFilters, type ShipmentFilters } from './rules/filters.ts';

export interface ShipmentSummary {
  readonly id: string;
  readonly trackingCode: string;
  readonly status: string;
  readonly merchantReference: string | null;
  readonly codAmountMinor: number;
  readonly codCurrency: string;
  /** The zone this parcel was priced against. Null on rows created before the
   *  column existed — the migration deliberately did not backfill, because a
   *  guessed zone is a wrong charge that nobody can later correct. */
  readonly zone: string | null;
  readonly createdAt: string;
}

export interface ShipmentPage {
  readonly data: ShipmentSummary[];
  readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
}

@Injectable()
export class ListShipmentsService {
  constructor(
    @InjectDataSource('shipment') private readonly shipments: DataSource,
    @Inject(ShipmentRepository) private readonly repository: ShipmentRepository,
  ) {}

  async execute(
    merchantId: string,
    limitRaw: unknown,
    cursorRaw: unknown,
    filterRaw: { status?: unknown; zone?: unknown; q?: unknown; from?: unknown; to?: unknown } = {},
  ): Promise<ShipmentPage> {
    const limit = clampLimit(limitRaw);
    const after =
      typeof cursorRaw === 'string' && cursorRaw.length > 0
        ? decodeCursor(cursorRaw)
        : { ok: true as const, cursor: null as null };
    if (!after.ok) {
      throw new ValidationFailedError([{ path: 'cursor', message: after.reason }]);
    }

    const parsed = parseShipmentFilters(filterRaw);
    if (!parsed.ok) {
      // Every bad field at once: a merchant fixing a filter should not have to
      // discover the second problem on the second round trip.
      throw new ValidationFailedError([...parsed.issues]);
    }
    const filters: ShipmentFilters = parsed.filters;

    const rows = await this.repository.pageByMerchant(
      this.shipments.manager,
      merchantId,
      after.cursor ? { createdAt: after.cursor.createdAt, id: after.cursor.id } : null,
      limit + 1,
      filters,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map((row) => ({
        id: row.id,
        trackingCode: row.trackingCode,
        status: row.status,
        merchantReference: row.merchantReference,
        codAmountMinor: row.codAmountMinor,
        codCurrency: row.codCurrency,
        zone: row.zone,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: {
        nextCursor: hasMore
          ? encodeCursor({ v: 1, id: last!.id, createdAt: last!.createdAt.toISOString() })
          : null,
        hasMore,
      },
    };
  }
}
