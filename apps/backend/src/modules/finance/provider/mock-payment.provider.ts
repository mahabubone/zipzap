/**
 * MockPaymentProvider — the default payout rail in development.
 *
 * In-memory and deterministic: references are sequential (`MOCK000001`), so a test can
 * assert an exact value. `initiate` converges on invoice number — the same invoice twice
 * returns the same payment, mirroring the idempotency the real rail enforces with its
 * duplicate-invoice rejection, minus the error.
 *
 * Status is driven, not polled: `settle()` moves a payment to its terminal state, which
 * is the test's stand-in for the human clicking through the hosted checkout (or the IPN
 * arriving). Unknown references throw — a verify that invents a payment is the failure
 * this seam exists to prevent.
 *
 * No wire format here: this mock speaks the domain's own types. Provider vocabulary
 * translation belongs in the real adapter, when it arrives.
 */

import { money } from '../../../common/money.ts';
import type {
  Payment,
  PaymentProvider,
  PaymentRequest,
  PaymentStatus,
} from '../rules/payment-provider.ts';

export class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export class MockPaymentProvider implements PaymentProvider {
  private counter = 0;
  private readonly payments = new Map<string, Payment>();
  private readonly byInvoice = new Map<string, Payment>();

  async initiate(request: PaymentRequest): Promise<Payment> {
    const existing = this.byInvoice.get(request.invoiceNumber);
    if (existing) return existing;

    // Integer minor units in, integer minor units out — money() rejects a float loudly.
    const amount = money(request.amountMinor, request.currency);

    this.counter += 1;
    const payment: Payment = {
      reference: `MOCK${String(this.counter).padStart(6, '0')}`,
      invoiceNumber: request.invoiceNumber,
      amountMinor: amount.amountMinor,
      currency: amount.currency,
      status: 'processing',
    };
    this.payments.set(payment.reference, payment);
    this.byInvoice.set(request.invoiceNumber, payment);
    return payment;
  }

  async verify(reference: string): Promise<Payment> {
    const payment = this.payments.get(reference);
    if (!payment) {
      throw new PaymentProviderError(`Unknown payment reference ${reference}.`);
    }
    return payment;
  }

  /** Test control: drive a payment to its terminal state. Not part of the interface. */
  settle(
    reference: string,
    status: Extract<PaymentStatus, 'succeeded' | 'failed' | 'refunded'>,
  ): Payment {
    const payment = this.payments.get(reference);
    if (!payment) {
      throw new PaymentProviderError(`Unknown payment reference ${reference}.`);
    }
    const settled: Payment = { ...payment, status };
    this.payments.set(reference, settled);
    this.byInvoice.set(settled.invoiceNumber, settled);
    return settled;
  }

  reset(): void {
    this.counter = 0;
    this.payments.clear();
    this.byInvoice.clear();
  }
}
