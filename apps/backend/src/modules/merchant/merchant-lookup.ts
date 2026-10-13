/**
 * MerchantLookup — identity's read contract for "does this business exist?".
 *
 * Rule 2: `merchant` owns `merchant.merchants` and `identity` owns `identity.user_merchants`, and
 * `user_merchants.merchant_id` is deliberately a BARE identifier with no foreign key — ADR-0002 says
 * schemas do not reach into each other. So a membership row can name a business that does not exist,
 * and the write path has to find that out from the module that owns the answer rather than by
 * querying across the boundary. The boundary checker enforces exactly this, and caught the direct
 * query the first time.
 *
 * One method returning a boolean. Not a merchant object, not a status, not the plan — those are
 * `MerchantPlanLookup`'s job, and a second seam returning more is a second thing to keep in step.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { MerchantEntity } from './merchant.entity.ts';

export const MERCHANT_LOOKUP = Symbol('MERCHANT_LOOKUP');

@Injectable()
export class MerchantLookup {
  constructor(@InjectDataSource('merchant') private readonly merchant: DataSource) {}

  async exists(merchantId: string): Promise<boolean> {
    return this.merchant.transaction(async (manager) => {
      const row = await manager
        .createQueryBuilder(MerchantEntity, 'm')
        .select('1', 'one')
        .where('m.id = :merchantId', { merchantId })
        .getRawOne<{ one: number }>();
      return row !== null && row !== undefined;
    });
  }
}
