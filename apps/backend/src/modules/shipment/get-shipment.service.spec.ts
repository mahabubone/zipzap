import { describe, expect, it, vi } from 'vitest';
import { GetShipmentService, PII_FIELDS } from './get-shipment.service.ts';
import { ResourceNotFoundError } from '../../common/domain-error.ts';

/**
 * Three properties, each with a privacy consequence if it breaks:
 *   1. a PII read leaves a trail;
 *   2. the trail records which FIELDS, never their VALUES;
 *   3. a stranger's shipment 404s and writes no audit row — a denied read must not become a
 *      write amplifier, and must not confirm the parcel exists.
 */

const ROW = {
  id: 'ship-1',
  tracking_code: 'ZP-8F32A1',
  status: 'CREATED',
  merchant_reference: 'order-9',
  sender_name: 'Ayesha Ahmed',
  sender_phone: '+8801700000000',
  recipient_name: 'Rahim Uddin',
  recipient_phone: '+8801800000000',
  sender_address: 'Agrabad C/A, Chattogram',
  recipient_address: 'Zindabazar, Sylhet',
  parcel_weight_grams: 1200,
  parcel_description: 'Two shirts',
  cod_amount_minor: 125050,
  cod_currency: 'BDT',
  pricing_version: 3,
  created_at: new Date('2026-10-08T00:00:00Z'),
};

const TIMELINE = [
  {
    eventType: 'ShipmentCreated',
    occurredAt: '2026-10-08T00:00:00.000Z',
    actorType: 'human',
    metadata: { zone: 'dhaka-metro' },
    correctsEventId: null,
  },
];

function harness(rows: unknown[] = [ROW], timeline: unknown[] = TIMELINE) {
  const query = vi.fn().mockResolvedValue(rows);
  const record = vi.fn().mockResolvedValue(undefined);
  // The timeline lives in the tracking module (rule 2), so the detail service
  // receives it rather than selecting it — which is why it is a stub here.
  const forShipment = vi.fn().mockResolvedValue(timeline);
  const service = new GetShipmentService(
    { query } as never,
    { record } as never,
    {
      forShipment,
    } as never,
  );
  return { service, query, record, forShipment };
}

const CONTEXT = {
  actorType: 'human' as const,
  actorId: 'sess-1',
  ip: '203.0.113.4',
  requestId: 'req-1',
};

describe('GetShipmentService', () => {
  it('returns the parcel', async () => {
    const { service } = harness();

    const detail = await service.execute('m-1', 'ship-1');

    expect(detail.trackingCode).toBe('ZP-8F32A1');
    expect(detail.recipientName).toBe('Rahim Uddin');
    expect(detail.codAmountMinor).toBe(125050);
  });

  it('returns the addresses, which were stored all along and never selected', async () => {
    const { service } = harness();

    const detail = await service.execute('m-1', 'ship-1');

    expect(detail.senderAddress).toBe('Agrabad C/A, Chattogram');
    expect(detail.recipientAddress).toBe('Zindabazar, Sylhet');
  });

  it('asks the tracking module for the timeline rather than selecting it', async () => {
    const { service, query, forShipment } = harness();

    const detail = await service.execute('m-1', 'ship-1');

    // Rule 2: `tracking.events` is another module's table. The one SQL statement
    // this service runs must not mention it.
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).not.toMatch(/tracking\./);
    expect(forShipment).toHaveBeenCalledWith('ship-1');
    expect(detail.timeline).toEqual(TIMELINE);
  });

  it('returns an empty timeline rather than failing when the log has no rows', async () => {
    const { service } = harness([ROW], []);

    const detail = await service.execute('m-1', 'ship-1');

    // A parcel whose log has not been written yet is still a parcel. Throwing
    // here would make the detail screen 500 on a real, freshly created shipment.
    expect(detail.timeline).toEqual([]);
  });

  it('returns the addresses, which were stored all along and never selected', async () => {
    const { service } = harness();

    const detail = await service.execute('m-1', 'ship-1');

    expect(detail.senderAddress).toBe('Agrabad C/A, Chattogram');
    expect(detail.recipientAddress).toBe('Zindabazar, Sylhet');
  });

  it('asks the tracking module for the timeline rather than selecting it', async () => {
    const { service, query, forShipment } = harness();

    const detail = await service.execute('m-1', 'ship-1');

    // Rule 2: `tracking.events` is another module's table. The one SQL statement
    // this service runs must not mention it.
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).not.toMatch(/tracking\./);
    expect(forShipment).toHaveBeenCalledWith('ship-1');
    expect(detail.timeline).toEqual(TIMELINE);
  });

  it('returns an empty timeline rather than failing when the log has no rows', async () => {
    const { service } = harness([ROW], []);

    const detail = await service.execute('m-1', 'ship-1');

    // A parcel whose log has not been written yet is still a parcel. Throwing
    // here would make the detail screen 500 on a real, freshly created shipment.
    expect(detail.timeline).toEqual([]);
  });

  it('scopes the read to the merchant in the WHERE clause', async () => {
    const { service, query } = harness();

    await service.execute('m-1', 'ship-1');

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('merchant_id = $2');
    expect(params).toEqual(['ship-1', 'm-1']);
  });

  it('audits the read with the actor and the target', async () => {
    const { service, record } = harness();

    await service.execute('m-1', 'ship-1', CONTEXT);

    expect(record).toHaveBeenCalledOnce();
    const entry = record.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.action).toBe('customer.record_read');
    expect(entry.actorType).toBe('human');
    expect(entry.actorId).toBe('sess-1');
    expect(entry.merchantId).toBe('m-1');
    expect(entry.targetId).toBe('ship-1');
    expect(entry.requestId).toBe('req-1');
  });

  it('records the field NAMES and never the values', async () => {
    const { service, record } = harness();

    await service.execute('m-1', 'ship-1', CONTEXT);

    const entry = record.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(entry.metadata.fields).toEqual([...PII_FIELDS]);
    // The actual contact details must not be copied into a table that outlives the shipment's
    // own retention policy.
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain('Rahim Uddin');
    expect(serialised).not.toContain('+8801800000000');
    expect(serialised).not.toContain('Ayesha Ahmed');
    expect(serialised).not.toContain('+8801700000000');
  });

  it('404s a stranger and writes no audit row', async () => {
    const { service, record } = harness([]);

    await expect(service.execute('m-other', 'ship-1', CONTEXT)).rejects.toThrow(
      ResourceNotFoundError,
    );
    // A denied read must not confirm existence and must not become a write amplifier.
    expect(record).not.toHaveBeenCalled();
  });

  it('skips the audit when no context is supplied, for internal callers', async () => {
    const { service, record } = harness();

    await service.execute('m-1', 'ship-1');

    expect(record).not.toHaveBeenCalled();
  });

  it('fails the read if the audit cannot be written', async () => {
    // A trail with a convenient gap is worse than an error: the gap is invisible until someone
    // needs it. The PII must not be returned if we cannot record who took it.
    const { service, record } = harness();
    record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.execute('m-1', 'ship-1', CONTEXT)).rejects.toThrow('audit unavailable');
  });
});
