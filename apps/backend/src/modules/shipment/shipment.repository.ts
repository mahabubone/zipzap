/**
 * Shipment repository. Joins the caller's transaction — it must never open its own.
 * See AGENTS.md: "Repositories accept an optional EntityManager".
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { ShipmentEntity } from './shipment.entity.ts';
import { type ShipmentStatus } from './rules/state-machine.ts';

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

  /** Status moves and counter bumps join the caller's transaction. */
  save(manager: EntityManager, entity: ShipmentEntity): Promise<ShipmentEntity> {
    return manager.getRepository(ShipmentEntity).save(entity);
  }

  findById(manager: EntityManager, id: string): Promise<ShipmentEntity | null> {
    return manager.getRepository(ShipmentEntity).findOneBy({ id });
  }

  /**
   * The bulk dedupe anchor: merchant + their invoice reference. One row per
   * merchant invoice, ever — re-uploads skip instead of doubling parcels.
   */
  findByMerchantReference(
    manager: EntityManager,
    merchantId: string,
    reference: string,
  ): Promise<ShipmentEntity | null> {
    return manager
      .getRepository(ShipmentEntity)
      .findOneBy({ merchantId, merchantReference: reference });
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
   * A shipment id in, its owning merchant out. Same contract shape as the reads
   * above — the fan-out needs the owner, and must not open this connection directly.
   */
  async findMerchantId(manager: EntityManager, shipmentId: string): Promise<string | null> {
    const row = await manager
      .createQueryBuilder(ShipmentEntity, 's')
      .select('s.merchantId', 'merchantId')
      .where('s.id = :id', { id: shipmentId })
      .getRawOne<{ merchantId: string }>();
    return row?.merchantId ?? null;
  }

  /**
   * The notification boundary's read: a shipment id in, its recipient contact out.
   * Same contract shape as the reads above — the consumer needs the phone, and
   * must not open this connection directly.
   */
  async findRecipient(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<{ name: string; phone: string } | null> {
    const row = await manager
      .createQueryBuilder(ShipmentEntity, 's')
      .select('s.recipientName', 'name')
      .addSelect('s.recipientPhone', 'phone')
      .where('s.id = :id', { id: shipmentId })
      .getRawOne<{ name: string; phone: string }>();
    if (!row) return null;
    return { name: row.name, phone: row.phone };
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
  ): Promise<ShipmentEntity[]> {
    const query = manager
      .createQueryBuilder(ShipmentEntity, 's')
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

  /** Status counting. Each query owns only the `shipment` schema; the dashboard
   * aggregates many such single-schema reads — it never joins across schemas. */
  countByStatus(manager: EntityManager, status: ShipmentStatus): Promise<number> {
    return manager.getRepository(ShipmentEntity).countBy({ status });
  }

  /** All statuses with a count greater than zero. Missing statuses are filled with
   * zero by the caller so the by-status map is always complete. */
  async countsByStatus(manager: EntityManager): Promise<Map<string, number>> {
    const rows = await manager
      .createQueryBuilder(ShipmentEntity, 's')
      .select('s.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('s.status')
      .getRawMany();
    return new Map(rows.map((r) => [r.status, Number(r.count)]));
  }

  countByStatuses(manager: EntityManager, statuses: readonly ShipmentStatus[]): Promise<number> {
    return manager.getRepository(ShipmentEntity).count({ where: { status: In(statuses) } });
  }

  /** Calendar day boundaries for `today` counting. */
  private todayStart(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private todayEnd(): Date {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }

  countTodayShipments(manager: EntityManager): Promise<number> {
    return manager
      .createQueryBuilder(ShipmentEntity, 's')
      .where('s.createdAt >= :start', { start: this.todayStart() })
      .andWhere('s.createdAt < :end', { end: this.todayEnd() })
      .getCount();
  }

  countInTransit(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'IN_TRANSIT');
  }

  countAtHub(manager: EntityManager): Promise<number> {
    return this.countByStatuses(manager, ['AT_ORIGIN_HUB', 'AT_DESTINATION_HUB']);
  }

  countSorting(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'SORTING');
  }

  countOutForDelivery(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'OUT_FOR_DELIVERY');
  }

  countDelivered(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'DELIVERED');
  }

  countFailed(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'DELIVERY_FAILED');
  }

  countReturned(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'RETURNED');
  }

  countReturning(manager: EntityManager): Promise<number> {
    return this.countByStatuses(manager, [
      'RETURN_INITIATED',
      'RETURN_IN_TRANSIT',
      'RETURN_AT_HUB',
      'RETURN_OUT_FOR_DELIVERY',
      'RETURNED',
    ]);
  }

  countCancelled(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'CANCELLED');
  }

  countOnHold(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'ON_HOLD');
  }

  countLostOrDamaged(manager: EntityManager): Promise<number> {
    return this.countByStatuses(manager, ['LOST', 'DAMAGED']);
  }

  countException(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'EXCEPTION');
  }
}
