import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { createApp } from '../src/server.ts';
import * as ipn from '../src/ipn.ts';

const app = createApp();

const MERCHANT = '104-1653730183';
const PASSWORD = 'gamecoderstorepass';

async function initiate(overrides: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const form = new URLSearchParams({
    merchantId: MERCHANT,
    password: PASSWORD,
    invoice_number: 'SET-001',
    payment_amount: '1250',
    cust_name: 'Ayesha Rahman',
    cust_phone: '01700000000',
    cust_email: 'ayesha@example.com',
    ...overrides,
  });
  const response = await app.request('/paystation/initiate-payment', {
    method: 'POST',
    body: form,
  });
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(async () => {
  await app.request('/_reset', { method: 'POST' });
});

/**
 * These assertions are transcribed from https://paystation.com.bd/documentation, retrieved
 * 2026-10-02. If a field name or error code changes upstream, these fail — which is the point.
 * A test that passed against a guessed shape would have told us nothing.
 */
describe('PayStation initiate-payment (contract-verified)', () => {
  test('returns the documented success shape', async () => {
    const body = await initiate();
    assert.equal(body.status_code, '200');
    assert.equal(body.status, 'success');
    assert.equal(body.message, 'Payment Link Created Successfully.');
    assert.equal(body.invoice_number, 'SET-001');
    assert.equal(body.payment_amount, '1250');
    assert.match(String(body.payment_url), /^\/paystation\/checkout\/\w+\/\w+$|checkout/);
  });

  test('errors are in-band, not HTTP statuses', async () => {
    const response = await app.request('/paystation/initiate-payment', {
      method: 'POST',
      body: new URLSearchParams({ merchantId: 'wrong', password: PASSWORD, invoice_number: 'X' }),
    });
    // Their failure responses still return HTTP 200 with a bad status_code. An adapter that
    // trusts the HTTP status would read this as a success.
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as Record<string, unknown>).status_code, '2001');
  });

  test('a missing invoice_number is 2001', async () => {
    const body = await initiate({ invoice_number: '' });
    assert.equal(body.status_code, '2001');
  });

  test('1008 duplicate invoice, on the second identical attempt', async () => {
    await initiate();
    const duplicate = await initiate();
    assert.equal(duplicate.status_code, '1008');
    assert.equal(duplicate.status, 'failed');
    assert.equal(duplicate.message, 'Duplicate invoice number.');
  });

  test('rejects a bad merchant id with 2001', async () => {
    const body = await initiate({ merchantId: 'nope' });
    assert.equal(body.status_code, '2001');
  });
});

describe('PayStation transaction-status v1 (contract-verified)', () => {
  test('reads merchantId from the header, not the body', async () => {
    await initiate();
    const response = await app.request('/paystation/transaction-status', {
      method: 'POST',
      headers: { merchantId: MERCHANT },
      body: new URLSearchParams({ invoice_number: 'SET-001' }),
    });
    const body = (await response.json()) as { status_code: string; data: Record<string, unknown> };
    assert.equal(body.status_code, '200');
    assert.equal(body.data.invoice_number, 'SET-001');
    // Documented as lowercase on the status queries.
    assert.equal(body.data.trx_status, 'processing');
  });

  test('2001 for an unknown invoice', async () => {
    const response = await app.request('/paystation/transaction-status', {
      method: 'POST',
      headers: { merchantId: MERCHANT },
      body: new URLSearchParams({ invoice_number: 'missing' }),
    });
    assert.equal(((await response.json()) as Record<string, unknown>).status_code, '2001');
  });

  test('2001 when merchantId is missing', async () => {
    const response = await app.request('/paystation/transaction-status', {
      method: 'POST',
      body: new URLSearchParams({ invoice_number: 'SET-001' }),
    });
    assert.equal(((await response.json()) as Record<string, unknown>).status_code, '2001');
  });
});

