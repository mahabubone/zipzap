/**
 * Contract: PayStationAdapter against the fake.
 *
 * The fake is contract-verified (retrieved 2026-10-02), so passing against it proves
 * the adapter speaks the provider's wire format — not a shape we invented. Skipped,
 * not failed, when FAKES_URL is absent: unit tests must never touch HTTP.
 *
 * What these prove: initiate posts the documented form fields and returns the trx
 * id as reference; duplicate invoices surface as in-band 1008 (never an HTTP error);
 * verify resolves by trx id via v2; an unknown status throws instead of mapping to
 * failed or processing; the control API drives success and the adapter reports it.
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { PayStationAdapter } from '../../dist/modules/finance/provider/paystation.adapter.js';
import { PaymentProviderError } from '../../dist/modules/finance/provider/mock-payment.provider.js';

const fakesUrl = process.env.FAKES_URL;
const describeIfFakes = fakesUrl ? describe : describe.skip;

const MERCHANT = '104-1653730183';
const PASSWORD = 'gamecoderstorepass';

function adapter(): PayStationAdapter {
  return new PayStationAdapter({ baseUrl: fakesUrl!, merchantId: MERCHANT, password: PASSWORD });
}

async function reset(): Promise<void> {
  await fetch(`${fakesUrl}/_reset`, { method: 'POST' });
}

/** Minimal IPN receiver on a real socket: success-completes require somewhere to deliver. */
async function startReceiver(): Promise<{ url: string; close: () => Promise<void> }> {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/ipn`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function useReceiver(url: string): Promise<void> {
  await fetch(`${fakesUrl}/_ipn-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, retryLadderMs: [0] }),
  });
}

async function complete(invoice: string, status = 'success'): Promise<void> {
  const response = await fetch(`${fakesUrl}/_paystation/${invoice}/complete?status=${status}`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
}

before(async () => {
  if (!fakesUrl) return;
  await reset();
});

describeIfFakes('paystation adapter contract', () => {
  test('initiate returns the trx id as reference, status processing', async () => {
    await reset();
    const payment = await adapter().initiate({
      invoiceNumber: `CTR-1-${Date.now()}`,
      amountMinor: 125_000,
      currency: 'BDT',
      beneficiary: 'merchant-1',
    });
    assert.match(payment.reference, /^FAKE\d+$/);
    assert.equal(payment.status, 'processing');
    assert.equal(payment.amountMinor, 125_000);
  });

  test('duplicate invoice surfaces in-band 1008, never an HTTP error', async () => {
    await reset();
    const invoice = `CTR-2-${Date.now()}`;
    const request = {
      invoiceNumber: invoice,
      amountMinor: 125_000,
      currency: 'BDT' as const,
      beneficiary: 'merchant-1',
    };
    await adapter().initiate(request);
    await assert.rejects(() => adapter().initiate(request), /1008/);
  });

  test('verify by trx id reports success after the control API completes it', async () => {
    await reset();
    const receiver = await startReceiver();
    try {
      await useReceiver(receiver.url);
      const invoice = `CTR-3-${Date.now()}`;
      const payment = await adapter().initiate({
        invoiceNumber: invoice,
        amountMinor: 125_000,
        currency: 'BDT',
        beneficiary: 'merchant-1',
      });
      assert.equal((await adapter().verify(payment.reference)).status, 'processing');

      await complete(invoice, 'success');
      const confirmed = await adapter().verify(payment.reference);
      assert.equal(confirmed.status, 'succeeded');
      assert.equal(confirmed.invoiceNumber, invoice);
      assert.equal(confirmed.amountMinor, 125_000);
    } finally {
      await receiver.close();
    }
  });

  test('verify by trx id reports failure without settling', async () => {
    await reset();
    const invoice = `CTR-4-${Date.now()}`;
    const payment = await adapter().initiate({
      invoiceNumber: invoice,
      amountMinor: 125_000,
      currency: 'BDT',
      beneficiary: 'merchant-1',
    });
    await complete(invoice, 'failed');
    assert.equal((await adapter().verify(payment.reference)).status, 'failed');
  });

  test('unknown trx id throws — never invents a payment', async () => {
    await reset();
    await assert.rejects(() => adapter().verify('FAKE999999'), PaymentProviderError);
  });

  test('wrong credentials throw on initiate', async () => {
    await reset();
    const bad = new PayStationAdapter({
      baseUrl: fakesUrl!,
      merchantId: 'wrong',
      password: 'wrong',
    });
    await assert.rejects(
      () =>
        bad.initiate({
          invoiceNumber: `CTR-5-${Date.now()}`,
          amountMinor: 125_000,
          currency: 'BDT',
          beneficiary: 'merchant-1',
        }),
      /2001/,
    );
  });

  test('a provider that records a different amount fails loudly, never settles short', async () => {
    // The fake parses "1250.50" with parseInt and holds 125000 — unspecified behaviour
    // the verified contract never pins. The adapter must refuse to settle against a
    // figure it did not send, not silently pay 50 short.
    await reset();
    await assert.rejects(
      () =>
        adapter().initiate({
          invoiceNumber: `CTR-6-${Date.now()}`,
          amountMinor: 125_050,
          currency: 'BDT',
          beneficiary: 'merchant-1',
        }),
      /mismatch/,
    );
  });
});
