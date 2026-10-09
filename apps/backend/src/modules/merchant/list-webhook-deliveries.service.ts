/**
 * Reading the webhook delivery log.
 *
 * This is the read that made `POST /v1/webhooks/deliveries/:deliveryId/replay` usable. Replay existed
 * and delivery rows were being written, append-only, with status codes and errors — but a merchant
 * could not *see* any of it. "Replay delivery 8f3a…" requires knowing that 8f3a exists, and the only
 * way to learn that was to already have it. Two competitors have no delivery log at all, so this is
 * the whole of that competitive row.
 *
 * **Tenant-scoped by query, not by filter afterwards.** `merchantId` is in the WHERE clause rather
 * than applied to a full result set, because a log that briefly loads another merchant's rows into
 * this process is a leak even if it never returns them.
 *
 * The rows are never mutated here. `terminal` is the end of the ladder — delivered, permanently
 * failed, or out of retries — and a merchant reading the log learns *where* it is, not how to move it.
 * Replay is a separate, explicit act.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export interface DeliveryLogRow {
  readonly id: string;
  readonly endpointId: string;
  readonly eventType: string;
  readonly attempt: number;
  readonly statusCode: number | null;
  readonly error: string | null;
  readonly delivered: boolean;
  readonly terminal: boolean;
  readonly attemptedAt: string;
}

export interface DeliveryLogPage {
  readonly data: readonly DeliveryLogRow[];
  readonly nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class ListWebhookDeliveriesService {
  constructor(@InjectDataSource('merchant') private readonly merchant: DataSource) {}

  async execute(
    merchantId: string,
    options: {
      readonly endpointId?: string;
      readonly cursor?: string;
      readonly limit?: number;
    } = {},
  ): Promise<DeliveryLogPage> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    return this.merchant.transaction(async (manager) => {
      const params: unknown[] = [merchantId];
      let sql = `
        SELECT id,
               endpoint_id AS "endpointId",
               event_type   AS "eventType",
               attempt,
               status_code  AS "statusCode",
               error,
               delivered,
               terminal,
               attempted_at AS "attemptedAt"
          FROM merchant.webhook_deliveries
         WHERE merchant_id = $1`;

      if (options.endpointId) {
        params.push(options.endpointId);
        sql += ` AND endpoint_id = $${params.length}`;
      }
      if (options.cursor) {
        // The cursor is the row id, so this is keyset pagination rather than OFFSET — a delivery log
        // grows while it is being read, and OFFSET would skip rows as it does.
        params.push(options.cursor);
        sql += ` AND id < $${params.length}`;
      }

      sql += ` ORDER BY id DESC LIMIT ${limit + 1}`;

      const rows = await manager.query(sql, params);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        data: page.map((row: Record<string, unknown>) => ({
          ...row,
          attempt: Number(row.attempt),
          statusCode: row.statusCode === null ? null : Number(row.statusCode),
          attemptedAt: new Date(row.attemptedAt as string).toISOString(),
        })),
        nextCursor: hasMore ? (page[page.length - 1].id as string) : null,
      };
    });
  }
}
