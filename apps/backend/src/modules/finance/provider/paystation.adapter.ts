/**
 * PayStationAdapter — the real payout rail, behind the PaymentProvider port.
 *
 * ALL provider vocabulary lives in this file and dies in this file. The domain
 * speaks minor units and `succeeded`; PayStation speaks "1250.50" and "success".
 * Nothing outside this directory may contain `status_code`, `trx_status`,
 * `invoice_number`, or a decimal amount string. The boundary checker enforces it.
 *
 * Verified against the fake in infra/fakes (contract-verified 2026-10-02):
 *  - initiate: form POST, auth in body, in-band status_code, duplicate = 1008.
 *  - status: merchantId HEADER, invoice_number in form body, lowercase trx_status.
 *  - v2 status exists but is unused: keyed by trxId, and our idempotency anchor is
 *    the invoice. If v2 is ever needed, it goes through the same mapping below.
 *
 * Money conversion: minor units -> "1250.50" by integer division, never toFixed on
 * a float. The trip back (status query returns "1250.00") is parsed as a DECIMAL
 * STRING via parseMajor — never parseFloat — and asserted equal to the initiated
 * amount. A provider amount that disagrees is a contract breach, not a rounding.
 */

import { parseMajor } from '../../../common/money.ts';
import type {
  Payment,
  PaymentProvider,
  PaymentRequest,
  PaymentStatus,
} from '../rules/payment-provider.ts';
import { PaymentProviderError } from './mock-payment.provider.ts';

export interface PayStationConfig {
  readonly baseUrl: string;
  readonly merchantId: string;
  readonly password: string;
}

interface InitiateResponse {
  readonly status_code: string;
  readonly status: string;
  readonly message: string;
  readonly payment_url?: string;
  readonly invoice_number?: string;
  readonly payment_amount?: string;
}

interface StatusResponse {
  readonly status_code: string;
  readonly status: string;
  readonly message: string;
  readonly data?: {
    readonly invoice_number: string;
    readonly trx_status: string;
    readonly trx_id: string;
    readonly payment_amount: string;
    readonly payment_method: string;
  };
}

interface V2StatusResponse {
  readonly status_code: string;
  readonly status: string;
  readonly message: string;
  readonly data?: {
    readonly invoice_number: string;
    readonly trx_status: string;
    readonly trx_id: string;
    /** A JSON number on the wire. Never parsed as money — payment_amount is the source. */
    readonly trx_amount: number;
    readonly payment_amount: string;
    readonly payment_method: string;
  };
}

/** Lowercase status vocabulary, per their status-query section. Unknown values throw. */
const TRX_STATUS: Record<string, PaymentStatus> = {
  processing: 'processing',
  success: 'succeeded',
  failed: 'failed',
  refund: 'refunded',
};

export class PayStationAdapter implements PaymentProvider {
  constructor(private readonly config: PayStationConfig) {}

  async initiate(request: PaymentRequest): Promise<Payment> {
    const major = toMajorString(request.amountMinor);
    const form = new URLSearchParams({
      merchantId: this.config.merchantId,
      password: this.config.password,
      invoice_number: request.invoiceNumber,
      payment_amount: major,
      cust_name: request.beneficiary,
      cust_phone: '',
      cust_email: '',
      callback_url: '',
    });

    const response = await fetch(`${this.config.baseUrl}/paystation/initiate-payment`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      throw new PaymentProviderError(
        `PayStation initiate-payment HTTP ${response.status} for ${request.invoiceNumber}.`,
      );
    }
    const body = (await response.json()) as InitiateResponse;
    if (body.status_code !== '200') {
      throw new PaymentProviderError(
        `PayStation rejected ${request.invoiceNumber}: [${body.status_code}] ${body.message}`,
      );
    }

    const status = await this.statusOf(request.invoiceNumber);
    if (status.amountMinor !== request.amountMinor) {
      // The provider recorded a different amount than we sent. Settling against
      // their figure undercharges the merchant; settling against ours pays money
      // the provider never saw. Both lose money — throw, let a human decide.
      throw new PaymentProviderError(
        `PayStation amount mismatch for ${request.invoiceNumber}: ` +
          `sent ${request.amountMinor}, provider holds ${status.amountMinor}.`,
      );
    }
    return {
      reference: status.reference,
      invoiceNumber: request.invoiceNumber,
      amountMinor: request.amountMinor,
      currency: request.currency,
      status: status.status,
    };
  }

