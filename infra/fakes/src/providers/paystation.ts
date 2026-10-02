/**
 * PayStation fake.
 *
 * Reproduced from https://paystation.com.bd/documentation (retrieved 2026-10-02).
 * Field names, error codes and response shapes are theirs; the sandbox credentials below
 * are the ones published in that document. Where their docs are ambiguous, the ambiguity is
 * reproduced deliberately and marked.
 *
 * Documented contract:
 *   POST /initiate-payment            form body: merchantId, password, invoice_number,
 *                                     payment_amount, cust_name/phone/email, callback_url
 *                                     -> { status_code, status, message, payment_url }
 *   POST /transaction-status          header: merchantId · body: invoice_number
 *   POST /v2/transaction-status       header: merchantId · JSON body: { trxId }
 *   POST {merchant ipn url}           flat JSON, success-only, retried on non-2xx
 *
 * In-band status codes: "200" ok · "1008" duplicate invoice · "2001" invalid token/not found.
 */

import type { Hono } from 'hono';
import { record, type ProviderName } from '../recorder.ts';
import { take, type TrxStatus } from '../script.ts';

export const PROVIDER: ProviderName = 'paystation';

/** Published in their docs. Not a secret, and not ours to rotate. */
export const SANDBOX_MERCHANT_ID = '104-1653730183';
export const SANDBOX_PASSWORD = 'gamecoderstorepass';

export interface Transaction {
  invoiceNumber: string;
  trxId: string;
  amountMinor: number;
  status: TrxStatus;
  paymentMethod: string;
  payerMobileNo: string;
  reference?: string;
  checkoutItems?: string;
  createdAt: Date;
  /** Where the IPN goes. The real gateway stores this per merchant; here it is per transaction. */
  ipnUrl?: string;
  custEmail?: string;
}

const transactions = new Map<string, Transaction>();
const byTrxId = new Map<string, Transaction>();

/** Sequential and seeded, so a test can assert an exact trx id. */
let trxCounter = 0;
function nextTrxId(): string {
  trxCounter += 1;
  return `FAKE${String(trxCounter).padStart(6, '0')}`;
}

export function reset(): void {
  transactions.clear();
  byTrxId.clear();
  trxCounter = 0;
}

export function allTransactions(): readonly Transaction[] {
  return [...transactions.values()];
}

export function find(invoiceNumber: string): Transaction | undefined {
  return transactions.get(invoiceNumber);
}

/** Drive a transaction from a test or the control API. Returns undefined if unknown. */
export function setStatus(
  invoiceNumber: string,
  status: TrxStatus,
  paymentMethod = 'bKash',
): Transaction | undefined {
  const transaction = transactions.get(invoiceNumber);
  if (!transaction) return undefined;
  transaction.status = status;
  transaction.paymentMethod = paymentMethod;
  return transaction;
}

/**
 * Their docs state `trx_status` values as lowercase (`success`, `failed`, `processing`,
 * `refund`) but their own sample JSON shows `"Success"`. The status queries return lowercase;
 * the IPN body returns `"Success"`, which their IPN section pins explicitly. Reproduced
 * literally, because a receiver that lowercases one and not the other is the bug we are here
 * to find.
 */
const IPN_STATUS_WORD: Record<TrxStatus, string> = {
  processing: 'Processing',
  success: 'Success',
  failed: 'Failed',
  refund: 'Refund',
};

function formatDateTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** `Y-m-d H:i:s`, as their docs specify for order_date_time. */
function ipnDateTime(date: Date): string {
  return formatDateTime(date).replace(' ', ' ');
}

