/**
 * COD record repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { CodRecordEntity } from './cod-record.entity.ts';
import { type CodStatus } from './rules/cod.ts';

/**
 * Takes an EntityManager on every method rather than holding a connection. That is what makes
 * "the application service owns the transaction boundary" true by construction — there is no way
 * for this repository to write outside the caller's transaction.
 */
@Injectable()
export class CodRecordRepository {
  /** `manager` must be the caller's transaction manager, so writes join the use case. */
  insert(manager: EntityManager, entity: CodRecordEntity): Promise<CodRecordEntity> {
    return manager.getRepository(CodRecordEntity).save(entity);
  }

  findByShipmentId(manager: EntityManager, shipmentId: string): Promise<CodRecordEntity | null> {
    return manager.getRepository(CodRecordEntity).findOneBy({ shipmentId });
  }

  /**
   * Locks the row by shipment id in a single statement. A separate find-then-lock would be a
   * TOCTOU: two concurrent collections could both read COD_EXPECTED before either locks.
   */
  async findByShipmentIdForUpdate(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<CodRecordEntity | null> {
    return manager
      .createQueryBuilder(CodRecordEntity, 'c')
      .setLock('pessimistic_write')
      .where('c.shipmentId = :shipmentId', { shipmentId })
      .getOne();
  }

  save(manager: EntityManager, entity: CodRecordEntity): Promise<CodRecordEntity> {
    return manager.getRepository(CodRecordEntity).save(entity);
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
  ): Promise<CodRecordEntity[]> {
    const query = manager
      .createQueryBuilder(CodRecordEntity, 'c')
      .where('c.merchantId = :merchantId', { merchantId })
      .orderBy('c.createdAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .take(take);
    if (after) {
      query.andWhere('(c.createdAt, c.id) < (:createdAt, :id)', {
        createdAt: after.createdAt,
        id: after.id,
      });
    }
    return query.getMany();
  }

  /** Status counting. Each query owns only the `cod` schema; the dashboard
   * aggregates many such single-schema reads — it never joins across schemas. */
  async countsByMerchant(manager: EntityManager, merchantId: string): Promise<Map<string, number>> {
    const rows = await manager
      .createQueryBuilder(CodRecordEntity, 'c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('c.merchantId = :merchantId', { merchantId })
      .groupBy('c.status')
      .getRawMany();
    return new Map(rows.map((r) => [r.status, Number(r.count)]));
  }

  /**
   * The open-exception queue, newest first.
   *
   * Pinned to `RECONCILIATION_EXCEPTION` in the WHERE rather than filtering in application code,
   * so the partial index from migration 1759000000038 is usable. Ordering is (created_at, id) both
   * DESC for the same reason as every other page here: `created_at` alone is not unique, and a
   * cursor over a non-total order repeats or skips a row.
   */
  exceptionsFor(
    manager: EntityManager,
    merchantId: string,
    after: { createdAt: string; id: string } | null,
    take: number,
  ): Promise<CodRecordEntity[]> {
    const query = manager
      .createQueryBuilder(CodRecordEntity, 'c')
      .where('c.merchantId = :merchantId', { merchantId })
      .andWhere('c.status = :status', { status: 'RECONCILIATION_EXCEPTION' })
      .orderBy('c.createdAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .take(take);
    if (after) {
      query.andWhere('(c.createdAt, c.id) < (:createdAt, :id)', {
        createdAt: after.createdAt,
        id: after.id,
      });
    }
    return query.getMany();
  }

  countByStatus(manager: EntityManager, status: CodStatus): Promise<number> {
    return manager.getRepository(CodRecordEntity).countBy({ status });
  }

  async countsByStatus(manager: EntityManager): Promise<Map<string, number>> {
    const rows = await manager
      .createQueryBuilder(CodRecordEntity, 'c')
      .select('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.status')
      .getRawMany();
    return new Map(rows.map((r) => [r.status, Number(r.count)]));
  }

  countByStatuses(manager: EntityManager, statuses: readonly CodStatus[]): Promise<number> {
    return manager.getRepository(CodRecordEntity).count({ where: { status: In(statuses) } });
  }

  countOutstandingCOD(manager: EntityManager): Promise<number> {
    return this.countByStatuses(manager, [
      'COD_COLLECTED',
      'COD_RECONCILED',
      'COD_PAYABLE',
      'SETTLEMENT_CREATED',
      'SETTLEMENT_HOLD',
    ]);
  }

  /**
   * Reviewed records whose figures disagreed — each one still owes a correcting ADJUSTMENT row.
   *
   * A review that found no difference needs no correction, so `collected <> expected` is part of
   * the predicate rather than a filter applied afterwards. Only `COD_RECONCILED` counts: an
   * unreviewed exception is already blocking, and a match was never wrong.
   *
   * This exists because a review clears the COD block in the same transaction that emits the
   * event, while the correcting ledger row is written later by the finance consumer. Callers use
   * it to refuse acting on a window that is open for as long as that hop takes.
   */
  reviewedMismatches(manager: EntityManager, merchantId: string): Promise<string[]> {
    return manager
      .createQueryBuilder(CodRecordEntity, 'c')
      .select('c.id', 'id')
      .where('c.merchantId = :merchantId', { merchantId })
      .andWhere('c.status = :status', { status: 'COD_RECONCILED' })
      .andWhere('c.collectedMinor <> c.expectedMinor')
      .getRawMany<{ id: string }>()
      .then((rows) => rows.map((row) => row.id));
  }

  /** Money in collection: collected but not yet paid out to the merchant. Integer
   * minor units, summed as bigint arithmetic — never a float. */
  async sumOutstandingCODMinor(manager: EntityManager): Promise<bigint> {
    const row = await manager
      .createQueryBuilder(CodRecordEntity, 'c')
      .select('SUM(c.expectedMinor)', 'amount')
      .where('c.status IN (:...statuses)', {
        statuses: [
          'COD_COLLECTED',
          'COD_RECONCILED',
          'COD_PAYABLE',
          'SETTLEMENT_CREATED',
          'SETTLEMENT_HOLD',
        ],
      })
      .getRawOne<{ amount: string }>();
    return row?.amount ? BigInt(row.amount) : BigInt(0);
  }
}
