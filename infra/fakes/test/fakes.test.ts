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
        provider: 'mimsms',
        operation: 'send',
        times: 2,
        outcome: { kind: 'httpError', status: 503 },
      }),
    });

    const send = async (): Promise<Response> =>
      app.request('/api/V2/SMS', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'J6J68SNLDYG1SVS',
          userName: 'demo@mimsms.com',
          senderName: '8809612444598',
          transactionType: 'T',
          mobileNumber: '8801844909020',
          message: 'test',
        }),
      });

    assert.equal(((await (await send()).json()) as Record<string, unknown>).statusCode, '503');
    assert.equal(((await (await send()).json()) as Record<string, unknown>).statusCode, '503');
    assert.equal(((await (await send()).json()) as Record<string, unknown>).statusCode, '200');
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

describe('MiMSMS send — contract-verified', () => {
  const AUTH = { apiKey: 'J6J68SNLDYG1SVS', userName: 'demo@mimsms.com' };

  const post = async (path: string, payload: Record<string, unknown>): Promise<Response> =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  const send = async (overrides: Record<string, unknown> = {}): Promise<Response> =>
    post('/api/V2/SMS', {
      ...AUTH,
      senderName: '8809612444598',
      transactionType: 'T',
      mobileNumber: '8801844909020',
      message: 'Your parcel is out for delivery',
      ...overrides,
    });

  test('returns the documented envelope, with statusCode as a STRING', async () => {
    const response = await send();
    const body = (await response.json()) as Record<string, unknown>;
    for (const field of ['statusCode', 'status', 'trxnId', 'message', 'data']) {
      assert.ok(field in body, `response is missing documented field "${field}"`);
    }
    assert.equal(body.statusCode, '200');
    assert.equal(body.status, 'Success');
    assert.equal(typeof body.statusCode, 'string', 'statusCode is documented as a string');
    assert.match(String(body.trxnId), /^TRX/);
  });

  test('numbers are 8801XXXXXXXXX — a + prefix is rejected', async () => {
    // Their spec shows no plus and no leading zero. The "normalise to E.164" reflex is wrong
    // for this provider, which is exactly the bug this assertion exists to catch.
    const bad = await send({ mobileNumber: '+8801844909020' });
    assert.equal(((await bad.json()) as Record<string, unknown>).statusCode, '400');

    const good = await send({ mobileNumber: '8801844909020' });
    assert.equal(((await good.json()) as Record<string, unknown>).statusCode, '200');
  });

  test('transactional (T) allows exactly one recipient', async () => {
    const ok = await send({ transactionType: 'T', mobileNumber: '8801844909020,8801713537347' });
    assert.equal(((await ok.json()) as Record<string, unknown>).statusCode, '400');

    const single = await send({ transactionType: 'T', mobileNumber: '8801844909020' });
    assert.equal(((await single.json()) as Record<string, unknown>).statusCode, '200');
  });

  test('promotional (P) accepts a comma-separated list', async () => {
    const response = await send({
      transactionType: 'P',
      mobileNumber: '8801844909020,8801713537347',
    });
    const body = (await response.json()) as { statusCode: string; data: unknown[] };
    assert.equal(body.statusCode, '200');
    assert.equal(body.data.length, 2);
  });

  test('rejects an unknown transactionType', async () => {
    const response = await send({ transactionType: 'X' });
    assert.equal(((await response.json()) as Record<string, unknown>).statusCode, '400');
  });

  test('bad credentials fail with an in-band code', async () => {
    const response = await send({ apiKey: 'wrong' });
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.status, 'Failed');
    assert.equal(body.statusCode, '400');
  });

  test('an un-whitelisted caller is refused', async () => {
    // Their spec requires IP and domain whitelisting before any call is accepted.
    await post('/_sms/access', { whitelisted: false });
    const response = await send();
    assert.match(
      String(((await response.json()) as Record<string, unknown>).message),
      /whitelist/i,
    );
    await post('/_sms/access', { whitelisted: true });
  });

  test('an un-activated API key is refused', async () => {
    await post('/_sms/access', { keyActivated: false });
    const response = await send();
    assert.match(
      String(((await response.json()) as Record<string, unknown>).message),
      /activated/i,
    );
    await post('/_sms/access', { keyActivated: true });
  });
});

describe('MiMSMS bulk and dynamic — contract-verified', () => {
  const AUTH = {
    apiKey: 'J6J68SNLDYG1SVS',
    userName: 'demo@mimsms.com',
    senderName: '8809612444598',
  };

  const post = async (path: string, payload: Record<string, unknown>): Promise<Response> =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  test('OneToMany broadcasts one message to an smsData array', async () => {
    const response = await post('/api/V2/OneToMany', {
      ...AUTH,
      message: 'Out for delivery',
      smsData: [{ mobNumber: '8801844909020' }, { mobNumber: '8801713537347' }],
    });
    const body = (await response.json()) as { statusCode: string; data: { count: number }[] };
    assert.equal(body.statusCode, '200');
    assert.equal(body.data[0]?.count, 2);
  });

  test('DSMS sends a different message per recipient', async () => {
    const response = await post('/api/V2/DSMS', {
      ...AUTH,
      smsData: [
        { mobNumber: '8801844909020', message: 'Your parcel A' },
        { mobNumber: '8801713537347', message: 'Your parcel B' },
      ],
    });
    assert.equal(((await response.json()) as Record<string, unknown>).statusCode, '200');
    const records = (await (await app.request('/_sms/records')).json()) as { message: string }[];
    assert.ok(records.some((r) => r.message === 'Your parcel A'));
    assert.ok(records.some((r) => r.message === 'Your parcel B'));
  });

  test('enforces the documented 1000-recipient ceiling', async () => {
    const smsData = Array.from({ length: 1001 }, (_, i) => ({
      mobNumber: `88018449090${String(i).padStart(2, '0')}`,
    }));
    const response = await post('/api/V2/OneToMany', { ...AUTH, message: 'x', smsData });
    assert.equal(((await response.json()) as Record<string, unknown>).statusCode, '400');
  });
});

