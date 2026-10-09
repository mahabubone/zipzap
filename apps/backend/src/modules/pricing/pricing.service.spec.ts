import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { PricingService } from './pricing.service.ts';
import { PricingRepository } from './pricing.repository.ts';
import { PricingVersionNotFoundError } from '../../common/domain-error.ts';
import { MERCHANT_PLAN_LOOKUP } from '../merchant/merchant-plan.lookup.ts';

/**
 * The service seams: version selection, mapping, and the not-found contract.
 * Arithmetic itself belongs to rules/pricing.spec.ts — this file asserts which version is
 * chosen and what happens when none exists.
 */

const ROW = {
  version: 3,
  baseFeeMinor: 6000,
  perKgMinor: 2000,
  codFeeBps: 180,
  remoteAreaFeeMinor: 4000,
  fragileFeeMinor: 1500,
  packagingFeesMinor: { box_s: 800 },
  taxBps: 500,
  planDiscountBps: { standard: 0 },
  currency: 'BDT',
};

/**
 * No `merchantPlan` here any more, and that is the point.
 *
 * It used to be a request field, so a caller could name the plan with the best discount and be
 * quoted it — the server had no idea which plan the merchant was actually on. The plan is now
 * resolved from `merchant.merchants` through `MERCHANT_PLAN_LOOKUP`, and `INPUT` carries a
 * `merchantId` because that is the only thing that identifies whose rates apply.
 */
const INPUT = {
  weightGrams: 1200,
  codAmountMinor: 125_050,
  zone: 'dhaka-metro',
  remoteArea: false,
  fragile: false,
  packagingKind: null,
  merchantId: '11111111-1111-4111-8111-111111111111',
};

describe('PricingService', () => {
  let versions: { findActive: ReturnType<typeof vi.fn>; findByVersion: ReturnType<typeof vi.fn> };
  let plans: { planFor: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    versions = { findActive: vi.fn(), findByVersion: vi.fn() };
    plans = { planFor: vi.fn() };
    // Default to the discount-free plan. Tests that care override it explicitly.
    plans.planFor.mockResolvedValue('standard');
  });

  async function service(): Promise<PricingService> {
    // Direct construction with a pass-through transaction: the repository is mocked, so the
    // "transaction" is just a call boundary. Real atomicity needs no proof here — quoting is
    // read-only, and the engine itself is asserted pure in rules/pricing.spec.ts.
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn({}) };
    return new PricingService(fakeDs as never, versions as never, plans as never);
  }

  it('resolves through the real Nest container', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: PricingRepository, useValue: versions },
        { provide: MERCHANT_PLAN_LOOKUP, useValue: plans },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    expect(module.get(PricingService)).toBeDefined();
  });

  it('quotes against the active version when none is pinned', async () => {
    versions.findActive.mockResolvedValue(ROW);
    const svc = await service();
    const result = await svc.quote(INPUT as never);
    expect(result.version).toBe(3);
    expect(result.total.amountMinor).toBeGreaterThan(0);
    expect(versions.findByVersion).not.toHaveBeenCalled();
  });

  it('quotes against the pinned version when one is given', async () => {
    versions.findByVersion.mockResolvedValue({ ...ROW, version: 2, baseFeeMinor: 4000 });
    const svc = await service();
    const result = await svc.quote({ ...(INPUT as object), version: 2 } as never);
    expect(result.version).toBe(2);
    expect(versions.findActive).not.toHaveBeenCalled();
  });

  it('throws a mapped 409 when the pinned version does not exist', async () => {
    versions.findByVersion.mockResolvedValue(null);
    const svc = await service();
    await expect(svc.quote({ ...(INPUT as object), version: 99 } as never)).rejects.toThrow(
      PricingVersionNotFoundError,
    );
  });

  it('throws the same mapped error when no version is active', async () => {
    versions.findActive.mockResolvedValue(null);
    const svc = await service();
    await expect(svc.quote(INPUT as never)).rejects.toThrow(PricingVersionNotFoundError);
  });
});
