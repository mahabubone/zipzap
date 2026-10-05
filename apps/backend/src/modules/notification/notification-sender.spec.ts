import { describe, expect, it, beforeEach } from 'vitest';
import { sendSmsAttempt, type SmsJob } from './notification-sender.service.ts';
import type { SmsChannel } from './provider/mimsms.adapter.ts';

/**
 * One SMS attempt, minus the network and the database.
 *
 * What these prove: a delivered DLR lands terminally delivered; a handset-off
 * DLR (policy 3) retries with the ladder delay; a policy-0 failure dead-letters;
 * a send throw retries; every outcome writes exactly one immutable delivery row.
 */

const JOB: SmsJob = {
  messageId: 'msg-1',
  eventId: 'evt-8',
  recipient: '+8801712345678',
  body: 'ZipZap: parcel ZP-1 delivered.',
};

describe('sendSmsAttempt', () => {
  const inserted: Record<string, unknown>[] = [];
  const updated: Array<{ id: string; status: string }> = [];

  const repository = {
    insertDelivery: async (_manager: unknown, entity: Record<string, unknown>) => {
      inserted.push(entity);
      return entity;
    },
  };
  const notificationsDs = {
    transaction: (fn: (m: unknown) => Promise<unknown>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          if (sql.includes('SELECT id, status FROM notification.messages')) {
            return [{ id: 'msg-1', status: 'QUEUED' }];
          }
          if (sql.includes('UPDATE notification.messages')) {
            updated.push({ id: String(params[0]), status: String(params[1] ?? 'SENT') });
          }
          return [];
        },
      }),
  };

  const channelFor = (
    send: () => Promise<
      never | { trackingId: string; segments: number; providerReference: string }
    >,
    report: () => Promise<{
      dlrName: string | null;
      retryPolicy: number | null;
      delivered: boolean;
    }>,
  ): SmsChannel => ({
    name: 'sms',
    send: send as never,
    deliveryReport: report as never,
  });

  beforeEach(() => {
    inserted.length = 0;
    updated.length = 0;
  });

  it('delivered DLR lands terminally delivered', async () => {
    const channel = channelFor(
      async () => ({ trackingId: 'TRX1', segments: 1, providerReference: 'TRX1' }),
      async () => ({ dlrName: 'Delivered', retryPolicy: 0, delivered: true }),
    );
    const outcome = await sendSmsAttempt(
      notificationsDs as never,
      repository as never,
      channel,
      JOB,
      1,
    );
    expect(outcome).toEqual({
      delivered: true,
      terminal: true,
      nextDelayMs: null,
      carrierPolicy: 0,
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ delivered: true, terminal: true, attempt: 1 });
    expect(updated).toEqual([{ id: 'msg-1', status: 'SENT' }]);
  });

  it('handset-off DLR (policy 3) retries with the ladder delay behind it', async () => {
    const channel = channelFor(
      async () => ({ trackingId: 'TRX2', segments: 1, providerReference: 'TRX2' }),
      async () => ({ dlrName: 'Absent subscriber for SM', retryPolicy: 3, delivered: false }),
    );
    const outcome = await sendSmsAttempt(
      notificationsDs as never,
      repository as never,
      channel,
      JOB,
      1,
    );
    expect(outcome.delivered).toBe(false);
    expect(outcome.terminal).toBe(false);
    expect(outcome.nextDelayMs).toBe(300_000);
    expect(outcome.carrierPolicy).toBe(3);
  });

  it('policy-0 failure dead-letters immediately', async () => {
    const channel = channelFor(
      async () => ({ trackingId: 'TRX3', segments: 1, providerReference: 'TRX3' }),
      async () => ({ dlrName: 'Barred subscriber', retryPolicy: 0, delivered: false }),
    );
    const outcome = await sendSmsAttempt(
      notificationsDs as never,
      repository as never,
      channel,
      JOB,
      1,
    );
    expect(outcome).toEqual({
      delivered: false,
      terminal: true,
      nextDelayMs: null,
      carrierPolicy: 0,
    });
    expect(inserted[0]).toMatchObject({ delivered: false, terminal: true });
  });

  it('a send throw retries — the provider is down, not the message', async () => {
    const channel = channelFor(
      async () => {
        throw new Error('socket hangup');
      },
      async () => ({ dlrName: null, retryPolicy: null, delivered: false }),
    );
    const outcome = await sendSmsAttempt(
      notificationsDs as never,
      repository as never,
      channel,
      JOB,
      2,
    );
    expect(outcome.delivered).toBe(false);
    expect(outcome.terminal).toBe(false);
    expect(outcome.nextDelayMs).toBe(900_000);
    expect(inserted[0]).toMatchObject({ delivered: false, terminal: false });
  });

  it('a send throw past the last rung is terminal and fails the message visibly', async () => {
    const channel = channelFor(
      async () => {
        throw new Error('socket hangup');
      },
      async () => ({ dlrName: null, retryPolicy: null, delivered: false }),
    );
    const outcome = await sendSmsAttempt(
      notificationsDs as never,
      repository as never,
      channel,
      JOB,
      6,
    );
    expect(outcome).toEqual({
      delivered: false,
      terminal: true,
      nextDelayMs: null,
      carrierPolicy: null,
    });
    expect(inserted[0]).toMatchObject({ delivered: false, terminal: true, attempt: 6 });
    // The message row moves QUEUED -> FAILED: a QUEUED row that will never send is a lie.
    expect(updated).toEqual([{ id: 'msg-1', status: 'FAILED' }]);
  });
});
