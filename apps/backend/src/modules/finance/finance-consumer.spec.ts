import { describe, expect, it, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { FinanceConsumer } from './finance-consumer.service.ts';

/**
 * The finance consumer, minus the database.
 *
 * What these prove: collections and return completions are processed, anything
 * else is ignored without touching the ledger, and malformed payloads never
 * throw out of the loop. Exactly-once semantics — the reference check against
 * existing entries — is proven by test/integration/, against Postgres, where the
 * unique reference actually races.
 */

function message(type: string, data: Record<string, unknown> = {}) {
  return {
    subject: `zipzap.cod.${type.toLowerCase()}`,
    payload: new TextEncoder().encode(
      JSON.stringify({
        id: 'evt-9',
        type,
        aggregateType: 'cod',
        aggregateId: 'cod-1',
        occurredAt: new Date().toISOString(),
        data: {
          shipmentId: 's-1',
          merchantId: 'm-1',
          currency: 'BDT',
          expectedMinor: 125_050,
          collectedMinor: 125_050,
          ...data,
        },
      }),
    ),
  };
}

describe('FinanceConsumer dispatch', () => {
  let consumer: FinanceConsumer;
  let inserted: unknown[][];

  beforeEach(async () => {
    inserted = [];
    const financeDs = {
      transaction: (fn: (manager: unknown) => Promise<unknown>) =>
        fn({
          query: async (sql: string, params: unknown[]) => {
            const paramsArray = params as unknown[];
            if (sql.includes('consumed_events')) {
              // First claim wins; the mock pretends this event is new.
              return [{ event_id: 'evt-9' }];
            }
            // INSERT is matched before the reference SELECT: the INSERT text itself contains
            // `reference_type` in its column list, so the check below would swallow it.
            if (sql.includes('INSERT INTO finance.ledger_entries')) {
              inserted.push(paramsArray);
              return [];
            }
            if (sql.includes('ledger_entries') && sql.includes('reference_type')) {
              // Reference check: no entry yet for this COD record.
              return [];
            }
            return [];
          },
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FinanceConsumer],
    })
      .useMocker(() => ({}))
      .compile()
      .catch(() => null as unknown as TestingModule);

    if (module) {
      // The container cannot inject a hand-rolled DataSource mock through useMocker cleanly for
      // this shape, so construct directly — same class, same code path.
      consumer = new FinanceConsumer(financeDs as never);
    } else {
      consumer = new FinanceConsumer(financeDs as never);
    }
  });

  it('posts one COD_COLLECTED entry for a matched collection', async () => {
    const outcome = await consumer.handle(message('CODCollected'));
    expect(outcome).toBe('processed');
    expect(inserted).toHaveLength(1);
    const params = inserted[0]!;
    // merchant, amount, currency, cod record id — in that order.
    expect(params[1]).toBe('m-1');
    expect(params[2]).toBe(125_050);
    expect(params[3]).toBe('BDT');
    expect(params[4]).toBe('cod-1');
  });

  it('posts the collected amount, not the expected amount, on partial collection', async () => {
    const outcome = await consumer.handle(
      message('CODPartialCollection', { collectedMinor: 125_000 }),
    );
    expect(outcome).toBe('processed');
    expect(inserted[0]![2]).toBe(125_000);
  });

  it('ignores anything that is not a collection or reversal event, touching nothing', async () => {
    expect(await consumer.handle(message('CODReconciled'))).toBe('ignored');
    expect(await consumer.handle(message('ShipmentCreated'))).toBe('ignored');
    expect(inserted).toHaveLength(0);
  });

  it('posts a compensating ADJUSTMENT for a return completion', async () => {
    const outcome = await consumer.handle(
      message('ReturnCompleted', { reversedMinor: 125_050, returnId: 'ret-1' }),
    );
    expect(outcome).toBe('processed');
    expect(inserted).toHaveLength(1);
    const params = inserted[0]!;
    // merchant, amount, currency, return id — in that order.
    expect(params[1]).toBe('m-1');
    expect(params[2]).toBe(125_050);
    expect(params[3]).toBe('BDT');
    expect(params[4]).toBe('cod-1');
  });

  it('ignores a zero-amount reversal — nothing collected, nothing to reverse', async () => {
    const outcome = await consumer.handle(
      message('ReturnCompleted', { reversedMinor: 0, returnId: 'ret-1' }),
    );
    expect(outcome).toBe('ignored');
    expect(inserted).toHaveLength(0);
  });

  it('never throws on a malformed payload', async () => {
    const outcome = await consumer.handle({
      subject: 'x',
      payload: new TextEncoder().encode('{nope'),
    });
    expect(outcome).toBe('malformed');
    expect(inserted).toHaveLength(0);
  });
});
