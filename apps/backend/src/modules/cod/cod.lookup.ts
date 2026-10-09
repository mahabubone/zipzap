/**
 * CodLookup — the read contract other modules buy instead of opening the `cod` connection.
 *
 * Rule 2 says a module owns its schema. Anything that needs to *read* COD state from outside
 * comes through here, and finance is now the second caller: a settlement freeze has to know whether
 * the merchant has an unreviewed mismatch, and it may not join `cod.records` to find out.
 *
 *   - findCollected: what was actually collected, for a shipment.
 *   - blocksFor:      what is standing between a merchant and a payout, for a merchant.
 *   - reviewedMismatches: reviews that have landed here but whose correction has not reached the
 *     ledger yet. Both sides of that question are needed and neither module can see the other:
 *     cod owns the review, finance owns the ledger.
 *
 * Both return null / a partial map rather than throwing on absence. "No collection" and "no
 * blocker" are the ordinary case, not errors, and a caller that has to tell them apart from a
 * failure will eventually get it wrong.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { CodRecordRepository } from './cod-record.repository.ts';
import { blocksSettlement, type CodStatus } from './rules/cod.ts';

export const COD_LOOKUP = Symbol('COD_LOOKUP');

@Injectable()
export class CodLookup {
  constructor(
    @InjectDataSource('cod') private readonly cod: DataSource,
    @Inject(CodRecordRepository) private readonly records: CodRecordRepository,
  ) {}

  async findCollected(
    shipmentId: string,
  ): Promise<{ collectedMinor: number; currency: string; merchantId: string } | null> {
    return this.cod.transaction(async (manager) => {
      const record = await this.records.findByShipmentId(manager, shipmentId);
      if (!record || record.collectedMinor === null) return null;
      return {
        collectedMinor: Number(record.collectedMinor),
        currency: record.currency,
        merchantId: record.merchantId,
      };
    });
  }

  /**
   * Counts of the statuses currently standing between this merchant and a payout.
   *
   * A map rather than a single number because "blocked" is three different situations and an
   * operator needs to be told which: `RECONCILIATION_EXCEPTION` is a human decision waiting,
   * `SETTLEMENT_HOLD` is a deliberate hold, and `COD_EXPECTED` is simply not collected yet. One
   * flat "3 blocked" would send someone to review three things that need no review.
   *
   * Only blocking statuses come back. Counting all ten would hand every caller a `Map` it has to
   * filter, and each caller would filter it differently.
   */
  async reviewedMismatches(merchantId: string): Promise<string[]> {
    return this.cod.transaction(async (manager) =>
      this.records.reviewedMismatches(manager, merchantId),
    );
  }

  async blocksFor(merchantId: string): Promise<Map<string, number>> {
    return this.cod.transaction(async (manager) => {
      const counts = await this.records.countsByMerchant(manager, merchantId);
      const blocked = new Map<string, number>();
      for (const [status, count] of counts) {
        if (blocksSettlement(status as CodStatus) && count > 0) blocked.set(status, count);
      }
      return blocked;
    });
  }
}
