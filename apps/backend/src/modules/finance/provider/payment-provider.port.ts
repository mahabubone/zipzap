/**
 * PAYMENT_PROVIDER — the payout port. Mock by default, PayStation when configured.
 *
 * The binding lives here (not in FinanceModule) so environments differ in exactly
 * one variable: PAYMENT_PROVIDER=mock moves no money; PAYMENT_PROVIDER=paystation
 * talks to PAYSTATION_URL (the fake locally, the gateway in staging). Services
 * inject the symbol, never a class. See docs/architecture/provider-adapters.md.
 */

import { config } from '../../../config.ts';
import type { PaymentProvider } from '../rules/payment-provider.ts';
import { MockPaymentProvider } from './mock-payment.provider.ts';
import { PayStationAdapter } from './paystation.adapter.ts';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Selected by PAYMENT_PROVIDER. Mock default: no real money moves. */
export function defaultPaymentProvider(): PaymentProvider {
  const { paymentProvider, paystationUrl, paystationMerchantId, paystationPassword } = config();
  if (paymentProvider === 'paystation') {
    return new PayStationAdapter({
      baseUrl: paystationUrl,
      merchantId: paystationMerchantId,
      password: paystationPassword,
    });
  }
  return new MockPaymentProvider();
}
