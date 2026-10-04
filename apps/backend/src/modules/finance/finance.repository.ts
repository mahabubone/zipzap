/**
 * Finance repository. Joins the caller's transaction — it must never open its own.
 *
 * Two reads matter here: fetching unsettled entries for a freeze, and deriving a balance.
 * Both are SELECTs inside the caller's transaction, so a settlement freeze observes exactly
 * the entries that exist at that instant — nothing committed later can sneak in.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { LedgerEntryEntity } from './ledger-entry.entity.ts';
import { SettlementEntity } from './settlement.entity.ts';

@Injectable()
export class FinanceRepository {
  insertEntry(manager: EntityManager, entity: LedgerEntryEntity): Promise<LedgerEntryEntity> {
    return manager.getRepository(LedgerEntryEntity).save(entity);
  }

  insertSettlement(manager: EntityManager, entity: SettlementEntity): Promise<SettlementEntity> {
    return manager.getRepository(SettlementEntity).save(entity);
  }

  findSettlement(manager: EntityManager, id: string): Promise<SettlementEntity | null> {
    return manager.getRepository(SettlementEntity).findOneBy({ id });
  }

  async findSettlementForUpdate(
    manager: EntityManager,
    id: string,
  ): Promise<SettlementEntity | null> {
    return manager
      .createQueryBuilder(SettlementEntity, 's')
      .setLock('pessimistic_write')
      .where('s.id = :id', { id })
      .getOne();
  }

  saveSettlement(manager: EntityManager, entity: SettlementEntity): Promise<SettlementEntity> {
    return manager.getRepository(SettlementEntity).save(entity);
  }

  /**
   * Unsettled COD-collected entries for a merchant: the exact freeze set for a new settlement.
   * Ordered by recorded_at so the freeze is deterministic across runs.
   */
  findUnsettledCodEntries(
    manager: EntityManager,
    merchantId: string,
  ): Promise<LedgerEntryEntity[]> {
    // Aliased to camelCase: raw manager.query returns snake_case column names, and the service
    // reads entity-shaped fields. An unaliased SELECT e.* would hand back amount_minor while the
    // caller reads amountMinor — undefined, then Number(undefined), then NaN deep inside
    // netPayable. That failure was found live, not reasoned out.
    return manager.query(
      `SELECT e.id AS "id",
              e.merchant_id AS "merchantId",
              e.entry_type AS "entryType",
              e.direction AS "direction",
              e.amount_minor AS "amountMinor",
              e.currency AS "currency",
              e.reference_type AS "referenceType",
              e.reference_id AS "referenceId",
              e.memo AS "memo",
              e.occurred_at AS "occurredAt",
              e.recorded_at AS "recordedAt"
         FROM finance.ledger_entries e
         LEFT JOIN finance.settlements s
           ON s.merchant_id = $1
          AND s.status IN ('APPROVED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'SETTLED')
          AND s.items_json @> jsonb_build_array(jsonb_build_object('entryId', e.id::text))
        WHERE e.merchant_id = $1
          AND e.entry_type = 'COD_COLLECTED'
          AND s.id IS NULL
        ORDER BY e.recorded_at, e.id`,
      [merchantId],
    );
  }

  /** Derived balance. Never a stored counter — see money-and-ledger.md. */
  async balanceMinor(manager: EntityManager, merchantId: string): Promise<number> {
    const rows = await manager.query(
      `SELECT COALESCE(SUM(direction * amount_minor), 0)::text AS balance
         FROM finance.ledger_entries
        WHERE merchant_id = $1`,
      [merchantId],
    );
    return Number(rows[0]?.balance ?? 0);
  }
}
