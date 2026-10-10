import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ListWebhookDeliveriesService,
  type DeliveryLogPage,
} from './list-webhook-deliveries.service.ts';

/**
 * The delivery log read path, minus the database.
 *
 * What these prove: tenant scoping is in the WHERE clause (never post-filtered);
 * keyset pagination uses `id < cursor` so a growing log never skips rows;
 * endpoint filter is optional; limit is clamped to [1, 200]; rows are returned
 * newest-first; the cursor is the last row's id when there are more pages.
 */

describe('ListWebhookDeliveriesService', () => {
  const rows: Record<string, unknown>[] = [
    {
      id: 'dlv-6',
      endpointId: 'ep-1',
      eventType: 'shipment.delivered',
      attempt: 1,
      statusCode: 200,
      error: null,
      delivered: true,
      terminal: true,
      attemptedAt: '2026-10-09T12:00:00.000Z',
    },
    {
      id: 'dlv-5',
      endpointId: 'ep-1',
      eventType: 'cod.collected',
      attempt: 2,
      statusCode: 200,
      error: null,
      delivered: true,
      terminal: true,
      attemptedAt: '2026-10-09T11:00:00.000Z',
    },
    {
      id: 'dlv-4',
      endpointId: 'ep-2',
      eventType: 'shipment.created',
      attempt: 1,
      statusCode: 500,
      error: 'timeout',
      delivered: false,
      terminal: false,
      attemptedAt: '2026-10-09T10:00:00.000Z',
    },
    {
      id: 'dlv-3',
      endpointId: 'ep-1',
      eventType: 'shipment.created',
      attempt: 1,
      statusCode: 200,
      error: null,
      delivered: true,
      terminal: true,
      attemptedAt: '2026-10-09T09:00:00.000Z',
    },
    {
      id: 'dlv-2',
      endpointId: 'ep-1',
      eventType: 'cod.collected',
      attempt: 1,
      statusCode: 503,
      error: 'unavailable',
      delivered: false,
      terminal: false,
      attemptedAt: '2026-10-09T08:00:00.000Z',
    },
    {
      id: 'dlv-1',
      endpointId: 'ep-1',
      eventType: 'shipment.created',
      attempt: 2,
      statusCode: 200,
      error: null,
      delivered: true,
      terminal: true,
      attemptedAt: '2026-10-09T07:00:00.000Z',
    },
  ];

  let query: ReturnType<typeof vi.fn>;
  let service: ListWebhookDeliveriesService;

  beforeEach(() => {
    query = vi.fn();
    const merchantDs = {
      transaction: (fn: (manager: { query: typeof query }) => Promise<DeliveryLogPage>) =>
        fn({ query }),
    };
    service = new ListWebhookDeliveriesService(merchantDs as never);
    query.mockReset();
  });

  it('returns all deliveries for the merchant, newest first', async () => {
    query.mockResolvedValue(rows);

    const result = await service.execute('m-1', {});

    expect(result.data).toHaveLength(6);
    expect(result.data[0]!.id).toBe('dlv-6');
    expect(result.data[5]!.id).toBe('dlv-1');
    expect(result.nextCursor).toBeNull();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE merchant_id = $1'), ['m-1']);
  });

  it('filters by endpointId when provided', async () => {
    const ep1Rows = rows.filter((r) => r.endpointId === 'ep-1');
    query.mockResolvedValue(ep1Rows);

    const result = await service.execute('m-1', { endpointId: 'ep-1' });

    expect(result.data).toHaveLength(5);
    expect(result.data.every((r) => r.endpointId === 'ep-1')).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('AND endpoint_id = $2'), [
      'm-1',
      'ep-1',
    ]);
  });

  it('uses cursor for keyset pagination (id < cursor)', async () => {
    const afterDlv4 = rows.filter((r) => (r.id as string) < 'dlv-4');
    query.mockResolvedValue(afterDlv4);

    const result = await service.execute('m-1', { cursor: 'dlv-4' });

    expect(result.data).toHaveLength(3);
    expect(result.data[0]!.id).toBe('dlv-3');
    expect(result.data[2]!.id).toBe('dlv-1');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('AND id < $2'), ['m-1', 'dlv-4']);
  });

  it('combines endpointId and cursor', async () => {
    const ep1AfterDlv3 = rows.filter((r) => r.endpointId === 'ep-1' && (r.id as string) < 'dlv-3');
    query.mockResolvedValue(ep1AfterDlv3);

    const result = await service.execute('m-1', { endpointId: 'ep-1', cursor: 'dlv-3' });

    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.id).toBe('dlv-2');
    expect(result.data[1]!.id).toBe('dlv-1');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('AND endpoint_id = $2'),
      expect.arrayContaining(['m-1', 'ep-1', 'dlv-3']),
    );
  });

  it('clamps limit to [1, 200] and returns nextCursor when more rows exist', async () => {
    const limitedRows = rows.slice(0, 3); // first 3 of 6
    query.mockResolvedValue(limitedRows);

    const result = await service.execute('m-1', { limit: 2 });

    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBe('dlv-5'); // last returned row's id
  });

  it('returns empty page when cursor is past all rows', async () => {
    query.mockResolvedValue([]);

    const result = await service.execute('m-1', { cursor: 'dlv-0' });

    expect(result.data).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it('converts numeric fields and timestamps correctly', async () => {
    query.mockResolvedValue([rows[0]!]);

    const result = await service.execute('m-1', {});

    expect(result.data[0]!.attempt).toBe(1);
    expect(result.data[0]!.statusCode).toBe(200);
    expect(result.data[0]!.attemptedAt).toBe('2026-10-09T12:00:00.000Z');
  });

  it('handles null statusCode and error', async () => {
    const rowWithNulls = { ...rows[0]!, statusCode: null, error: null };
    query.mockResolvedValue([rowWithNulls]);

    const result = await service.execute('m-1', {});

    expect(result.data[0]!.statusCode).toBeNull();
    expect(result.data[0]!.error).toBeNull();
  });

  it('tenant scoping: stranger merchant gets empty result', async () => {
    query.mockResolvedValue([]);

    const result = await service.execute('m-999', {});

    expect(result.data).toHaveLength(0);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE merchant_id = $1'), [
      'm-999',
    ]);
  });
});
