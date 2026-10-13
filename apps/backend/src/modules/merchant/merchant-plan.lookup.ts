/**
 * MerchantPlanLookup — pricing's read contract for "which plan is this merchant on?".
 *
 * Rule 2: `pricing` owns `pricing.versions` and `merchant` owns `merchant.merchants`, so the
 * discount that decides a price cannot be resolved by joining one to the other. Pricing asks.
 *
 * One method returning a string. Not a plan object, not a list of plans, not the discount — the
 * caller already has `plan_discount_bps` from the pricing version it is quoting against, and
 * returning the rate here would mean two sources for one number, which is how they drift.
 *
 * An unknown merchant returns `'standard'` rather than null. A 0 bps discount and a refusal to
 * quote are very different behaviours for what is, in practice, the same situation — and a caller
 * handling null has to decide which, and would eventually decide it the expensive way.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { MerchantEntity } from './merchant.entity.ts';

export const MERCHANT_PLAN_LOOKUP = Symbol('MERCHANT_PLAN_LOOKUP');

/** The plan every merchant is on until somebody changes it. Mirrors the column default. */
export const DEFAULT_PLAN = 'standard';

@Injectable()
export class MerchantPlanLookup {
  constructor(@InjectDataSource('merchant') private readonly merchant: DataSource) {}

  async planFor(merchantId: string): Promise<string> {
    return this.merchant.transaction(async (manager) => {
      const row = await manager
        .createQueryBuilder(MerchantEntity, 'm')
        .select('m.plan', 'plan')
        .where('m.id = :merchantId', { merchantId })
        .getRawOne<{ plan: string }>();
      return row?.plan ?? DEFAULT_PLAN;
    });
  }
}
