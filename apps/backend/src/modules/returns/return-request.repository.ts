/**
 * Return request repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { ReturnRequestEntity } from './return-request.entity.ts';

@Injectable()
export class ReturnRequestRepository {
  insert(manager: EntityManager, entity: ReturnRequestEntity): Promise<ReturnRequestEntity> {
    return manager.getRepository(ReturnRequestEntity).save(entity);
  }

  findById(manager: EntityManager, id: string): Promise<ReturnRequestEntity | null> {
    return manager.getRepository(ReturnRequestEntity).findOneBy({ id });
  }

  findByShipmentId(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<ReturnRequestEntity | null> {
    return manager.getRepository(ReturnRequestEntity).findOneBy({ shipmentId });
  }

  async findByIdForUpdate(manager: EntityManager, id: string): Promise<ReturnRequestEntity | null> {
    return manager
      .createQueryBuilder(ReturnRequestEntity, 'r')
      .setLock('pessimistic_write')
      .where('r.id = :id', { id })
      .getOne();
  }

  save(manager: EntityManager, entity: ReturnRequestEntity): Promise<ReturnRequestEntity> {
    return manager.getRepository(ReturnRequestEntity).save(entity);
  }

  /**
   * One merchant-scoped page, newest first. Total order is (created_at, id)
   * both DESC — created_at alone is not unique, and the cursor then repeats
   * or skips a row. Mirrors ShipmentRepository.pageByMerchant.
   */
  async pageByMerchant(
    manager: EntityManager,
    merchantId: string,
    after: { createdAt: string; id: string } | null,
    take: number,
  ): Promise<ReturnRequestEntity[]> {
    const query = manager
      .createQueryBuilder(ReturnRequestEntity, 'r')
      .where('r.merchantId = :merchantId', { merchantId })
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .take(take);
    if (after) {
      query.andWhere('(r.createdAt, r.id) < (:createdAt, :id)', {
        createdAt: after.createdAt,
        id: after.id,
      });
    }
    return query.getMany();
  }
}
