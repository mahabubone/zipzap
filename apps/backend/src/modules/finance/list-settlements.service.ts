/**
 * ListSettlements: one merchant-scoped, cursor-paginated page.
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
import { FinanceRepository } from './finance.repository.ts';

export interface SettlementSummary {
  readonly id: string;
  readonly reference: string;
  readonly status: string;
  readonly frozenNetMinor: number;
  readonly currency: string;
  readonly createdAt: string;
}

export interface SettlementPage {
  readonly data: SettlementSummary[];
  readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
}

@Injectable()
export class ListSettlementsService {
  constructor(
    @InjectDataSource('finance') private readonly finance: DataSource,
    @Inject(FinanceRepository) private readonly repository: FinanceRepository,
  ) {}

  async execute(
    merchantId: string,
    limitRaw: unknown,
    cursorRaw: unknown,
  ): Promise<SettlementPage> {
    const limit = clampLimit(limitRaw);
    const after =
      typeof cursorRaw === 'string' && cursorRaw.length > 0
        ? decodeCursor(cursorRaw)
        : { ok: true as const, cursor: null as null };
    if (!after.ok) {
      throw new ValidationFailedError([{ path: 'cursor', message: after.reason }]);
    }

    const rows = await this.repository.pageByMerchant(
      this.finance.manager,
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
        reference: row.reference,
        status: row.status,
        frozenNetMinor: row.frozenNetMinor,
        currency: row.currency,
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
