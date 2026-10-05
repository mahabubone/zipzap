/**
 * Pickup repository. Joins the caller's transaction — it must never open its own.
 *
 * Takes an EntityManager on every method rather than holding a connection. That is what makes
 * "the application service owns the transaction boundary" true by construction — there is no way
 * for this repository to write outside the caller's transaction.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { PickupEntity } from './pickup.entity.ts';

@Injectable()
export class PickupRepository {
  /** `manager` must be the caller's transaction manager, so writes join the use case. */
  insert(manager: EntityManager, entity: PickupEntity): Promise<PickupEntity> {
    return manager.getRepository(PickupEntity).save(entity);
  }

  findById(manager: EntityManager, id: string): Promise<PickupEntity | null> {
    return manager.getRepository(PickupEntity).findOneBy({ id });
  }

  /**
   * Locks the row so two simultaneous assignments serialise. Without this, two dispatchers
   * could assign two riders to the same pickup.
   */
  async findByIdForUpdate(manager: EntityManager, id: string): Promise<PickupEntity | null> {
    return manager
      .createQueryBuilder(PickupEntity, 'p')
      .setLock('pessimistic_write')
      .where('p.id = :id', { id })
      .getOne();
  }

  save(manager: EntityManager, entity: PickupEntity): Promise<PickupEntity> {
    return manager.getRepository(PickupEntity).save(entity);
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
  ): Promise<PickupEntity[]> {
    const query = manager
      .createQueryBuilder(PickupEntity, 'p')
      .where('p.merchantId = :merchantId', { merchantId })
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .take(take);
    if (after) {
      query.andWhere('(p.createdAt, p.id) < (:createdAt, :id)', {
        createdAt: after.createdAt,
        id: after.id,
      });
    }
    return query.getMany();
  }
}
