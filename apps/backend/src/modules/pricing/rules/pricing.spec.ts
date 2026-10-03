import { describe, expect, it } from 'vitest';
import { quote, resolveVersion, type PricingVersion, type QuoteInput } from './pricing.ts';

const BASE: PricingVersion = {
  version: 3,
  baseFeeMinor: 6000,
  perKgMinor: 2000,
  codFeeBps: 180,
  remoteAreaFeeMinor: 4000,
  fragileFeeMinor: 1500,
  packagingFeesMinor: { box_s: 800, box_m: 1500 },
  taxBps: 500,
  planDiscountBps: { standard: 0, growth: 1000 },
  currency: 'BDT',
};

const INPUT: QuoteInput = {
  weightGrams: 1200,
  codAmountMinor: 125_050,
  zone: 'dhaka-metro',
  remoteArea: false,
  fragile: false,
  packagingKind: null,
  merchantPlan: 'standard',
};

describe('quote engine', () => {
  it('is deterministic: same inputs, same version, same quote — always', () => {
    const first = quote(INPUT, BASE);
    const second = quote({ ...INPUT }, BASE);
    expect(second).toEqual(first);
    expect(first.total.amountMinor).toBeGreaterThan(0);
  });

  it('itemises every line and sums to the total exactly, no lost poisha', () => {
    const result = quote(
      { ...INPUT, remoteArea: true, fragile: true, packagingKind: 'box_m' },
      BASE,
    );
    const kinds = result.lines.map((line) => line.kind);
    expect(kinds).toEqual([
      'BASE',
      'WEIGHT',
      'COD_FEE',
      'REMOTE_AREA',
      'HANDLING',
      'PACKAGING',
      'TAX',
    ]);
    const sum = result.lines.reduce((total, line) => total + line.amount.amountMinor, 0);
    expect(result.total.amountMinor).toBe(sum);
    expect(Number.isInteger(result.total.amountMinor)).toBe(true);
  });

  it('bills weight by ceiling kilogram with a one-kilo minimum', () => {
    const light = quote({ ...INPUT, weightGrams: 200, codAmountMinor: 0 }, BASE);
    const heavy = quote({ ...INPUT, weightGrams: 1201, codAmountMinor: 0 }, BASE);
    const weightLine = (q: ReturnType<typeof quote>) =>
      q.lines.find((l) => l.kind === 'WEIGHT')!.amount.amountMinor;
    expect(weightLine(light)).toBe(BASE.perKgMinor);
    expect(weightLine(heavy)).toBe(2 * BASE.perKgMinor);
  });

  it('omits COD_FEE entirely when there is no COD', () => {
    const result = quote({ ...INPUT, codAmountMinor: 0 }, BASE);
    expect(result.lines.some((l) => l.kind === 'COD_FEE')).toBe(false);
  });

  it('applies plan discounts as negative lines before tax, never after', () => {
    const result = quote({ ...INPUT, merchantPlan: 'growth' }, BASE);
    const discount = result.lines.find((l) => l.kind === 'DISCOUNT')!;
    expect(discount.amount.amountMinor).toBeLessThan(0);
    const taxIndex = result.lines.findIndex((l) => l.kind === 'TAX');
    const discountIndex = result.lines.findIndex((l) => l.kind === 'DISCOUNT');
    expect(discountIndex).toBeLessThan(taxIndex);
  });

  it('carries the version it was computed against', () => {
    expect(quote(INPUT, BASE).version).toBe(3);
  });
});

describe('version resolution', () => {
  it('layers overrides most-specific-wins without touching version', () => {
    const resolved = resolveVersion(BASE, [
      { baseFeeMinor: 5000 },
      { baseFeeMinor: 4500, taxBps: 0 },
    ]);
    expect(resolved.version).toBe(3);
    expect(resolved.baseFeeMinor).toBe(4500);
    expect(resolved.taxBps).toBe(0);
    expect(resolved.perKgMinor).toBe(BASE.perKgMinor);
  });

  it('merges fee maps key-wise so a contract overrides one line, not the table', () => {
    const resolved = resolveVersion(BASE, [{ packagingFeesMinor: { box_s: 500 } }]);
    expect(resolved.packagingFeesMinor.box_s).toBe(500);
    expect(resolved.packagingFeesMinor.box_m).toBe(1500);
  });

  it('resolves the same layers to the same version, always', () => {
    const layers = [{ baseFeeMinor: 5000 }, { taxBps: 0 }];
    expect(resolveVersion(BASE, layers)).toEqual(resolveVersion(BASE, [...layers]));
  });
});
