/**
 * PAYMENT_PROVIDER — the payout port. Mock by default, real rail later.
 *
 * The binding lives here (not in FinanceModule) so environments differ in exactly
 * one import: development binds MockPaymentProvider, staging binds the real
 * PayStation adapter behind the same symbol. Nothing else changes — services inject
 * the symbol, never a class. See docs/architecture/provider-adapters.md.
 */

import type { PaymentProvider } from '../rules/payment-provider.ts';
import { MockPaymentProvider } from './mock-payment.provider.ts';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Development default: no real money moves. Swap in staging/prod. */
export function defaultPaymentProvider(): PaymentProvider {
  return new MockPaymentProvider();
}
