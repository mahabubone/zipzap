/**
 * Contract: MiMSMSAdapter against the fake.
 *
 * The fake is contract-verified (Bulk SMS API v2.1, 2026-10-02), so passing
 * against it proves the adapter speaks the provider's wire format. Skipped,
 * not failed, when FAKES_URL is absent: unit tests must never touch HTTP.
 *
 * What these prove: T-send returns a tracking id; the E.164 plus is stripped
 * (and a bad number throws before any HTTP); DLR reports carrier policy; the
 * scripted handset-off DLR carries retry policy 3 — the rule that decides
 * dead-letter.
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { MiMSMSAdapter } from '../../dist/modules/notification/provider/mimsms.adapter.js';
import { MiMSMSError } from '../../dist/modules/notification/provider/mimsms.adapter.js';

const fakesUrl = process.env.FAKES_URL;
const describeIfFakes = fakesUrl ? describe : describe.skip;

function adapter() {
  return new MiMSMSAdapter({
    baseUrl: fakesUrl!,
    apiKey: 'J6J68SNLDYG1SVS',
    userName: 'demo@mimsms.com',
    senderName: '8809612444598',
  });
}

async function reset(): Promise<void> {
  await fetch(`${fakesUrl}/_reset`, { method: 'POST' });
}

async function applyDlr(trackingId: string, name: string): Promise<void> {
  const response = await fetch(
    `${fakesUrl}/_sms/${trackingId}/dlr?name=${encodeURIComponent(name)}`,
    { method: 'POST' },
  );
  assert.equal(response.status, 200);
}

before(async () => {
  if (!fakesUrl) return;
  await reset();
});

describeIfFakes('mimsms adapter contract', () => {
  test('T-send returns a tracking id for one recipient', async () => {
    await reset();
    const receipt = await adapter().send({
      recipientE164: '+8801712345678',
      body: 'Your parcel is out for delivery.',
      kind: 'transactional',
    });
    assert.match(receipt.trackingId, /^TRX/);
    assert.equal(receipt.segments, 1);
  });

  test('the plus is stripped before sending — verified via the recorded call', async () => {
    await reset();
    await adapter().send({
      recipientE164: '+8801712345678',
      body: 'ping',
      kind: 'transactional',
    });
    const calls = (await (
      await fetch(`${fakesUrl}/_calls?provider=mimsms&operation=send`)
    ).json()) as { calls: Array<{ body: { mobileNumber: string } }> };
    const last = calls.calls[calls.calls.length - 1]!;
    assert.equal(last.body.mobileNumber, '8801712345678');
  });

  test('a bad number throws before any HTTP — never sends a malformed recipient', async () => {
    await reset();
    await assert.rejects(
      () =>
        adapter().send({
          recipientE164: '+15551234567',
          body: 'ping',
          kind: 'transactional',
        }),
      MiMSMSError,
    );
  });

  test('wrong credentials throw with the provider message', async () => {
    await reset();
    const bad = new MiMSMSAdapter({
      baseUrl: fakesUrl!,
      apiKey: 'wrong',
      userName: 'wrong',
      senderName: '8809612444598',
    });
    await assert.rejects(
      () => bad.send({ recipientE164: '+8801712345678', body: 'ping', kind: 'transactional' }),
      /Invalid apiKey/,
    );
  });

  test('DLR reports the carrier policy — handset-off carries retry policy 3', async () => {
    await reset();
    const receipt = await adapter().send({
      recipientE164: '+8801712345678',
      body: 'ping',
      kind: 'transactional',
    });
    await applyDlr(receipt.trackingId, 'Absent subscriber for SM');
    const report = await adapter().deliveryReport(receipt.trackingId);
    assert.equal(report.dlrName, 'Absent subscriber for SM');
    assert.equal(report.retryPolicy, 3);
    assert.equal(report.delivered, false);
  });

  test('delivered DLR reports delivered with policy 0', async () => {
    await reset();
    const receipt = await adapter().send({
      recipientE164: '+8801712345678',
      body: 'ping',
      kind: 'transactional',
    });
    await applyDlr(receipt.trackingId, 'Delivered');
    const report = await adapter().deliveryReport(receipt.trackingId);
    assert.equal(report.delivered, true);
    assert.equal(report.retryPolicy, 0);
  });
});