  async verify(reference: string): Promise<Payment> {
    // Keyed by trx id via the v2 endpoint: no local map, so a restart between
    // initiate and confirm loses nothing. The v2 body carries the invoice and the
    // amount back, so the returned payment is complete without stored state.
    // Note the wire asymmetry, reproduced by the fake: v2's trx_amount is a JSON
    // NUMBER (1250), while payment_amount is a STRING ("1250.00"). The number is
    // never parsed as money — the string is, via parseMajor.
    const response = await fetch(`${this.config.baseUrl}/paystation/v2/transaction-status`, {
      method: 'POST',
      headers: { merchantId: this.config.merchantId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trxId: reference }),
    });
    if (!response.ok) {
      throw new PaymentProviderError(
        `PayStation v2 transaction-status HTTP ${response.status} for ${reference}.`,
      );
    }
    const body = (await response.json()) as V2StatusResponse;
    if (body.status_code !== '200' || !body.data) {
      throw new PaymentProviderError(
        `PayStation verify failed for ${reference}: [${body.status_code}] ${body.message}`,
      );
    }

    const status = TRX_STATUS[body.data.trx_status];
    if (!status) {
      throw new PaymentProviderError(
        `PayStation returned unknown trx_status "${body.data.trx_status}" for ${reference}.`,
      );
    }

    const reported = parseMajor(body.data.payment_amount, 'BDT');
    return {
      reference: body.data.trx_id,
      invoiceNumber: body.data.invoice_number,
      amountMinor: reported.amountMinor,
      currency: 'BDT',
      status,
    };
  }

  private async statusOf(invoiceNumber: string): Promise<{
    reference: string;
    status: PaymentStatus;
    amountMinor: number;
    currency: 'BDT';
  }> {
    const form = new URLSearchParams({ invoice_number: invoiceNumber });
    const response = await fetch(`${this.config.baseUrl}/paystation/transaction-status`, {
      method: 'POST',
      headers: { merchantId: this.config.merchantId },
      body: form,
    });
    if (!response.ok) {
      throw new PaymentProviderError(
        `PayStation transaction-status HTTP ${response.status} for ${invoiceNumber}.`,
      );
    }
    const body = (await response.json()) as StatusResponse;
    if (body.status_code !== '200' || !body.data) {
      throw new PaymentProviderError(
        `PayStation status query failed for ${invoiceNumber}: [${body.status_code}] ${body.message}`,
      );
    }

    const status = TRX_STATUS[body.data.trx_status];
    if (!status) {
      // Unknown provider status maps to nothing: mapping it to failed underpays the
      // merchant, mapping it to processing blocks settlement. Throw, let a human decide.
      throw new PaymentProviderError(
        `PayStation returned unknown trx_status "${body.data.trx_status}" for ${invoiceNumber}.`,
      );
    }

    // Parse as decimal string — never parseFloat. The caller asserts it matches.
    const reported = parseMajor(body.data.payment_amount, 'BDT');
    return {
      reference: body.data.trx_id,
      status,
      amountMinor: reported.amountMinor,
      currency: 'BDT',
    };
  }
}

/** Integer minor units -> "1250.50". Division and remainder only — never a float. */
function toMajorString(amountMinor: number): string {
  if (!Number.isInteger(amountMinor)) {
    throw new PaymentProviderError(
      `Refusing to send non-integer minor units ${amountMinor} to the provider.`,
    );
  }
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}
