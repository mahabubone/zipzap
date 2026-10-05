/**
 * ListReturns: one merchant-scoped, cursor-paginated page.
 *
 * Read-only: no transaction, no locks, no outbox. Mirrors ListShipmentsService —
 * same composite (createdAt, id) cursor, same limit+1 probe. Cursors are opaque
 * but unsigned; a malformed cursor is a 400 with a named reason, never a SQL error.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ValidationFailedError } from '../../common/domain-error.ts';
import { ReturnRequestRepository } from './return-request.repository.ts';
import { clampLimit, decodeCursor, encodeCursor } from '../shipment/rules/pagination.ts';

export interface ReturnSummary {
  readonly id: string;
  readonly shipmentId: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface ReturnPage {
  readonly data: ReturnSummary[];
  readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
}

@Injectable()
export class ListReturnsService {
  constructor(
    @InjectDataSource('returns') private readonly returns: DataSource,
    @Inject(ReturnRequestRepository) private readonly repository: ReturnRequestRepository,
  ) {}

  async execute(merchantId: string, limitRaw: unknown, cursorRaw: unknown): Promise<ReturnPage> {
    const limit = clampLimit(limitRaw);
    const after =
      typeof cursorRaw === 'string' && cursorRaw.length > 0
        ? decodeCursor(cursorRaw)
        : { ok: true as const, cursor: null as null };
    if (!after.ok) {
      throw new ValidationFailedError([{ path: 'cursor', message: after.reason }]);
    }

    const rows = await this.repository.pageByMerchant(
      this.returns.manager,
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
        shipmentId: row.shipmentId,
        status: row.status,
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
