/**
 * Delivery repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { DeliveryJobEntity } from './delivery.entity.ts';
import { DeliveryAttemptEntity } from './delivery-attempt.entity.ts';

@Injectable()
export class DeliveryRepository {
  insert(manager: EntityManager, entity: DeliveryJobEntity): Promise<DeliveryJobEntity> {
    return manager.getRepository(DeliveryJobEntity).save(entity);
  }

  insertAttempt(
    manager: EntityManager,
    entity: DeliveryAttemptEntity,
  ): Promise<DeliveryAttemptEntity> {
    return manager.getRepository(DeliveryAttemptEntity).save(entity);
  }

  findById(manager: EntityManager, id: string): Promise<DeliveryJobEntity | null> {
    return manager.getRepository(DeliveryJobEntity).findOneBy({ id });
  }

  /**
   * Locks the row: two riders reporting the same attempt must not both advance the job.
   * A duplicate confirmation on a flaky connection produces one attempt, not two.
   */
  async findByIdForUpdate(manager: EntityManager, id: string): Promise<DeliveryJobEntity | null> {
    return manager
      .createQueryBuilder(DeliveryJobEntity, 'd')
      .setLock('pessimistic_write')
      .where('d.id = :id', { id })
      .getOne();
  }

  save(manager: EntityManager, entity: DeliveryJobEntity): Promise<DeliveryJobEntity> {
    return manager.getRepository(DeliveryJobEntity).save(entity);
  }
}
