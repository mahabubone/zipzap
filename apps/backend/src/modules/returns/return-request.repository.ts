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
}
