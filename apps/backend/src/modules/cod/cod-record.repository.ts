/**
 * COD record repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { CodRecordEntity } from './cod-record.entity.ts';

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
}