describe('MiMSMS schedule — contract-verified', () => {
  const AUTH = {
    apiKey: 'J6J68SNLDYG1SVS',
    userName: 'demo@mimsms.com',
    senderName: '8809612444598',
  };
  const post = async (payload: Record<string, unknown>): Promise<Response> =>
    app.request('/api/V2/Schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...AUTH, transactionType: 'T', ...payload }),
    });

  test('accepts ISO 8601 on a 30-minute interval', async () => {
    const response = await post({
      scheduleTime: '2026-06-03T15:30:00',
      smsData: [{ mobNumber: '8801844909020', message: 'Scheduled' }],
    });
    assert.equal(((await response.json()) as Record<string, unknown>).statusCode, '200');
  });

  test('rejects a time that is not on a 30-minute interval', async () => {
    const response = await post({
      scheduleTime: '2026-06-03T15:17:00',
      smsData: [{ mobNumber: '8801844909020', message: 'Scheduled' }],
    });
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.statusCode, '400');
    assert.match(String(body.message), /30-minute/);
  });

  test('rejects a non-ISO scheduleTime', async () => {
    const response = await post({
      scheduleTime: '03/06/2026 15:30',
      smsData: [{ mobNumber: '8801844909020', message: 'x' }],
    });
    assert.equal(((await response.json()) as Record<string, unknown>).statusCode, '400');
  });
});

describe('MiMSMS delivery report — contract-verified', () => {
  const AUTH = {
    apiKey: 'J6J68SNLDYG1SVS',
    userName: 'demo@mimsms.com',
    senderName: '8809612444598',
  };
  const post = async (path: string, payload: Record<string, unknown>): Promise<Response> =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  test('a DLR carries the operator retry policy, which is not ours', async () => {
    await post('/api/V2/SMS', {
      ...AUTH,
      transactionType: 'T',
      mobileNumber: '8801844909020',
      message: 'Out for delivery',
    });
    const trackingId = (
      (await (await app.request('/_sms/records')).json()) as { trackingId: string }[]
    ).at(-1)!.trackingId;

    // Retry policy 3 means the CARRIER will retry the handset. Dead-lettering on first
    // failure would discard a message that was about to be delivered.
    await app.request(`/_sms/${trackingId}/dlr?name=Absent%20subscriber%20for%20SM`, {
      method: 'POST',
    });
    const response = await post('/api/V2/DlrApi', {
      ...AUTH,
      mobileNumber: '8801844909020',
      trackingId,
    });
    const body = (await response.json()) as { data: { dlrName: string; retryPolicy: number }[] };
    assert.equal(body.data[0]?.dlrName, 'Absent subscriber for SM');
    assert.equal(body.data[0]?.retryPolicy, 3);
  });

  test('an unknown trackingId is a failure', async () => {
    const response = await post('/api/V2/DlrApi', {
      ...AUTH,
      mobileNumber: '8801844909020',
      trackingId: 'TRXnope',
    });
    assert.equal(((await response.json()) as Record<string, unknown>).statusCode, '400');
  });

  test('publishes the full documented DLR table', async () => {
    const codes = (await (await app.request('/_sms/dlr-codes')).json()) as {
      name: string;
      retryPolicy: number;
    }[];
    assert.ok(codes.length >= 10, 'the published table has at least ten codes');
    assert.ok(codes.some((code) => code.name === 'Delivered' && code.retryPolicy === 0));
    assert.ok(codes.some((code) => code.retryPolicy === 3));
  });
});

describe('MiMSMS balance — contract-verified response fields', () => {
  test('returns balance and the expair_Date spelling their docs use', async () => {
    const response = await app.request('/api/V2/BalanceCheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'J6J68SNLDYG1SVS', userName: 'demo@mimsms.com' }),
    });
    const body = (await response.json()) as { data: Record<string, unknown>[] };
    assert.equal(body.data[0]?.balance, '1250.55');
    // Their typo. Normalising it would break against the real API.
    assert.ok('expair_Date' in body.data[0]!);
  });
});

describe('MiMSMS segment counting', () => {
  const segmentsFor = async (message: string): Promise<number> => {
    const response = await app.request('/api/V2/SMS', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'J6J68SNLDYG1SVS',
        userName: 'demo@mimsms.com',
        senderName: '8809612444598',
        transactionType: 'P',
        mobileNumber: '8801844909020',
        message,
      }),
    });
    const body = (await response.json()) as { data: { segments: number }[] };
    return body.data[0]!.segments;
  };

  test('GSM-7 is 160 per segment, one Bangla character halves it', async () => {
    assert.equal(await segmentsFor('a'.repeat(160)), 1);
    assert.equal(await segmentsFor('a'.repeat(161)), 2);
    assert.equal(await segmentsFor('আ'.repeat(70)), 1);
    assert.equal(await segmentsFor('আ'.repeat(71)), 2);
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
