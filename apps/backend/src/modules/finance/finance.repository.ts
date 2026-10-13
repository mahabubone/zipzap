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
   *
   * **`ADJUSTMENT` rows on a COD record travel with it, and that was a live-proof catch.** The
   * query used to read `entry_type = 'COD_COLLECTED'` only. A reviewed mismatch leaves two rows —
   * `COD_COLLECTED +125,100` and `ADJUSTMENT -50` — and the freeze took the first and not the
   * second, paying the merchant ৳0.50 more than they were owed. The review had been done correctly;
   * the freeze simply could not see the answer.
   *
   * Pinned to `reference_type = 'COD_RECORD'` because `ADJUSTMENT` is also the return reversal, and
   * a reversal against an already-settled collection must not walk into a fresh freeze. Without that
   * predicate this query would pay out returned parcels a second time.
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
          AND e.reference_type = 'COD_RECORD'
          AND e.entry_type IN ('COD_COLLECTED', 'ADJUSTMENT')
          AND s.id IS NULL
        ORDER BY e.recorded_at, e.id`,
      [merchantId],
    );
  }

  /**
   * Which of `codRecordIds` already have their correcting ADJUSTMENT row.
   *
   * The ids come from `cod` across the module boundary, so this is deliberately a filter rather
   * than a join: rule2 means finance may not read `cod.records`, and it may not be handed a
   * merchant's whole ledger to filter at the call site either.
   */
  async adjustedRecordIds(
    manager: EntityManager,
    codRecordIds: readonly string[],
  ): Promise<Set<string>> {
    if (codRecordIds.length === 0) return new Set();
    const rows = await manager.query(
      `SELECT DISTINCT reference_id FROM finance.ledger_entries
        WHERE reference_type = 'COD_RECORD' AND entry_type = 'ADJUSTMENT'
          AND reference_id = ANY($1::uuid[])`,
      [codRecordIds],
    );
    return new Set(rows.map((row: { reference_id: string }) => row.reference_id));
  }

  /**
   * Aliased to camelCase for the reason `findUnsettledCodEntries` documents: raw `manager.query`
   * hands back snake_case, and a caller reading `amountMinor` off a row named `amount_minor` gets
   * `undefined`, then `Number(undefined)`, then NaN inside the arithmetic. That failure was found
   * live, not reasoned out.
   */
  entriesFor(manager: EntityManager, merchantId: string): Promise<LedgerEntryEntity[]> {
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
        WHERE e.merchant_id = $1
        ORDER BY e.recorded_at, e.id`,
      [merchantId],
    );
  }

  /**
   * The oldest settlement still in flight, or null.
   *
   * "In flight" is everything from CREATED up to but excluding SETTLED. A settled row is history and
   * naming it as the *next* payout would tell a merchant money is coming that already arrived.
   */
  async firstUnsettled(
    manager: EntityManager,
    merchantId: string,
  ): Promise<{ reference: string; netMinor: number } | null> {
    const rows = await manager.query(
      `SELECT reference AS "reference", frozen_net_minor::text AS "netMinor"
         FROM finance.settlements
        WHERE merchant_id = $1
          AND status IN ('CREATED', 'APPROVED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED')
        ORDER BY created_at
        LIMIT 1`,
      [merchantId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return { reference: row.reference, netMinor: Number(row.netMinor) };
  }

  /**
   * Ledger detail for a frozen item set: memo, timestamp, and the shipment a line is about.
   *
   * Both tables here are `finance`'s own, so this is not a boundary crossing — it is the join the
   * statement needs. The shipment id comes from the reference/memo rather than from
   * `shipment.shipments`, which would be rule 2 *and* a worse product: a statement should not change
   * because a parcel row was archived.
   *
   * Takes the frozen items rather than a settlement id, because the freeze is the authority. Reading
   * "the entries this settlement contains" from `items_json` and looking each one up is one query and
   * one interpretation; re-deriving the set from the ledger would be a second definition of
   * membership, and the two would eventually disagree.
   *
   * CamelCased for the reason `findUnsettledCodEntries` documents: raw `manager.query` returns
   * snake_case and the caller reads `occurredAt`.
   */
  async lineDetail(
    manager: EntityManager,
    items: unknown,
    currency: string,
  ): Promise<Map<string, { memo: string | null; occurredAt: string; shipmentId: string | null }>> {
    const entries = Array.isArray(items)
      ? items
          .map((item) => (item as { entryId?: unknown }).entryId)
          .filter((id): id is string => typeof id === 'string')
      : [];
    if (entries.length === 0) return new Map();

    const rows = await manager.query(
      `SELECT id AS "id", memo AS "memo", occurred_at AS "occurredAt"
         FROM finance.ledger_entries
        WHERE id = ANY($1::uuid[]) AND currency = $2`,
      [entries, currency],
    );

    return new Map(
      rows.map((row: { id: string; memo: string | null; occurredAt: string }) => [
        row.id,
        {
          memo: row.memo,
          occurredAt: new Date(row.occurredAt).toISOString(),
          // The memo carries the shipment id because the reference points at a COD record, not a
          // shipment, and the merchant's statement is organised by parcel. Parsed, not joined:
          // see the method note.
          shipmentId: /shipment ([0-9a-f-]{36})/.exec(row.memo ?? '')?.[1] ?? null,
        },
      ]),
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

  /**
   * One merchant-scoped page, newest first. Total order is (created_at, id)
   * both DESC — created_at alone is not unique, and the cursor then repeats
   * or skips a row. The composite WHERE keeps the page stable under writes:
   * rows created after paging started sort before the cursor, never inside it.
   */
  async pageByMerchant(
    manager: EntityManager,
    merchantId: string,
    after: { createdAt: string; id: string } | null,
    take: number,
  ): Promise<SettlementEntity[]> {
    const query = manager
      .createQueryBuilder(SettlementEntity, 's')
      .where('s.merchantId = :merchantId', { merchantId })
      .orderBy('s.createdAt', 'DESC')
      .addOrderBy('s.id', 'DESC')
      .take(take);
    if (after) {
      query.andWhere('(s.createdAt, s.id) < (:createdAt, :id)', {
        createdAt: after.createdAt,
        id: after.id,
      });
    }
    return query.getMany();
  }
}