function majorAmount(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

function authorize(merchantId: string | undefined, password?: string): boolean {
  if (merchantId !== SANDBOX_MERCHANT_ID) return false;
  // merchantId travels in a header for the status endpoints, where there is no password.
  return password === undefined || password === SANDBOX_PASSWORD;
}

/** Plain object of request headers, so a test can assert what was actually sent. */
function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function tokenFor(invoiceNumber: string): string {
  return Buffer.from(`${invoiceNumber}:${SANDBOX_MERCHANT_ID}`).toString('base64url').slice(0, 24);
}

export function register(app: Hono, baseUrl: () => string): void {
  // --- POST /initiate-payment -------------------------------------------------------
  app.post('/paystation/initiate-payment', async (c) => {
    const rawBody = await c.req.text();
    const form = Object.fromEntries(new URLSearchParams(rawBody));
    record({
      provider: PROVIDER,
      operation: 'initiate-payment',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body: form,
      rawBody,
    });

    const scripted = take(PROVIDER, 'initiate-payment', form);
    if (scripted?.kind === 'httpError')
      return c.json({ message: scripted.message }, scripted.status as 400);
    if (scripted?.kind === 'reject') {
      // Their errors are in-band: HTTP 200 carrying a bad status_code. Reproduced literally.
      return c.json({
        status_code: scripted.statusCode,
        status: 'failed',
        message: scripted.message,
      });
    }

    if (!authorize(form.merchantId, form.password)) {
      return c.json({ status_code: '2001', status: 'failed', message: 'Invalid Token.' });
    }

    const invoiceNumber = form.invoice_number ?? '';
    if (!invoiceNumber) {
      return c.json({
        status_code: '2001',
        status: 'failed',
        message: 'invoice_number is required.',
      });
    }
    if (transactions.has(invoiceNumber)) {
      // Documented as status_code 1008 — an in-band error, not an HTTP status.
      return c.json({
        status_code: '1008',
        status: 'failed',
        message: 'Duplicate invoice number.',
      });
    }

    const amountMinor = Number.parseInt(form.payment_amount ?? '0', 10) * 100;
    const trxId = nextTrxId();
    const transaction: Transaction = {
      invoiceNumber,
      trxId,
      amountMinor,
      status: 'processing',
      paymentMethod: '',
      payerMobileNo: form.cust_phone ?? '',
      reference: form.reference,
      checkoutItems: form.checkout_items,
      createdAt: new Date(),
      // The real IPN URL is configured per merchant out-of-band. Accepting a header keeps
      // that shape while letting a test point delivery at an arbitrary receiver.
      ipnUrl: c.req.header('x-zipzap-ipn-url') ?? undefined,
      custEmail: form.cust_email,
    };
    transactions.set(invoiceNumber, transaction);
    byTrxId.set(trxId, transaction);

    return c.json({
      status_code: '200',
      status: 'success',
      message: 'Payment Link Created Successfully.',
      payment_amount: form.payment_amount ?? '0',
      invoice_number: invoiceNumber,
      payment_url: `${baseUrl()}/paystation/checkout/${trxId}/${tokenFor(invoiceNumber)}`,
    });
  });

  // --- POST /transaction-status (v1) -----------------------------------------------
  app.post('/paystation/transaction-status', async (c) => {
    const rawBody = await c.req.text();
    const form = Object.fromEntries(new URLSearchParams(rawBody));
    record({
      provider: PROVIDER,
      operation: 'transaction-status',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body: form,
      rawBody,
    });

    const scripted = take(PROVIDER, 'transaction-status', form);
    if (scripted?.kind === 'httpError')
      return c.json({ message: scripted.message }, scripted.status as 400);

    if (!authorize(c.req.header('merchantId'))) {
      return c.json({ status_code: '2001', status: 'failed', message: 'Invalid Token.' });
    }

    const transaction = transactions.get(form.invoice_number ?? '');
    if (!transaction) {
      return c.json({ status_code: '2001', status: 'failed', message: 'Invalid Token.' });
    }

    return c.json({
      status_code: '200',
      status: 'success',
      message: 'Transaction found.',
      data: {
        invoice_number: transaction.invoiceNumber,
        trx_status: transaction.status,
        trx_id: transaction.trxId,
        payment_amount: majorAmount(transaction.amountMinor),
        order_date_time: formatDateTime(transaction.createdAt),
        payer_mobile_no: transaction.payerMobileNo,
        payment_method: transaction.paymentMethod,
        reference: transaction.reference ?? '',
        checkout_items: transaction.checkoutItems ?? '',
      },
    });
  });

  // --- POST /v2/transaction-status -------------------------------------------------
  app.post('/paystation/v2/transaction-status', async (c) => {
    const rawBody = await c.req.text();
    let body: Record<string, unknown> = {};
    try {
      body = rawBody === '' ? {} : (JSON.parse(rawBody) as Record<string, unknown>);
    } catch {
      body = {};
    }
    record({
      provider: PROVIDER,
      operation: 'v2/transaction-status',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body,
      rawBody,
    });

    if (!authorize(c.req.header('merchantId'))) {
      return c.json({
        status_code: '2001',
        status: 'failed',
        message: 'Transaction not found in system',
      });
    }

    const transaction = byTrxId.get(String(body.trxId ?? ''));
    if (!transaction) {
      return c.json({
        status_code: '2001',
        status: 'failed',
        message: 'Transaction not found in system',
      });
    }

    return c.json({
      status_code: '200',
      status: 'success',
      message: 'Transaction found',
      data: {
        invoice_number: transaction.invoiceNumber,
        trx_status: transaction.status,
        trx_id: transaction.trxId,
        trx_amount: transaction.amountMinor / 100,
        trx_date: transaction.createdAt.toISOString().slice(0, 10),
        request_amount: majorAmount(transaction.amountMinor),
        payment_amount: majorAmount(transaction.amountMinor),
        order_date_time: formatDateTime(transaction.createdAt),
        payer_mobile_no: transaction.payerMobileNo,
        payment_method: transaction.paymentMethod,
        reference: transaction.reference ?? '',
      },
    });
  });

  // --- Hosted checkout stand-in ----------------------------------------------------
  // PayStation redirects the customer's browser here. This page is the human-triggered
  // completion step, so the failure and success stories can be driven from a browser.
  app.get('/paystation/checkout/:trxId/:token', (c) => {
    const transaction = byTrxId.get(c.req.param('trxId') ?? '');
    if (!transaction) return c.text('Unknown transaction', 404);

    const link = (status: TrxStatus, method: string): string => {
      const target = `/paystation/checkout/${transaction.trxId}/${c.req.param('token')}/complete?status=${status}&method=${method}`;
      return `<li><a href="${target}">${status} via ${method}</a></li>`;
    };

    return c.html(`<!doctype html>
<html><head><meta charset="utf-8"><title>PayStation (fake) checkout</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}
.warn{background:#fff4e5;border-left:4px solid #f59e0b;padding:.75rem 1rem}
code{background:#f4f4f5;padding:.1rem .3rem}</style></head>
<body>
<h1>PayStation fake checkout</h1>
<p class="warn"><strong>This is not PayStation.</strong> A local stand-in. No card is charged and no money moves.</p>
<p>Invoice <code>${transaction.invoiceNumber}</code> · ৳${majorAmount(transaction.amountMinor)} · status <code>${transaction.status}</code></p>
<h2>Complete this payment</h2>
<ul>
${link('success', 'bKash')}${link('success', 'Nagad')}${link('failed', 'Rocket')}${link('refund', 'Visa')}
</ul>
</body></html>`);
  });

  app.get('/paystation/checkout/:trxId/:token/complete', (c) => {
    const transaction = byTrxId.get(c.req.param('trxId') ?? '');
    if (!transaction) return c.text('Unknown transaction', 404);

    const status = (c.req.query('status') ?? 'success') as TrxStatus;
    const method = c.req.query('method') ?? 'bKash';
    setStatus(transaction.invoiceNumber, status, method);

    return c.html(`<!doctype html><html><head><meta charset="utf-8"><title>Done</title></head>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem">
<h1>Payment ${status}</h1>
<p>Invoice <code>${transaction.invoiceNumber}</code> is now <code>${status}</code> via ${method}.</p>
<p>The IPN, if one is due, is delivered by the outbox/IPN dispatcher — watch it with
<code>GET /_control/ipn-log</code>.</p>
</body></html>`);
  });
}

/** Build the flat IPN body exactly as their spec describes. */
export function ipnBody(transaction: Transaction): Record<string, unknown> {
  return {
    invoice_number: transaction.invoiceNumber,
    trx_status: IPN_STATUS_WORD[transaction.status],
    trx_id: transaction.trxId,
    // A JSON number, not a string. Their docs call this out explicitly.
    trx_amount: transaction.amountMinor / 100,
    order_date_time: ipnDateTime(transaction.createdAt),
    payment_method: transaction.paymentMethod,
    reference: transaction.paymentMethod,
  };
}
