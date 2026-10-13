/**
 * Delivery repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DeliveryJobEntity } from './delivery.entity.ts';
import { DeliveryAttemptEntity } from './delivery-attempt.entity.ts';
import { DeliveryProofEntity } from './delivery-proof.entity.ts';
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

  insertProof(manager: EntityManager, entity: DeliveryProofEntity): Promise<DeliveryProofEntity> {
    return manager.getRepository(DeliveryProofEntity).save(entity);
  }

  /**
   * The live challenge for a job, locked.
   *
   * `pessimistic_write` because two riders on one job must not both mint a code, and a redemption
   * must not read a code a concurrent reissue has already replaced. `photo_data` stays unselected
   * (`select: false`): both callers want hashes and coordinates, never the megabyte beside them.
   */
  async findProofForUpdate(
    manager: EntityManager,
    jobId: string,
  ): Promise<DeliveryProofEntity | null> {
    return manager
      .createQueryBuilder(DeliveryProofEntity, 'p')
      .setLock('pessimistic_write')
      .where('p.job_id = :jobId', { jobId })
      .getOne();
  }

  /** A VERIFIED proof, or null. The one read `DELIVERED` needs before it will accept a delivery. */
  findVerifiedProof(manager: EntityManager, jobId: string): Promise<DeliveryProofEntity | null> {
    return manager
      .createQueryBuilder(DeliveryProofEntity, 'p')
      .where('p.job_id = :jobId', { jobId })
      .andWhere('p.status = :status', { status: 'VERIFIED' })
      .getOne();
  }

  findById(manager: EntityManager, id: string): Promise<DeliveryJobEntity | null> {
    return manager.getRepository(DeliveryJobEntity).findOneBy({ id });
  }

  /** The newest delivery job for a parcel — retries reuse the same job. */
  async findLatestByShipmentId(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<DeliveryJobEntity | null> {
    return manager
      .createQueryBuilder(DeliveryJobEntity, 'd')
      .where('d.shipment_id = :shipmentId', { shipmentId })
      .orderBy('d.created_at', 'DESC')
      .getOne();
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

  /** A rider's delivery jobs, newest first. */
  async listByRider(
    manager: EntityManager,
    riderId: string,
    take: number,
  ): Promise<DeliveryJobEntity[]> {
    return manager
      .createQueryBuilder(DeliveryJobEntity, 'd')
      .where('d.riderId = :riderId', { riderId })
      .orderBy('d.createdAt', 'DESC')
      .addOrderBy('d.id', 'DESC')
      .take(take)
      .getMany();
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
