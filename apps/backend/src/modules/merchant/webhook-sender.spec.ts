import { describe, expect, it, beforeEach } from 'vitest';
import { sendAttempt, type WebhookJob } from './webhook-sender.service.ts';

/**
 * One attempt, minus the network and the database.
 *
 * What these prove: the signature headers ride on the documented names; the raw
 * body is what gets signed; a 2xx delivers terminally; a 500 retries with the
 * ladder delay; a 400 is terminal with no next delay; a timeout retries; every
 * outcome writes exactly one immutable delivery row.
 */

const JOB: WebhookJob = {
  deliveryId: 'dlv_1',
  endpointId: 'ep-1',
  merchantId: 'm-1',
  url: 'https://merchant.test/hook',
  secret: 'whsec_test',
  wireEvent: 'shipment.delivered',
  payload: { id: 'dlv_1', type: 'shipment.delivered' },
};

describe('sendAttempt', () => {
  const inserted: Record<string, unknown>[] = [];
  let seen: { url: string; headers: Record<string, string>; body: string } | null;

  const repository = {
    insertDelivery: async (_manager: unknown, entity: Record<string, unknown>) => {
      inserted.push(entity);
      return entity;
    },
  };
  const merchantDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn({}) };

  const fetcherFor =
    (status: number | 'timeout') =>
    async (url: string, init: { headers: Record<string, string>; body: string }) => {
      seen = { url, headers: init.headers, body: init.body };
      if (status === 'timeout') throw new Error('socket hangup');
      return { status, text: async () => 'ok' };
    };

  beforeEach(() => {
    inserted.length = 0;
    seen = null;
  });

  it('signs the raw body and delivers terminally on 2xx', async () => {
    const outcome = await sendAttempt(
      merchantDs as never,
      repository as never,
      JOB,
      1,
      fetcherFor(200) as never,
    );
    expect(outcome).toEqual({
      delivered: true,
      terminal: true,
      statusCode: 200,
      nextDelayMs: null,
    });
    expect(seen!.headers['ZipZap-Event']).toBe('shipment.delivered');
    expect(seen!.headers['ZipZap-Delivery']).toBe('dlv_1');
    expect(seen!.headers['ZipZap-Attempt']).toBe('1');
    expect(seen!.headers['ZipZap-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(seen!.body).toBe(JSON.stringify(JOB.payload));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ delivered: true, terminal: true, attempt: 1 });
  });

  it('a 500 retries with the ladder delay behind it', async () => {
    const outcome = await sendAttempt(
      merchantDs as never,
      repository as never,
      JOB,
      1,
      fetcherFor(500) as never,
    );
    expect(outcome.delivered).toBe(false);
    expect(outcome.terminal).toBe(false);
    expect(outcome.nextDelayMs).toBe(300_000);
    expect(inserted[0]).toMatchObject({ delivered: false, terminal: false, statusCode: 500 });
  });

  it('a 400 is terminal with no next delay — the payload will not become valid', async () => {
    const outcome = await sendAttempt(
      merchantDs as never,
      repository as never,
      JOB,
      1,
      fetcherFor(400) as never,
    );
    expect(outcome).toEqual({
      delivered: false,
      terminal: true,
      statusCode: 400,
      nextDelayMs: null,
    });
  });

  it('a timeout retries from the second rung', async () => {
    const outcome = await sendAttempt(
      merchantDs as never,
      repository as never,
      JOB,
      2,
      fetcherFor('timeout') as never,
    );
    expect(outcome.statusCode).toBeNull();
    expect(outcome.terminal).toBe(false);
    expect(outcome.nextDelayMs).toBe(900_000);
  });

  it('past the ladder end is terminal even for a 500', async () => {
    const outcome = await sendAttempt(
      merchantDs as never,
      repository as never,
      JOB,
      6,
      fetcherFor(500) as never,
    );
    expect(outcome).toEqual({
      delivered: false,
      terminal: true,
      statusCode: 500,
      nextDelayMs: null,
    });
  });
});
