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
   * The tracking boundary's read: a shipment id in, its tracking code out. The only thing the
   * consumer may learn, and the only thing it needs. Returns null for a deleted-or-never
   * shipment, which the consumer treats as ignorable rather than fatal — a missing parcel is
   * an operations problem, never a consumer-crash problem.
   */
  async findTrackingCode(manager: EntityManager, shipmentId: string): Promise<string | null> {
    const row = await manager
      .createQueryBuilder(ShipmentEntity, 's')
      .select('s.trackingCode', 'trackingCode')
      .where('s.id = :id', { id: shipmentId })
      .getRawOne<{ trackingCode: string }>();
    return row?.trackingCode ?? null;
  }

  /**
   * The COD boundary's read: a shipment id in, its quoted COD amount out. Same contract shape
   * as findTrackingCode — delivery needs the expected amount to collect against, and must not
   * open the shipment connection directly. Null means no COD on this shipment (or unknown id);
   * the caller treats both as "nothing to collect", never as zero to invent.
   */
  async findCodAmount(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<{ amountMinor: number; currency: string } | null> {
    const row = await manager
      .createQueryBuilder(ShipmentEntity, 's')
      .select('s.codAmountMinor', 'amountMinor')
      .addSelect('s.codCurrency', 'currency')
      .where('s.id = :id', { id: shipmentId })
      .getRawOne<{ amountMinor: string; currency: string }>();
    if (!row) return null;
    return { amountMinor: Number(row.amountMinor), currency: row.currency };
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
