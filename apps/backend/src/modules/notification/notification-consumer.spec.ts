import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotificationConsumer } from './notification.consumer.ts';

/**
 * The fan-out, minus the queue and the database.
 *
 * What these prove: unmapped types are ignored; events without shipment identity
 * are ignored, never fatal; unknown shipments are ignored; the same outbox event
 * redelivered converges on the existing message row (duplicate); malformed
 * payloads never throw; and a merchant who opted out of an event gets no message
 * for it — with no row left behind in their history.
 */

function message(type: string, data: Record<string, unknown>, id = 'evt-8') {
  return {
    subject: `zipzap.test.${type.toLowerCase()}`,
    payload: new TextEncoder().encode(
      JSON.stringify({
        id,
        type,
        aggregateType: 'x',
        aggregateId: 'a-8',
        occurredAt: new Date().toISOString(),
        data,
      }),
    ),
  };
}

describe('NotificationConsumer fan-out', () => {
  const added: { name: string; data: Record<string, unknown>; opts: Record<string, unknown> }[] =
    [];
  let consumer: NotificationConsumer;

  const findMessageByDedupe = vi.fn();
  const insertMessage = vi.fn();
  const findRecipient = vi.fn();
  const findMerchantId = vi.fn();
  const findPreferences = vi.fn();

  beforeEach(() => {
    added.length = 0;
    findMessageByDedupe.mockReset();
    insertMessage.mockReset();
    findRecipient.mockReset();
    findMerchantId.mockReset();
    findPreferences.mockReset();
    // Default-on: an account that has never touched its preferences is an account that gets told.
    findMerchantId.mockResolvedValue('m-1');
    findPreferences.mockResolvedValue([]);
    const notificationsDs = {
      transaction: (fn: (manager: unknown) => Promise<unknown>) => fn({}),
    };
    const repository = { findMessageByDedupe, insertMessage, findPreferences };
    const queue = {
      add: vi.fn(async (name: string, data: never, opts: never) => {
        added.push({
          name,
          data: data as Record<string, unknown>,
          opts: opts as Record<string, unknown>,
        });
      }),
    };
    const lookup = { findRecipient, findMerchantId };
    consumer = new NotificationConsumer(
      notificationsDs as never,
      repository as never,
      queue as never,
      lookup as never,
    );
  });

  it('enqueues one idempotent job for the recipient', async () => {
    findRecipient.mockResolvedValue({ name: 'R', phone: '+8801712345678' });
    findMessageByDedupe.mockResolvedValue(null);
    insertMessage.mockImplementation(async (_m: unknown, e: { id: string }) => ({ id: e.id }));

    const outcome = await consumer.handle(message('DeliveryCompleted', { shipmentId: 's-1' }));
    expect(outcome).toBe('processed');
    expect(added).toHaveLength(1);
    expect(added[0]!.data.recipient).toBe('+8801712345678');
    expect(added[0]!.opts.jobId).toBe('evt-8:sms:+8801712345678-attempt-1');
  });

  it('a redelivered event converges on the existing message — duplicate', async () => {
    findRecipient.mockResolvedValue({ name: 'R', phone: '+8801712345678' });
    findMessageByDedupe.mockResolvedValue({ id: 'msg-1' });

    const outcome = await consumer.handle(message('DeliveryCompleted', { shipmentId: 's-1' }));
    expect(outcome).toBe('duplicate');
    expect(added).toHaveLength(0);
  });

  it('ignores unmapped types, missing identity, unknown shipments, malformed payloads', async () => {
    expect(await consumer.handle(message('SomethingElseHappened', { shipmentId: 's-1' }))).toBe(
      'ignored',
    );
    expect(await consumer.handle(message('DeliveryCompleted', {}))).toBe('ignored');
    findRecipient.mockResolvedValue(null);
    expect(await consumer.handle(message('DeliveryCompleted', { shipmentId: 's-9' }))).toBe(
      'ignored',
    );
    expect(
      await consumer.handle({ subject: 'x', payload: new TextEncoder().encode('{nope') }),
    ).toBe('malformed');
    expect(added).toHaveLength(0);
  });

  it('resolves the shipment from aggregateId when the payload names no parcel', async () => {
    findRecipient.mockResolvedValue({ name: 'R', phone: '+8801712345678' });
    findMessageByDedupe.mockResolvedValue(null);
    insertMessage.mockImplementation(async (_m: unknown, e: { id: string }) => ({ id: e.id }));

    const outcome = await consumer.handle({
      subject: 'zipzap.shipment.created',
      payload: new TextEncoder().encode(
        JSON.stringify({
          id: 'evt-9',
          type: 'ShipmentCreated',
          aggregateType: 'shipment',
          aggregateId: 's-agg-1',
          occurredAt: new Date().toISOString(),
          data: { merchantId: 'm-1', trackingCode: 'ZP-1' },
        }),
      ),
    });
    expect(outcome).toBe('processed');
    expect(added).toHaveLength(1);
  });

  it('sends nothing at all for an event the merchant has opted out of', async () => {
    findRecipient.mockResolvedValue({ name: 'R', phone: '+8801712345678' });
    findMessageByDedupe.mockResolvedValue(null);
    findPreferences.mockResolvedValue([{ eventType: 'DeliveryCompleted', enabled: false }]);

    const outcome = await consumer.handle(message('DeliveryCompleted', { shipmentId: 's-1' }));

    expect(outcome).toBe('ignored');
    expect(added).toHaveLength(0);
    // The message row matters as much as the send: a muted event that still wrote history would
    // show a merchant messages they told us not to send.
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it('opts out of one event without muting the others', async () => {
    findRecipient.mockResolvedValue({ name: 'R', phone: '+8801715678' });
    findMessageByDedupe.mockResolvedValue(null);
    insertMessage.mockImplementation(async (_m: unknown, e: { id: string }) => ({ id: e.id }));
    findPreferences.mockResolvedValue([{ eventType: 'DeliveryCompleted', enabled: false }]);

    expect(await consumer.handle(message('DeliveryCompleted', { shipmentId: 's-1' }))).toBe(
      'ignored',
    );
    expect(
      await consumer.handle(message('DeliveryOutForDelivery', { shipmentId: 's-1' }, 'evt-10')),
    ).toBe('processed');
    expect(added).toHaveLength(1);
  });

  it('does not notify when the parcel has no owner to have expressed a preference', async () => {
    findRecipient.mockResolvedValue({ name: 'R', phone: '+8801712345678' });
    findMessageByDedupe.mockResolvedValue(null);
    findMerchantId.mockResolvedValue(null);

    const outcome = await consumer.handle(message('DeliveryCompleted', { shipmentId: 's-1' }));

    // Sending on a failed lookup is the wrong default: the message is irreversible and the
    // preference that would have stopped it may well exist on the other side.
    expect(outcome).toBe('ignored');
    expect(added).toHaveLength(0);
  });
});
