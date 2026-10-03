/**
 * Rider repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { RiderEntity } from './rider.entity.ts';

@Injectable()
export class RiderRepository {
  /** `manager` must be the caller's transaction manager, so writes join the use case. */
  findAvailable(manager: EntityManager): Promise<RiderEntity[]> {
    return manager.getRepository(RiderEntity).findBy({ status: 'AVAILABLE' });
  }

  findById(manager: EntityManager, id: string): Promise<RiderEntity | null> {
    return manager.getRepository(RiderEntity).findOneBy({ id });
  }

  /**
   * Locks the row: two dispatchers scoring the same rider must not both assign it.
   * The lock serialises against the transaction that reads — the assignment commits or the
   * row is re-read.
   */
  async findByIdForUpdate(manager: EntityManager, id: string): Promise<RiderEntity | null> {
    return manager
      .createQueryBuilder(RiderEntity, 'r')
      .setLock('pessimistic_write')
      .where('r.id = :id', { id })
      .getOne();
  }

  save(manager: EntityManager, entity: RiderEntity): Promise<RiderEntity> {
    return manager.getRepository(RiderEntity).save(entity);
  }

  insert(manager: EntityManager, entity: RiderEntity): Promise<RiderEntity> {
    return manager.getRepository(RiderEntity).save(entity);
  }
}
