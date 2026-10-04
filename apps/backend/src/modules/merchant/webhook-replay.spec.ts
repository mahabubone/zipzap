import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WebhookReplayService } from './webhook-replay.service.ts';
import { ResourceNotFoundError } from '../../common/domain-error.ts';

/**
 * Replay-on-demand, minus the queue and the database.
 *
 * What these prove: only terminal deliveries replay; a fresh delivery id is
 * minted (the receiver dedupes on id, so reusing it would vanish); the replay
 * carries replayOf pointing at the original; paused endpoints and strangers'
 * deliveries are rejected, never fatal to anything else.
 */

describe('WebhookReplayService', () => {
  const added: { name: string; data: Record<string, unknown>; opts: Record<string, unknown> }[] =
    [];
  let service: WebhookReplayService;

  const sourceRow = {
    endpoint_id: 'ep-1',
    merchant_id: 'm-1',
    event_type: 'shipment.delivered',
    payload: { id: 'dlv_old', type: 'shipment.delivered' },
  };
  const endpointRow = {
    id: 'ep-1',
    merchantId: 'm-1',
    url: 'https://m.test/hook',
    secretHash: 'whsec_x',
    status: 'ACTIVE',
  };

  const queryFor = vi.fn();
  const findEndpoint = vi.fn();

  beforeEach(() => {
    added.length = 0;
    queryFor.mockReset();
    findEndpoint.mockReset();
    const merchantDs = {
      transaction: (fn: (manager: unknown) => Promise<unknown>) => fn({ query: queryFor }),
    };
    const repository = { findEndpoint };
    const queue = {
      add: vi.fn(async (name: string, data: never, opts: never) => {
        added.push({
          name,
          data: data as Record<string, unknown>,
          opts: opts as Record<string, unknown>,
        });
      }),
    };
    service = new WebhookReplayService(merchantDs as never, repository as never, queue as never);
  });

  it('replays a terminal delivery with a fresh id pointing at the original', async () => {
    queryFor.mockResolvedValue([sourceRow]);
    findEndpoint.mockResolvedValue(endpointRow);

    const result = await service.replay({ merchantId: 'm-1', deliveryId: 'dlv_old' });

    expect(result.endpointId).toBe('ep-1');
    expect(result.deliveryId).not.toBe('dlv_old');
    expect(added).toHaveLength(1);
    const payload = added[0]!.data.payload as Record<string, unknown>;
    expect(payload.replayOf).toBe('dlv_old');
    expect(payload.id).toBe(result.deliveryId);
    expect(added[0]!.opts.jobId).toBe(`${result.deliveryId}-attempt-1`);
  });

  it('rejects a delivery that is not terminal', async () => {
    queryFor.mockResolvedValue([]);
    await expect(service.replay({ merchantId: 'm-1', deliveryId: 'dlv_mid' })).rejects.toThrow(
      ResourceNotFoundError,
    );
    expect(added).toHaveLength(0);
  });

  it('rejects replay onto a paused endpoint', async () => {
    queryFor.mockResolvedValue([sourceRow]);
    findEndpoint.mockResolvedValue({ ...endpointRow, status: 'PAUSED' });
    await expect(service.replay({ merchantId: 'm-1', deliveryId: 'dlv_old' })).rejects.toThrow(
      ResourceNotFoundError,
    );
    expect(added).toHaveLength(0);
  });

  it('rejects a stranger merchant — no cross-tenant replay', async () => {
    queryFor.mockResolvedValue([]);
    await expect(service.replay({ merchantId: 'm-2', deliveryId: 'dlv_old' })).rejects.toThrow(
      ResourceNotFoundError,
    );
    expect(added).toHaveLength(0);
  });
});
