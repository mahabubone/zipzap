/**
 * Bulk repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { BulkJobEntity, BulkRowEntity } from './bulk.entity.ts';

@Injectable()
export class BulkRepository {
  insertJob(manager: EntityManager, entity: BulkJobEntity): Promise<BulkJobEntity> {
    return manager.getRepository(BulkJobEntity).save(entity);
  }

  findJob(manager: EntityManager, id: string): Promise<BulkJobEntity | null> {
    return manager.getRepository(BulkJobEntity).findOneBy({ id });
  }

  async findJobForUpdate(manager: EntityManager, id: string): Promise<BulkJobEntity | null> {
    return manager
      .createQueryBuilder(BulkJobEntity, 'j')
      .setLock('pessimistic_write')
      .where('j.id = :id', { id })
      .getOne();
  }

  saveJob(manager: EntityManager, entity: BulkJobEntity): Promise<BulkJobEntity> {
    return manager.getRepository(BulkJobEntity).save(entity);
  }

  saveRow(manager: EntityManager, entity: BulkRowEntity): Promise<BulkRowEntity> {
    return manager.getRepository(BulkRowEntity).save(entity);
  }

  insertRows(manager: EntityManager, entities: BulkRowEntity[]): Promise<BulkRowEntity[]> {
    return manager.getRepository(BulkRowEntity).save(entities);
  }

  findRows(manager: EntityManager, jobId: string): Promise<BulkRowEntity[]> {
    return manager
      .getRepository(BulkRowEntity)
      .find({ where: { jobId }, order: { lineNumber: 'ASC' } });
  }

  findShipmentByReference(
    manager: EntityManager,
    merchantId: string,
    reference: string,
  ): Promise<{ id: string } | null> {
    return manager
      .createQueryBuilder()
      .select('s.id', 'id')
      .from('shipment.shipments', 's')
      .where('s.merchant_id = :merchantId', { merchantId })
      .andWhere('s.merchant_reference = :reference', { reference })
      .getRawOne<{ id: string }>()
      .then((row) => row ?? null);
  }
}
