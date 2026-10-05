/**
 * ListPickups: one merchant-scoped, cursor-paginated page.
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
import { clampLimit, decodeCursor, encodeCursor } from '../shipment/rules/pagination.ts';
import type { PickupStatus } from './rules/pickup.ts';
import { PickupRepository } from './pickup.repository.ts';

export interface PickupSummary {
  readonly id: string;
  readonly status: PickupStatus;
  readonly shipmentIds: readonly string[];
  readonly riderId: string | null;
  readonly failureReason: string | null;
  readonly totalWeightGrams: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PickupPage {
  readonly data: PickupSummary[];
  readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
}

@Injectable()
export class ListPickupsService {
  constructor(
    @InjectDataSource('pickup') private readonly pickups: DataSource,
    @Inject(PickupRepository) private readonly repository: PickupRepository,
  ) {}

  async execute(merchantId: string, limitRaw: unknown, cursorRaw: unknown): Promise<PickupPage> {
    const limit = clampLimit(limitRaw);
    const after =
      typeof cursorRaw === 'string' && cursorRaw.length > 0
        ? decodeCursor(cursorRaw)
        : { ok: true as const, cursor: null as null };
    if (!after.ok) {
      throw new ValidationFailedError([{ path: 'cursor', message: after.reason }]);
    }

    const rows = await this.repository.pageByMerchant(
      this.pickups.manager,
      merchantId,
      after.cursor ? { createdAt: after.cursor.createdAt, id: after.cursor.id } : null,
      limit + 1,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map((row) => ({
        id: row.id,
        status: row.status,
        shipmentIds: row.shipmentIds,
        riderId: row.riderId,
        failureReason: row.failureReason,
        totalWeightGrams: row.totalWeightGrams,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
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
