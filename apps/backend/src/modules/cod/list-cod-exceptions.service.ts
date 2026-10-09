/**
 * ListCodExceptions — the reconciliation work queue.
 *
 * The plan calls this "the strongest correctness story we have and no competitor surfaces it", and
 * the reason it was not that is simple: there was nowhere to see an exception. Ops could read
 * `GET /v1/cod` and page through every record ever created to find the three that were wrong.
 *
 * A queue is a query, not a table. The rows already exist, already carry the two figures that
 * disagree, and are already indexed on `(merchant_id, created_at DESC) WHERE status =
 * 'RECONCILIATION_EXCEPTION'` by migration 1759000000038. What was missing was the read.
 *
 * Read-only: no transaction, no locks, no outbox. Merchant scope comes from the credential, so a
 * stranger's cursor only repositions within their own queue — cursors are opaque but unsigned.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ValidationFailedError } from '../../common/domain-error.ts';
import { clampLimit, decodeCursor, encodeCursor } from '../shipment/rules/pagination.ts';
import { CodRecordRepository } from './cod-record.repository.ts';

/** One line of the queue: the disagreement, in the two figures that caused it. */
export interface CodException {
  readonly id: string;
  readonly shipmentId: string;
  readonly expectedMinor: number;
  readonly collectedMinor: number | null;
  /** `collected - expected`. Positive means the rider took too much, and it is labelled as a loss. */
  readonly differenceMinor: number;
  readonly currency: string;
  readonly reviewNote: string | null;
  readonly createdAt: string;
}

export interface CodExceptionPage {
  readonly data: ReadonlyArray<CodException>;
  readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
}

@Injectable()
export class ListCodExceptionsService {
  constructor(
    @InjectDataSource('cod') private readonly cod: DataSource,
    @Inject(CodRecordRepository) private readonly repository: CodRecordRepository,
  ) {}

  async execute(
    merchantId: string,
    limitRaw: unknown,
    cursorRaw: unknown,
  ): Promise<CodExceptionPage> {
    const limit = clampLimit(limitRaw);
    const after =
      typeof cursorRaw === 'string' && cursorRaw.length > 0
        ? decodeCursor(cursorRaw)
        : { ok: true as const, cursor: null as null };
    if (!after.ok) {
      throw new ValidationFailedError([{ path: 'cursor', message: after.reason }]);
    }

    const rows = await this.repository.exceptionsFor(
      this.cod.manager,
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
        // bigint columns arrive as strings from `pg`. Coerced here, once, so no consumer of this
        // shape has to remember it — the arithmetic further down is plain integers.
        expectedMinor: Number(row.expectedMinor),
        collectedMinor: row.collectedMinor === null ? null : Number(row.collectedMinor),
        differenceMinor: Number(row.collectedMinor ?? 0) - Number(row.expectedMinor),
        currency: row.currency,
        reviewNote: row.reviewNote,
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
