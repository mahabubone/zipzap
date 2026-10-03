/**
 * Shipment repository. Joins the caller's transaction — it must never open its own.
 * See AGENTS.md: "Repositories accept an optional EntityManager".
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { ShipmentEntity } from './shipment.entity.ts';

/**
 * Takes an EntityManager on every method rather than holding a connection. That is what makes
 * "the application service owns the transaction boundary" true by construction — there is no way
 * for this repository to write outside the caller's transaction.
 */
@Injectable()
export class ShipmentRepository {
  /** `manager` must be the caller's transaction manager, so writes join the use case. */
  insert(manager: EntityManager, entity: ShipmentEntity): Promise<ShipmentEntity> {
    return manager.getRepository(ShipmentEntity).save(entity);
  }

  findById(manager: EntityManager, id: string): Promise<ShipmentEntity | null> {
    return manager.getRepository(ShipmentEntity).findOneBy({ id });
  }

  /**
   * Locks the row so two simultaneous transitions serialise. Without this, two riders scanning
   * at once both read the same state and both advance the machine.
   */
  async findByIdForUpdate(manager: EntityManager, id: string): Promise<ShipmentEntity | null> {
    const found = await manager
      .createQueryBuilder(ShipmentEntity, 's')
      .setLock('pessimistic_write')
      .where('s.id = :id', { id })
      .getOne();
    return found;
  }
}
