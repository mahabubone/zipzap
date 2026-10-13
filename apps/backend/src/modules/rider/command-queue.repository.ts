/**
 * Command queue repository. Joins the caller's transaction — it must never open its own.
 * The pending-window query uses the covering index so pulls stay cheap even with a full
 * queue of rejected/delivered history.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { CommandQueueEntity } from './command-queue.entity.ts';

export interface PendingCommandRow {
  id: string;
  rider_id: string;
  device_sequence: number;
  command_type: string;
  payload: object;
  expected_state: object | null;
  created_at: Date;
}

@Injectable()
export class CommandQueueRepository {
  findCommand(manager: EntityManager, id: string): Promise<CommandQueueEntity | null> {
    return manager.getRepository(CommandQueueEntity).findOneBy({ id });
  }

  findPendingCommands(
    manager: EntityManager,
    riderId: string,
    sinceSeq?: number,
    limit?: number,
  ): Promise<PendingCommandRow[]> {
    const params: unknown[] = [riderId];
    let sql = `
      SELECT id, rider_id, device_sequence, command_type, payload,
             expected_state, created_at
        FROM rider.command_queue
       WHERE rider_id = $1
         AND acknowledged_at IS NULL
         AND rejected_at IS NULL`;
    if (sinceSeq !== undefined) {
      sql += ` AND device_sequence > $${params.length + 1}`;
      params.push(sinceSeq);
    }
    sql += ` ORDER BY created_at ASC, device_sequence ASC`;
    if (limit !== undefined) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }
    return manager.query(sql, params);
  }

  async countPending(manager: EntityManager, riderId: string): Promise<{ count: string }> {
    const [row] = await manager.query(
      `SELECT COUNT(*)::text AS count FROM rider.command_queue
        WHERE rider_id = $1 AND acknowledged_at IS NULL AND rejected_at IS NULL`,
      [riderId],
    );
    return { count: row.count };
  }

  /**
   * Insert a command, or report that this `(rider_id, device_sequence)` already exists.
   *
   * `ON CONFLICT DO NOTHING` is the dedupe, and it is why the method returns a boolean. The unique
   * index was always the real constraint, but without the clause a replayed enqueue surfaced as a
   * raw Postgres 23505 — a 500 for what is the most ordinary event in an offline protocol. The
   * JSDoc above this repository claimed idempotency the code did not have.
   */
  async enqueue(
    manager: EntityManager,
    row: {
      id: string;
      riderId: string;
      deviceSequence: number;
      commandType: string;
      payload: object;
      expectedState: object | null;
      createdAt: Date;
    },
  ): Promise<boolean> {
    const rows = (await manager.query(
      `INSERT INTO rider.command_queue
         (id, rider_id, device_sequence, command_type, payload, expected_state, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (rider_id, device_sequence) DO NOTHING
       RETURNING id`,
      [
        row.id,
        row.riderId,
        row.deviceSequence,
        row.commandType,
        JSON.stringify(row.payload),
        row.expectedState ? JSON.stringify(row.expectedState) : null,
        row.createdAt,
      ],
    )) as unknown[];
    return rows.length > 0;
  }

  /** The existing row for a `(rider_id, device_sequence)`, so a duplicate can be reported honestly. */
  findByDeviceSequence(
    manager: EntityManager,
    riderId: string,
    deviceSequence: number,
  ): Promise<CommandQueueEntity | null> {
    return manager.getRepository(CommandQueueEntity).findOneBy({ riderId, deviceSequence });
  }

  markDelivered(manager: EntityManager, id: string): Promise<void> {
    return manager.query(`UPDATE rider.command_queue SET acknowledged_at = now() WHERE id = $1`, [
      id,
    ]);
  }

  markRejected(manager: EntityManager, id: string, reason: string | null): Promise<void> {
    return manager.query(
      `UPDATE rider.command_queue SET rejected_at = now(), rejection_reason = $2 WHERE id = $1`,
      [id, reason],
    );
  }
}
