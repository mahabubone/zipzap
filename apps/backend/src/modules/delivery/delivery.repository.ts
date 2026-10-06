/**
 * Delivery repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DeliveryJobEntity } from './delivery.entity.ts';
import { DeliveryAttemptEntity } from './delivery-attempt.entity.ts';
import { type DeliveryStatus } from './rules/delivery.ts';
import { MAX_ATTEMPTS } from './rules/delivery.ts';

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

  /** Status counting. Each query owns only the `delivery` schema; the dashboard
   * aggregates many such single-schema reads — it never joins across schemas. */
  countByStatus(manager: EntityManager, status: DeliveryStatus): Promise<number> {
    return manager.getRepository(DeliveryJobEntity).countBy({ status });
  }

  async countsByStatus(manager: EntityManager): Promise<Map<string, number>> {
    const rows = await manager
      .createQueryBuilder(DeliveryJobEntity, 'd')
      .select('d.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('d.status')
      .getRawMany();
    return new Map(rows.map((r) => [r.status, Number(r.count)]));
  }

  countByStatuses(manager: EntityManager, statuses: readonly DeliveryStatus[]): Promise<number> {
    return manager.getRepository(DeliveryJobEntity).count({ where: { status: In(statuses) } });
  }

  countOutForDelivery(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'OUT_FOR_DELIVERY');
  }

  countFailedDeliveries(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'FAILED');
  }

  /** Delivery jobs that are ATTEMPTED but still have retry budget (attemptsMade < MAX_ATTEMPTS).
   * The attempts table is append-only, so this counts rows directly on the job for speed. */
  countAttemptsRemaining(manager: EntityManager): Promise<number> {
    return manager
      .createQueryBuilder(DeliveryJobEntity, 'd')
      .where('d.status = :status', { status: 'ATTEMPTED' })
      .andWhere('d.attemptsMade < :max', { max: MAX_ATTEMPTS })
      .getCount();
  }

  countDeliveredDeliveries(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'DELIVERED');
  }

  countPendingDeliveries(manager: EntityManager): Promise<number> {
    return this.countByStatuses(manager, ['CREATED', 'ASSIGNED', 'ACCEPTED']);
  }
}
