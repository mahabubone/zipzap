/**
 * Quote engine. Framework-free and deterministic by construction.
 *
 * Determinism here means something specific and testable: `quote(inputs, version)` is a pure
 * function. No clock, no randomness, no network calls, no reading "current" anything. The only
 * inputs are the shipment facts and the frozen rule version they are quoted against.
 *
 * That purity is what makes a months-old price dispute answerable: re-run the engine with the
 * stored version and you get the identical number, or the engine has a bug. There is no third
 * possibility, because there is no hidden input.
 *
 * All amounts are integer minor units. Addition only — percentage handling is the caller's
 * explicit basis-point math, never a float inside the engine.
 */

import { add, money, type Currency, type Money } from '../../../common/money.ts';

export type QuoteLineKind =
  'BASE' | 'WEIGHT' | 'COD_FEE' | 'REMOTE_AREA' | 'HANDLING' | 'PACKAGING' | 'TAX' | 'DISCOUNT';

export interface QuoteLine {
  readonly kind: QuoteLineKind;
  readonly label: string;
  readonly amount: Money;
}

export interface QuoteInput {
  readonly weightGrams: number;
  readonly codAmountMinor: number;
  readonly zone: string;
  readonly remoteArea: boolean;
  readonly fragile: boolean;
  readonly packagingKind: string | null;
  readonly merchantPlan: string;
  readonly currency?: Currency;
}

export interface PricingVersion {
  readonly version: number;
  readonly baseFeeMinor: number;
  readonly perKgMinor: number;
  readonly codFeeBps: number;
  readonly remoteAreaFeeMinor: number;
  readonly fragileFeeMinor: number;
  readonly packagingFeesMinor: Readonly<Record<string, number>>;
  readonly taxBps: number;
  readonly planDiscountBps: Readonly<Record<string, number>>;
  readonly currency: Currency;
}

/** Basis points to minor units. Integer in, integer out — truncation is explicit, never hidden. */
function ofBasisPoints(baseMinor: number, bps: number): number {
  return Math.floor((baseMinor * bps) / 10_000);
}

export interface Quote {
  readonly version: number;
  readonly currency: Currency;
  readonly lines: readonly QuoteLine[];
  readonly total: Money;
}

export function quote(input: QuoteInput, rules: PricingVersion): Quote {
  const currency: Currency = input.currency ?? rules.currency;
  const lines: QuoteLine[] = [];
  const line = (kind: QuoteLineKind, label: string, amountMinor: number): void => {
    lines.push({ kind, label, amount: money(amountMinor, currency) });
  };

  line('BASE', 'Base delivery fee', rules.baseFeeMinor);

  const billableKg = Math.max(1, Math.ceil(input.weightGrams / 1000));
  line('WEIGHT', `Weight surcharge (${billableKg} kg)`, billableKg * rules.perKgMinor);

  if (input.codAmountMinor > 0) {
    line(
      'COD_FEE',
      'Cash-on-delivery handling',
      ofBasisPoints(input.codAmountMinor, rules.codFeeBps),
    );
  }

  if (input.remoteArea) {
    line('REMOTE_AREA', `Remote area (${input.zone})`, rules.remoteAreaFeeMinor);
  }

  if (input.fragile) {
    line('HANDLING', 'Fragile handling', rules.fragileFeeMinor);
  }

  if (input.packagingKind !== null) {
    const fee = rules.packagingFeesMinor[input.packagingKind] ?? 0;
    line('PACKAGING', `Packaging (${input.packagingKind})`, fee);
  }

  const discountBps = rules.planDiscountBps[input.merchantPlan] ?? 0;
  if (discountBps > 0) {
    line(
      'DISCOUNT',
      `Plan discount (${input.merchantPlan})`,
      -ofBasisPoints(subtotalOf(lines), discountBps),
    );
  }

  line('TAX', 'VAT', ofBasisPoints(subtotalOf(lines), rules.taxBps));

  const total = lines.reduce((sum, current) => add(sum, current.amount), money(0, currency));

  return { version: rules.version, currency, lines, total };
}

function subtotalOf(lines: readonly QuoteLine[]): number {
  return lines.reduce((sum, line) => sum + line.amount.amountMinor, 0);
}

/**
 * Resolution order: default → merchant profile → volume → custom contract.
 * Most specific wins per component, so a contract overrides one line without redefining the rest.
 * The version number itself is never overridable: a quote is always computed against exactly one
 * named version, or the version-freeze guarantee is meaningless.
 */
/** One resolution layer. Mutable records, because layers are merged, never frozen. */
export interface PricingOverride {
  baseFeeMinor?: number;
  perKgMinor?: number;
  codFeeBps?: number;
  remoteAreaFeeMinor?: number;
  fragileFeeMinor?: number;
  packagingFeesMinor?: Record<string, number>;
  taxBps?: number;
  planDiscountBps?: Record<string, number>;
  currency?: Currency;
}

export function resolveVersion(
  base: PricingVersion,
  overrides: ReadonlyArray<PricingOverride>,
): PricingVersion {
  // Fresh object per layer: fields are readonly by design, so merging allocates rather than
  // mutating. `version` is pinned to base — it is never part of an override.
  let merged: PricingVersion = base;
  for (const override of overrides) {
    merged = {
      version: base.version,
      baseFeeMinor: override.baseFeeMinor ?? merged.baseFeeMinor,
      perKgMinor: override.perKgMinor ?? merged.perKgMinor,
      codFeeBps: override.codFeeBps ?? merged.codFeeBps,
      remoteAreaFeeMinor: override.remoteAreaFeeMinor ?? merged.remoteAreaFeeMinor,
      fragileFeeMinor: override.fragileFeeMinor ?? merged.fragileFeeMinor,
      packagingFeesMinor: { ...merged.packagingFeesMinor, ...(override.packagingFeesMinor ?? {}) },
      taxBps: override.taxBps ?? merged.taxBps,
      planDiscountBps: { ...merged.planDiscountBps, ...(override.planDiscountBps ?? {}) },
      currency: override.currency ?? merged.currency,
    };
  }
  return merged;
}
