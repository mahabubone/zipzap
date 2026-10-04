import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WebhookConsumer } from './webhook.consumer.ts';

/**
 * The fan-out, minus the queue and the database.
 *
 * What these prove: unmapped types are ignored; events without merchant identity
 * (even after the shipment fallback) are ignored, never fatal; malformed payloads
 * never throw; one job per active endpoint with a deterministic idempotent job id.
 */

function message(type: string, data: Record<string, unknown>) {
  return {
    subject: `zipzap.test.${type.toLowerCase()}`,
    payload: new TextEncoder().encode(
      JSON.stringify({
        id: 'evt-7',
        type,
        aggregateType: 'x',
        aggregateId: 'a-7',
        occurredAt: new Date().toISOString(),
        data,
      }),
    ),
  };
}

describe('WebhookConsumer fan-out', () => {
  const added: { name: string; data: Record<string, unknown>; opts: Record<string, unknown> }[] =
    [];
  let consumer: WebhookConsumer;

  const endpointsFor = vi.fn();

  beforeEach(() => {
    added.length = 0;
    endpointsFor.mockReset();
    const merchantDs = {
      transaction: (fn: (manager: unknown) => Promise<unknown>) => fn({}),
    };
    const repository = { findActiveForEvent: endpointsFor };
    const queue = {
      add: vi.fn(async (name: string, data: never, opts: never) => {
        added.push({
          name,
          data: data as Record<string, unknown>,
          opts: opts as Record<string, unknown>,
        });
      }),
    };
    const lookup = { findMerchantId: vi.fn(async () => 'm-fallback') };
    consumer = new WebhookConsumer(
      merchantDs as never,
      repository as never,
      queue as never,
      lookup as never,
    );
  });

  it('enqueues one idempotent job per active endpoint', async () => {
    endpointsFor.mockResolvedValue([
      { id: 'ep-aaaa1111', secretHash: 's1', url: 'https://a.test/hook' },
      { id: 'ep-bbbb2222', secretHash: 's2', url: 'https://b.test/hook' },
    ]);
    const outcome = await consumer.handle(
      message('DeliveryCompleted', { merchantId: 'm-1', shipmentId: 's-1' }),
    );
    expect(outcome).toBe('processed');
    expect(added).toHaveLength(2);
    expect(added[0]!.data.wireEvent).toBe('shipment.delivered');
    // Same outbox event => same job ids: redelivery dedupes on the queue.
    expect(added[0]!.opts.jobId).toBe('dlv_evt-7_ep-aaaa1:attempt-1');
    expect(added[1]!.opts.jobId).toBe('dlv_evt-7_ep-bbbb2:attempt-1');
    // Secret travels with the job so the sender can sign — never logged.
    expect(added[0]!.data.secret).toBe('s1');
  });

  it('falls back to the shipment owner when the envelope names no merchant', async () => {
    endpointsFor.mockResolvedValue([]);
    const outcome = await consumer.handle(message('DeliveryCompleted', { shipmentId: 's-9' }));
    expect(outcome).toBe('ignored');
    // The fallback ran (and found no endpoints for the resolved merchant).
    expect(endpointsFor).toHaveBeenCalledWith(
      expect.anything(),
      'm-fallback',
      'shipment.delivered',
    );
  });

  it('ignores unmapped types, missing identity, and malformed payloads', async () => {
    expect(await consumer.handle(message('SomethingElseHappened', { merchantId: 'm-1' }))).toBe(
      'ignored',
    );
    expect(await consumer.handle(message('DeliveryCompleted', {}))).toBe('ignored');
    expect(
      await consumer.handle({ subject: 'x', payload: new TextEncoder().encode('{nope') }),
    ).toBe('malformed');
    expect(added).toHaveLength(0);
  });
});
