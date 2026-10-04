/**
 * PaymentProvider — the domain-owned payout seam. Framework-free: no @nestjs, no typeorm.
 *
 * ZipZap is not a payment processor. Providers sit behind this interface; implementations
 * live in `finance/provider/` and import nothing from the domain. The domain does not
 * know which provider exists. See docs/architecture/provider-adapters.md.
 *
 * Money crosses this boundary only as integer minor units plus currency. A provider that
 * speaks decimal major units ("1250.50") is translated inside the adapter, never here —
 * and never with parseFloat (docs/ADR/0009).
 */

import type { Currency } from '../../../common/money.ts';

export type PaymentStatus = 'processing' | 'succeeded' | 'failed' | 'refunded';

export interface PaymentRequest {
  /** Our idempotency anchor: one settlement, one invoice. Retried initiations converge. */
  readonly invoiceNumber: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  /** The merchant being paid. The provider never learns our internal merchant id shape. */
  readonly beneficiary: string;
}

export interface Payment {
  readonly reference: string;
  readonly invoiceNumber: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly status: PaymentStatus;
}

export interface PaymentProvider {
  initiate(request: PaymentRequest): Promise<Payment>;
  verify(reference: string): Promise<Payment>;
}
