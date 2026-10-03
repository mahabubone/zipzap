/**
 * QuoteService — the pricing boundary.
 *
 * Other modules never read pricing tables. They call this: inputs in, an itemised quote out,
 * always against exactly one named version. What the shipment stores is the version number —
 * the dispute evidence — not the computed total.
 *
 * The service is intentionally thin: all arithmetic lives in rules/pricing.ts, where it is pure
 * and exhaustively testable. This layer only resolves which version applies and maps rows.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { PricingVersionNotFoundError } from '../../common/domain-error.ts';
import {
  quote,
  resolveVersion,
  type PricingOverride,
  type PricingVersion,
  type Quote,
  type QuoteInput,
} from './rules/pricing.ts';
import { PricingRepository } from './pricing.repository.ts';

export interface QuoteRequest extends QuoteInput {
  /** Explicit version pins the quote. Absent means the active version. */
  readonly version?: number;
  /** Layered overrides: merchant profile, volume, contract. Most specific wins. */
  readonly overrides?: ReadonlyArray<PricingOverride>;
}

@Injectable()
export class PricingService {
  constructor(
    @InjectDataSource('pricing') private readonly pricingDataSource: DataSource,
    @Inject(PricingRepository) private readonly versions: PricingRepository,
  ) {}

  async quote(request: QuoteRequest): Promise<Quote> {
    return this.pricingDataSource.transaction(async (manager) => {
      const base =
        request.version !== undefined
          ? await this.versions.findByVersion(manager, request.version)
          : await this.versions.findActive(manager);

      if (!base) {
        throw new PricingVersionNotFoundError(request.version ?? null);
      }

      const resolved = resolveVersion(toRules(base), request.overrides ?? []);
      return quote(
        {
          weightGrams: request.weightGrams,
          codAmountMinor: request.codAmountMinor,
          zone: request.zone,
          remoteArea: request.remoteArea,
          fragile: request.fragile,
          packagingKind: request.packagingKind,
          merchantPlan: request.merchantPlan,
          currency: request.currency ?? base.currency,
        },
        resolved,
      );
    });
  }
}

/** Row shape to rules shape. The only direction this conversion ever flows. */
function toRules(row: {
  version: number;
  baseFeeMinor: number;
  perKgMinor: number;
  codFeeBps: number;
  remoteAreaFeeMinor: number;
  fragileFeeMinor: number;
  packagingFeesMinor: Record<string, number>;
  taxBps: number;
  planDiscountBps: Record<string, number>;
  currency: PricingVersion['currency'];
}): PricingVersion {
  return {
    version: row.version,
    baseFeeMinor: Number(row.baseFeeMinor),
    perKgMinor: Number(row.perKgMinor),
    codFeeBps: row.codFeeBps,
    remoteAreaFeeMinor: Number(row.remoteAreaFeeMinor),
    fragileFeeMinor: Number(row.fragileFeeMinor),
    packagingFeesMinor: row.packagingFeesMinor,
    taxBps: row.taxBps,
    planDiscountBps: row.planDiscountBps,
    currency: row.currency,
  };
}
