/**
 * Rider repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { RiderEntity } from './rider.entity.ts';
import { type RiderStatus } from './rules/rider.ts';

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

  /** All assignable riders for pool-wide KPI computation (read, no lock). */
  findAssignable(manager: EntityManager): Promise<RiderEntity[]> {
    return manager.getRepository(RiderEntity).findBy({ status: 'AVAILABLE' });
  }

  /**
   * Every rider that has a position, for the ops map.
   *
   * `last_known_* IS NOT NULL` is the filter, and it is doing real work rather than being tidy: a
   * rider who has never reported has NULL there, and plotting those at (0, 0) would put them in the
   * Gulf of Guinea. The caller counts the ones it cannot draw with `countWithoutPosition`, so the
   * map can say "4 riders, 1 has never reported" instead of quietly drawing three.
   */
  listWithPosition(manager: EntityManager): Promise<
    Array<{
      id: string;
      display_name: string;
      status: string;
      lng: string;
      lat: string;
      last_known_at: Date | null;
      current_job_id: string | null;
    }>
  > {
    return manager.query(
      `SELECT id,
              display_name,
              status,
              last_known_longitude::text AS lng,
              last_known_latitude::text  AS lat,
              last_known_at,
              current_job_id
         FROM rider.riders
        WHERE last_known_latitude IS NOT NULL
          AND last_known_longitude IS NOT NULL
        ORDER BY display_name`,
    );
  }

  countWithoutPosition(manager: EntityManager): Promise<number> {
    return manager
      .createQueryBuilder(RiderEntity, 'r')
      .where('r.lastKnownLatitude IS NULL')
      .getCount();
  }

  /** Status counting. Each query owns only the `rider` schema; the dashboard
   * aggregates many such single-schema reads — it never joins across schemas. */
  countByStatus(manager: EntityManager, status: RiderStatus): Promise<number> {
    return manager.getRepository(RiderEntity).countBy({ status });
  }

  async countsByStatus(manager: EntityManager): Promise<Map<string, number>> {
    const rows = await manager
      .createQueryBuilder(RiderEntity, 'r')
      .select('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.status')
      .getRawMany();
    return new Map(rows.map((r) => [r.status, Number(r.count)]));
  }

  countByStatuses(manager: EntityManager, statuses: readonly RiderStatus[]): Promise<number> {
    return manager.getRepository(RiderEntity).count({ where: { status: In(statuses) } });
  }

  countOnlineRiders(manager: EntityManager): Promise<number> {
    return this.countByStatuses(manager, ['AVAILABLE', 'ON_PICKUP', 'ON_DELIVERY', 'ON_BREAK']);
  }

  countAvailableRiders(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'AVAILABLE');
  }

  countOfflineRiders(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'OFFLINE');
  }

  countSuspendedRiders(manager: EntityManager): Promise<number> {
    return this.countByStatus(manager, 'SUSPENDED');
  }
}