describe('PayStation transaction-status v2 (contract-verified)', () => {
  test('takes a JSON trxId and returns the documented fields', async () => {
    const created = await initiate({ invoice_number: 'SET-V2' });
    // The trxId is the second-to-last path segment of the checkout URL.
    const trxId = String(created.payment_url).split('/').at(-2);

    const response = await app.request('/paystation/v2/transaction-status', {
      method: 'POST',
      headers: { merchantId: MERCHANT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trxId }),
    });
    const body = (await response.json()) as { status_code: string; data: Record<string, unknown> };
    assert.equal(body.status_code, '200');
    for (const field of [
      'invoice_number',
      'trx_status',
      'trx_id',
      'trx_amount',
      'trx_date',
      'request_amount',
      'payment_amount',
      'order_date_time',
      'payer_mobile_no',
      'payment_method',
      'reference',
    ]) {
      assert.ok(field in body.data, `v2 response is missing documented field "${field}"`);
    }
  });

  test('trx_date is YYYY-MM-DD as documented', async () => {
    await initiate();
    const response = await app.request('/paystation/v2/transaction-status', {
      method: 'POST',
      headers: { merchantId: MERCHANT },
      body: JSON.stringify({ trxId: 'FAKE000001' }),
    });
    const body = (await response.json()) as { data: Record<string, unknown> };
    assert.match(String(body.data.trx_date), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('2001 for an unknown trxId', async () => {
    const response = await app.request('/paystation/v2/transaction-status', {
      method: 'POST',
      headers: { merchantId: MERCHANT },
      body: JSON.stringify({ trxId: 'nope' }),
    });
    assert.equal(((await response.json()) as Record<string, unknown>).status_code, '2001');
  });
});

describe('PayStation IPN body (contract-verified)', () => {
  test('uses the documented flat shape and capitalised Success', async () => {
    const server = await startReceiver(() => 200);
    ipn.configure(server.url, [0]);

    await initiate();
    const response = await app.request(
      '/_paystation/SET-001/complete?status=success&method=bKash',
      { method: 'POST' },
    );
    const body = (await response.json()) as { ipn: { body: Record<string, unknown> } };
    await server.close();

    const ipnBody = body.ipn.body;
    for (const field of [
      'invoice_number',
      'trx_status',
      'trx_id',
      'trx_amount',
      'order_date_time',
      'payment_method',
      'reference',
    ]) {
      assert.ok(field in ipnBody, `IPN is missing documented field "${field}"`);
    }

    // The documented IPN pins trx_status to "Success" even though the status queries use
    // lowercase. Reproduced literally: that asymmetry is what we want receivers to survive.
    assert.equal(ipnBody.trx_status, 'Success');
    assert.equal(ipnBody.invoice_number, 'SET-001');

    // trx_amount is a JSON number, not a string. Their docs call this out explicitly.
    assert.equal(typeof ipnBody.trx_amount, 'number');
    assert.equal(ipnBody.trx_amount, 1250);

    // order_date_time is Y-m-d H:i:s.
    assert.match(String(ipnBody.order_date_time), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('a failed payment sends no IPN', async () => {
    await initiate();
    const response = await app.request('/_paystation/SET-001/complete?status=failed', {
      method: 'POST',
    });
    const body = (await response.json()) as { status?: string };
    assert.equal(body.status, 'failed');
    assert.equal(ipn.allDeliveries().length, 0);
  });
});

describe('IPN retry ladder', () => {
  test('retries until the receiver returns 2xx', async () => {
    let attempts = 0;
    const server = await startReceiver(() => {
      attempts += 1;
      return attempts >= 3 ? 200 : 500;
    });
    ipn.configure(server.url, [0, 0, 0]);

    await initiate();
    const response = await app.request('/_paystation/SET-001/complete?status=success', {
      method: 'POST',
    });
    const body = (await response.json()) as { ipn: { delivered: boolean; attempts: unknown[] } };

    assert.equal(body.ipn.delivered, true);
    assert.equal(attempts, 3, 'must retry exactly until the receiver acknowledges');
    await server.close();
  });

  test('a permanently failing receiver records every attempt and delivered=false', async () => {
    const server = await startReceiver(() => 500);
    ipn.configure(server.url, [0, 0, 0]);

    await initiate();
    const response = await app.request('/_paystation/SET-001/complete?status=success', {
      method: 'POST',
    });
    const body = (await response.json()) as {
      ipn: { delivered: boolean; attempts: { outcome: string; status?: number }[] };
    };

    assert.equal(body.ipn.delivered, false);
    assert.equal(body.ipn.attempts.length, 3);
    assert.ok(
      body.ipn.attempts.every(
        (attempt) => attempt.outcome === 'rejected' && attempt.status === 500,
      ),
    );
    await server.close();
  });

  test('an unreachable receiver is recorded, and never throws', async () => {
    // Port 1 is reserved and nothing listens there.
    ipn.configure('http://127.0.0.1:1/ipn', [0, 0]);
    await initiate();
    const response = await app.request('/_paystation/SET-001/complete?status=success', {
      method: 'POST',
    });
    const body = (await response.json()) as {
      ipn: { delivered: boolean; attempts: { outcome: string }[] };
    };
    assert.equal(body.ipn.delivered, false);
    assert.ok(body.ipn.attempts.every((attempt) => attempt.outcome === 'unreachable'));
  });

  test('the same IPN is delivered more than once on retry — the dedupe test', async () => {
    // Their docs require the receiver to be idempotent because this happens.
    let bodies: string[] = [];
    const server = await startReceiver((request) => {
      void request.text().then((text: string) => bodies.push(text));
      return 500;
    });
    ipn.configure(server.url, [0, 0, 0]);

    await initiate();
    await app.request('/_paystation/SET-001/complete?status=success', { method: 'POST' });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(bodies.length, 3, 'a non-2xx receiver sees the identical IPN three times');
    assert.equal(new Set(bodies).size, 1, 'and every delivery is byte-identical');
    await server.close();
  });
});

describe('recorder', () => {
  test('preserves the raw body so an HMAC signature can be verified', async () => {
    await initiate({ invoice_number: 'RAW-1', reference: 'order:1' });
    const response = await app.request('/_calls?provider=paystation&operation=initiate-payment');
    const body = (await response.json()) as {
      calls: { rawBody: string; body: Record<string, string> }[];
    };
    const call = body.calls.at(-1)!;

    // Form fields survive verbatim, including ordering — re-serialising JSON would not.
    assert.ok(call.rawBody.includes('invoice_number=RAW-1'));
    assert.equal(call.body.reference, 'order:1');
  });

  test('since= filters to calls after a cursor', async () => {
    await initiate({ invoice_number: 'A' });
    const cursorResponse = await app.request('/_cursor');
    const cursor = ((await cursorResponse.json()) as { cursor: number }).cursor;

    await initiate({ invoice_number: 'B' });
    const response = await app.request(`/_calls?since=${cursor}`);
    const body = (await response.json()) as { calls: { body: Record<string, string> }[] };
    assert.equal(body.calls.length, 1);
    assert.equal(body.calls[0]?.body.invoice_number, 'B');
  });
});

describe('fault injection', () => {
  test('applies exactly `times` times, then behaves normally', async () => {
    await app.request('/_script', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'sms',
        operation: 'send',
        times: 2,
        outcome: { kind: 'httpError', status: 503 },
      }),
    });

    const send = async (to: string): Promise<Response> =>
      app.request('/sms/v1/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, body: 'test' }),
      });

    assert.equal((await send('+8801700000001')).status, 503);
    assert.equal((await send('+8801700000002')).status, 503);
    assert.equal((await send('+8801700000003')).status, 202);
  });

  test('a field matcher narrows to one specific invoice', async () => {
    await app.request('/_script', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'paystation',
        operation: 'initiate-payment',
        field: 'invoice_number',
        fieldEquals: 'DUP',
        times: 1,
        outcome: { kind: 'reject', statusCode: '1008', message: 'Duplicate invoice number.' },
      }),
    });

    assert.equal((await initiate({ invoice_number: 'DUP' })).status_code, '1008');
    assert.equal((await initiate({ invoice_number: 'OTHER' })).status_code, '200');
  });

  test('reset clears rules, transactions and the call log together', async () => {
    await initiate();
    await app.request('/_reset', { method: 'POST' });
    const response = await app.request('/_calls');
    assert.equal(((await response.json()) as { calls: unknown[] }).calls.length, 0);
    assert.equal(((await (await app.request('/_rules')).json()) as unknown[]).length, 0);
  });
});

