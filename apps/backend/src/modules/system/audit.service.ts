/**
 * Audit recording, injectable.
 *
 * `record` needs a manager of the caller's transaction when there IS a transaction, and its own
 * connection when there is not — a login has no business transaction to join. Both paths land in
 * the same append-only table, so the trail has no holes where a caller forgot to pass a manager.
 *
 * Global, like the outbox: the point of an audit trail is that every module can reach it without
 * every other module depending on it.
 *
 * Failure is NOT swallowed. A caller that cannot record what it did has a bug, and quietly
 * dropping the row would leave a trail with a convenient gap in it — worse than an error, because
 * the gap is invisible until someone needs it.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { record, type AuditEntry } from './audit.writer.ts';

@Injectable()
export class AuditService {
  constructor(@InjectDataSource('system') private readonly system: DataSource) {}

  /**
   * @param manager the transaction that made the change, so row and change commit together.
   *   Omit it only when the action has no business write to be atomic with.
   */
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    await record(manager ?? this.system.manager, entry);
  }
}
