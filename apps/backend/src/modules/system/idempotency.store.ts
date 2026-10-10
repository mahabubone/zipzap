/**
 * Idempotency store.
 *
 * The unique constraint is the concurrency control, not a check-then-insert (ADR-0010).
 * Two simultaneous requests with the same key: exactly one inserts, the other conflicts and
 * reads the winner's stored response.
 *
 * Every method takes the caller's EntityManager so the key row commits or rolls back with the
 * work it guards. A key recorded outside the transaction would outlive a rollback and
 * permanently block a request that never actually happened.
 */

import type { EntityManager } from 'typeorm';
import {
  decide,
  scopeKey,
  type IdempotencyDecision,
  type IdempotencyScope,
  type StoredIdempotencyRecord,
} from '../../common/idempotency';

export interface ClaimResult {
  readonly decision: IdempotencyDecision;
  /** Only set when decision is 'proceed'. Record the response before committing. */
  readonly complete: (responseCode: number, responseBody: unknown) => Promise<void>;
}

interface ExistingRow {
  request_hash: string;
  response_code: number | null;
  response_body: unknown;
}

function toStored(row: ExistingRow): StoredIdempotencyRecord {
  return {
    requestHash: row.request_hash,
    responseCode: row.response_code,
    responseBody: row.response_body,
  };
}

export async function claim(
  manager: EntityManager,
  scope: IdempotencyScope,
  requestHash: string,
): Promise<ClaimResult> {
  const scoped = scopeKey(scope);

  const inserted = await manager.query(
    `INSERT INTO system.idempotency_keys (scope, idempotency_key, request_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (scope, idempotency_key) DO NOTHING
     RETURNING scope`,
    [scoped, scope.key, requestHash],
  );

  if (inserted.length > 0) {
    return {
      decision: { outcome: 'proceed' },
      complete: async (responseCode, responseBody) => {
        await manager.query(
          `UPDATE system.idempotency_keys
              SET response_code = $3, response_body = $4
            WHERE scope = $1 AND idempotency_key = $2`,
          [scoped, scope.key, responseCode, JSON.stringify(responseBody)],
        );
      },
    };
  }

  const rows: ExistingRow[] = await manager.query(
    `SELECT request_hash, response_code, response_body
       FROM system.idempotency_keys
      WHERE scope = $1 AND idempotency_key = $2`,
    [scoped, scope.key],
  );

  const existing = rows[0];
  if (!existing) {
    // The conflicting inserter rolled back between our INSERT and our SELECT. The work never
    // committed, so there is nothing to replay — let the caller retry.
    throw new Error('Idempotency key vanished between INSERT and SELECT; retry the request.');
  }

  return { decision: decide(toStored(existing), requestHash), complete: async () => undefined };
}

/**
 * Drop a claim that produced no result.
 *
 * Only for a request that was rejected rather than executed — a wrong one-time code, say. The row
 * exists to stop a *successful* operation running twice; a claim whose transaction commits without
 * ever calling `complete` is a tombstone that answers every retry with DUPLICATE_REQUEST, which is
 * a lie about work that never happened. Deleting is safe here precisely because nothing was applied:
 * `system.idempotency_keys` holds no history worth keeping.
 */
export async function release(manager: EntityManager, scope: IdempotencyScope): Promise<void> {
  await manager.query(
    `DELETE FROM system.idempotency_keys WHERE scope = $1 AND idempotency_key = $2`,
    [scopeKey(scope), scope.key],
  );
}
