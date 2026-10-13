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
import type { DataSource, EntityManager } from 'typeorm';
import { PricingVersionNotFoundError } from '../../common/domain-error.ts';
import { MERCHANT_PLAN_LOOKUP } from '../merchant/merchant-plan.lookup.ts';
import {
  quote,
  resolveVersion,
  type PricingOverride,
  type PricingVersion,
  type Quote,
  type QuoteInput,
} from './rules/pricing.ts';
import { PricingRepository } from './pricing.repository.ts';
import type { Currency } from '../../common/money.ts';

/** The persisted version row, as `PricingRepository` returns it. */
type PricingRow = Awaited<ReturnType<PricingRepository['findActive']>> & {};

export interface QuoteRequest extends Omit<QuoteInput, 'merchantPlan'> {
  /** Explicit version pins the quote. Absent means the active version. */
  readonly version?: number;
  /** Layered overrides: merchant profile, volume, contract. Most specific wins. */
  readonly overrides?: ReadonlyArray<PricingOverride>;
  /**
   * Whose plan applies. Resolved from the merchant record, never from the request — this is the
   * whole reason `merchantPlan` is gone from `QuoteInput` here. See `merchant-plan.lookup.ts`.
   */
  readonly merchantId: string;
}

/** The rate card, as a merchant reads it. See `rateCard()`. */
export interface RateCard {
  readonly version: number;
  readonly currency: Currency;
  /** The plan THIS merchant is on. Not a list of plans — theirs. */
  readonly plan: string;
  readonly baseFeeMinor: number;
  readonly perKgMinor: number;
  readonly codFeeBps: number;
  readonly remoteAreaFeeMinor: number;
  readonly fragileFeeMinor: number;
  readonly packagingFeesMinor: Readonly<Record<string, number>>;
  readonly taxBps: number;
  /** Their discount in basis points. Zero is a real answer and is stated rather than omitted. */
  readonly planDiscountBps: number;
  /** Worked examples, so the card can be read without holding a parcel in the hand. */
  readonly examples: ReadonlyArray<RateCardExample>;
}

/** One "for a 1 kg parcel inside Dhaka, you pay X" line. */
export interface RateCardExample {
  readonly label: string;
  readonly totalMinor: number;
}

@Injectable()
export class PricingService {
  constructor(
    @InjectDataSource('pricing') private readonly pricingDataSource: DataSource,
    @Inject(PricingRepository) private readonly versions: PricingRepository,
    @Inject(MERCHANT_PLAN_LOOKUP) private readonly plans: { planFor(id: string): Promise<string> },
  ) {}

  async quote(request: QuoteRequest): Promise<Quote> {
    // Read the plan OUTSIDE the pricing transaction, for the same reason the settlement freeze
    // reads its blockers outside its own: `merchant` is another module's schema on another
    // connection, and a lookup that can fail should not be holding a pricing transaction open.
    const merchantPlan = await this.plans.planFor(request.merchantId);

    return this.pricingDataSource.transaction(async (manager) => {
      const base = await this.resolveBase(manager, request.version);

      const resolved = resolveVersion(toRules(base), request.overrides ?? []);
      return quote(
        {
          weightGrams: request.weightGrams,
          codAmountMinor: request.codAmountMinor,
          zone: request.zone,
          remoteArea: request.remoteArea,
          fragile: request.fragile,
          packagingKind: request.packagingKind,
          merchantPlan,
          currency: request.currency ?? base.currency,
        },
        resolved,
      );
    });
  }

  /**
   * The rate card a merchant can read without calling anyone.
   *
   * The plan's exit check, and the reason this exists at all: the only pricing read before it was
   * `POST /quote`, which needs eight shipment facts and an API key. That answers "what would this
   * parcel cost" and not "what do you charge me", and a merchant site cannot hold a key at all.
   *
   * Returns the card **plus worked examples**, because a table of coefficients is not readable by
   * a human: 2000 minor units per kg is a rule, "৳95 for a 1 kg parcel inside Dhaka" is a price.
   * The examples run through `quote()` itself rather than being computed separately, so they cannot
   * drift from what a real quote produces.
   */
  async rateCard(merchantId: string): Promise<RateCard> {
    const merchantPlan = await this.plans.planFor(merchantId);

    return this.pricingDataSource.transaction(async (manager) => {
      const base = await this.resolveBase(manager, undefined);
      const rules = toRules(base);

      const examples: RateCardExample[] = [];
      const example = (
        label: string,
        input: Omit<QuoteInput, 'merchantPlan' | 'currency'>,
      ): void => {
        const priced = quote({ ...input, merchantPlan, currency: base.currency }, rules);
        examples.push({ label, totalMinor: priced.total.amountMinor });
      };

      example('1 kg parcel, inside Dhaka, no COD', {
        weightGrams: 1000,
        codAmountMinor: 0,
        zone: 'dhaka-metro',
        remoteArea: false,
        fragile: false,
        packagingKind: null,
      });
      example('1 kg parcel with ৳1,000 cash to collect', {
        weightGrams: 1000,
        codAmountMinor: 100_000,
        zone: 'dhaka-metro',
        remoteArea: false,
        fragile: false,
        packagingKind: null,
      });
      example('5 kg parcel, outside Dhaka', {
        weightGrams: 5000,
        codAmountMinor: 0,
        zone: 'chattogram-metro',
        remoteArea: true,
        fragile: false,
        packagingKind: null,
      });
      example('1 kg fragile parcel', {
        weightGrams: 1000,
        codAmountMinor: 0,
        zone: 'dhaka-metro',
        remoteArea: false,
        fragile: true,
        packagingKind: null,
      });

      return {
        version: base.version,
        currency: base.currency,
        plan: merchantPlan,
        baseFeeMinor: rules.baseFeeMinor,
        perKgMinor: rules.perKgMinor,
        codFeeBps: rules.codFeeBps,
        remoteAreaFeeMinor: rules.remoteAreaFeeMinor,
        fragileFeeMinor: rules.fragileFeeMinor,
        packagingFeesMinor: rules.packagingFeesMinor,
        taxBps: rules.taxBps,
        // Stated as zero rather than omitted: "no discount" and "we did not tell you" are
        // different messages and a merchant should never have to ask which one they got.
        planDiscountBps: rules.planDiscountBps[merchantPlan] ?? 0,
        examples,
      };
    });
  }

  /**
   * The version this request prices against, or a 404.
   *
   * Both `quote` and `rateCard` went through their own copy of this and it is now one place, so
   * "which version applies" cannot be answered two different ways.
   */
  private async resolveBase(
    manager: EntityManager,
    version: number | undefined,
  ): Promise<PricingRow> {
    const base =
      version !== undefined
        ? await this.versions.findByVersion(manager, version)
        : await this.versions.findActive(manager);

    if (!base) {
      throw new PricingVersionNotFoundError(version ?? null);
    }
    return base;
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