describe('SMS (shape-accurate, unverified)', () => {
  const send = async (payload: Record<string, unknown>): Promise<Response> =>
    app.request('/sms/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  test('rejects a local-format number rather than guessing', async () => {
    const response = await send({ to: '01700000000', body: 'hello' });
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as Record<string, unknown>).error, 'invalid_msisdn');
  });

  test('accepts international format and reports segments', async () => {
    const response = await send({ to: '+8801700000000', body: 'Your parcel is out for delivery' });
    assert.equal(response.status, 202);
    const body = (await response.json()) as Record<string, unknown>;
    assert.match(String(body.id), /^sms_\d{6}$/);
  });

  test('segment counting: one Bangla character halves the per-segment limit', async () => {
    const segmentsFor = async (body: string): Promise<number> =>
      Number(
        ((await (await send({ to: '+8801700000000', body })).json()) as Record<string, unknown>)
          .segments,
      );

    // GSM-7: 160 characters per segment.
    assert.equal(await segmentsFor('a'.repeat(160)), 1);
    assert.equal(await segmentsFor('a'.repeat(161)), 2);

    // UCS-2 (Bangla): 70 per segment. Under-counting this bills the merchant for the wrong
    // number of messages, so the boundary is asserted rather than assumed.
    assert.equal(await segmentsFor('আ'.repeat(70)), 1);
    assert.equal(await segmentsFor('আ'.repeat(71)), 2);

    // One Bangla character is enough to drop the whole message to the UCS-2 limit.
    assert.equal(await segmentsFor('a'.repeat(69) + 'আ'), 1);
    assert.equal(await segmentsFor('a'.repeat(70) + 'আ'), 2);
  });

  test('bulk reports per recipient so one bad number does not fail the batch', async () => {
    const response = await app.request('/sms/v1/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: ['+8801700000000', '01700000000', '+8801800000000'],
        body: 'Out for delivery',
      }),
    });
    assert.equal(response.status, 202);
    const body = (await response.json()) as { accepted: number; rejected: number };
    assert.equal(body.accepted, 2);
    assert.equal(body.rejected, 1);
  });
});

describe('Moneybag (shape-accurate, unverified)', () => {
  test('rejects a float amount — money is integer minor units', async () => {
    const response = await app.request('/moneybag/v1/charges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'O-1', amountMinor: 1250.5 }),
    });
    assert.equal(response.status, 422);
  });

  test('creates a charge and returns a checkout URL', async () => {
    const response = await app.request('/moneybag/v1/charges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'O-1', amountMinor: 125050 }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.currency, 'BDT');
    assert.match(String(body.checkoutUrl), /moneybag\/checkout/);
  });
});

/** Minimal HTTP receiver, so retry behaviour is exercised against a real socket. */
async function startReceiver(handler: (request: Request) => number): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const status = handler(new Request(`http://localhost${req.url}`, { method: req.method }));
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/ipn`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
