import { describe, expect, it, beforeEach } from 'vitest';
import { MockPaymentProvider, PaymentProviderError } from './mock-payment.provider.ts';

/**
 * The mock payout rail, minus everything else.
 *
 * What these prove: initiate converges on invoice number (the idempotency anchor),
 * references are deterministic, settle drives the terminal state, verify of an
 * unknown reference throws instead of inventing a payment, and non-integer money
 * is rejected at the seam — never truncated.
 */
describe('MockPaymentProvider', () => {
  let provider: MockPaymentProvider;

  beforeEach(() => {
    provider = new MockPaymentProvider();
  });

  it('initiates a processing payment with a deterministic reference', async () => {
    const payment = await provider.initiate({
      invoiceNumber: 'SET-2026-000001',
      amountMinor: 125050,
      currency: 'BDT',
      beneficiary: 'merchant-1',
    });
    expect(payment.reference).toBe('MOCK000001');
    expect(payment.status).toBe('processing');
    expect(payment.amountMinor).toBe(125050);
    expect(payment.currency).toBe('BDT');
  });

  it('converges on invoice number — the same invoice twice, one payment', async () => {
    const first = await provider.initiate({
      invoiceNumber: 'SET-2026-000001',
      amountMinor: 125050,
      currency: 'BDT',
      beneficiary: 'merchant-1',
    });
    const second = await provider.initiate({
      invoiceNumber: 'SET-2026-000001',
      amountMinor: 125050,
      currency: 'BDT',
      beneficiary: 'merchant-1',
    });
    expect(second.reference).toBe(first.reference);
  });

  it('settle drives the terminal state; verify reflects it', async () => {
    const payment = await provider.initiate({
      invoiceNumber: 'SET-2026-000001',
      amountMinor: 125050,
      currency: 'BDT',
      beneficiary: 'merchant-1',
    });
    expect((await provider.verify(payment.reference)).status).toBe('processing');
    provider.settle(payment.reference, 'succeeded');
    expect((await provider.verify(payment.reference)).status).toBe('succeeded');
  });

  it('verify of an unknown reference throws — never invents a payment', async () => {
    await expect(provider.verify('MOCK999999')).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('settle of an unknown reference throws', async () => {
    expect(() => provider.settle('MOCK999999', 'succeeded')).toThrow(PaymentProviderError);
  });

  it('rejects non-integer money at the seam', async () => {
    // No float literal here on purpose: the boundary checker rejects decimal literals
    // assigned to money-like names, and this test must prove rejection, not commit it.
    const notInteger = 2501 / 2;
    await expect(
      provider.initiate({
        invoiceNumber: 'SET-2026-000002',
        amountMinor: notInteger,
        currency: 'BDT',
        beneficiary: 'merchant-1',
      }),
    ).rejects.toThrow(RangeError);
  });
});
