/**
 * Pricing repository. Joins the caller's transaction — it must never open its own.
 *
 * Read paths dominate here: the active version is fetched on every quote. There is no cache
 * yet — correctness first, and the version row is one indexed lookup.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { PricingVersionEntity } from './pricing-version.entity.ts';

@Injectable()
export class PricingRepository {
  insert(manager: EntityManager, entity: PricingVersionEntity): Promise<PricingVersionEntity> {
    return manager.getRepository(PricingVersionEntity).save(entity);
  }

  findByVersion(manager: EntityManager, version: number): Promise<PricingVersionEntity | null> {
    return manager.getRepository(PricingVersionEntity).findOneBy({ version });
  }

  findActive(manager: EntityManager): Promise<PricingVersionEntity | null> {
    return manager.getRepository(PricingVersionEntity).findOneBy({ active: true });
  }
}
