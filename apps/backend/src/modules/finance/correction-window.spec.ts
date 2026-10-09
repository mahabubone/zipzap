/**
 * The correction window — a settlement freeze that must not outrun a review's ledger correction.
 *
 * Found live, not reasoned out. The timestamps from the proof run: the review committed at .283 and
 * unblocked the merchant; the freeze was pressed at .324; the correcting ADJUSTMENT landed at .644.
 * The freeze took the over-collected row without its correction and the merchant was owed 50 poisha
 * more than the ledger said. The window is open for exactly as long as the outbox → NATS → consumer
 * hop takes, which is why a unit test written against the rules alone would never have seen it: the
 * rules were right, the ordering was not.
 *
 * This is a service test with two hand-written doubles, not a pure-logic one. What is being asserted
 * is the *sequence of calls* — read the blockers, ask what the reviews owe, refuse — and that is not
 * expressible as a function of two numbers.
 */

import { describe, expect, it } from 'vitest';
import { ReconciliationExceptionError } from '../../common/domain-error.ts';
import { CreateSettlementService } from './create-settlement.service.ts';

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const RECORD = '22222222-2222-4222-8222-222222222222';

/** Only what the service touches. A double that grows a method nobody calls stops being a double. */
function harness(options: {
  readonly blocks?: Map<string, number>;
  readonly owed?: string[];
  readonly posted?: string[];
}) {
  const asked: string[] = [];

  const cod = {
    async blocksFor(merchantId: string) {
      asked.push(`blocks:${merchantId}`);
      return options.blocks ?? new Map();
    },
    async reviewedMismatches(merchantId: string) {
      asked.push(`owed:${merchantId}`);
      return options.owed ?? [];
    },
  };

  const finance = {
    async adjustedRecordIds(_manager: unknown, ids: readonly string[]) {
      asked.push(`posted:${ids.join(',')}`);
      return new Set(options.posted ?? []);
    },
    async findUnsettledCodEntries() {
      return [];
    },
  };

  const dataSource = {
    manager: {},
    async transaction<T>(body: (manager: unknown) => Promise<T>): Promise<T> {
      return body({});
    },
  };

  const service = new CreateSettlementService(dataSource as never, finance as never, cod as never);
  return { service, asked };
}

describe('the correction window', () => {
  it('refuses the freeze while a review owes the ledger a correction', async () => {
    const { service } = harness({ owed: [RECORD], posted: [] });

    await expect(service.execute({ merchantId: MERCHANT, actorId: null })).rejects.toBeInstanceOf(
      ReconciliationExceptionError,
    );
  });

  it('says what to do about it, because the reader pressed a button and got refused', async () => {
    const { service } = harness({ owed: [RECORD], posted: [] });

    await expect(service.execute({ merchantId: MERCHANT, actorId: null })).rejects.toThrow(
      /still being corrected.*retry in a moment/is,
    );
  });

  it('refuses even when the review agrees with the rider and the correction is only 50 poisha', async () => {
    // The size of the difference is irrelevant. A 50-poisha hole is the same hole as a 50,000 one,
    // and "it was small" is exactly how the 50-poisha one ships.
    const { service } = harness({ owed: [RECORD], posted: [] });

    await expect(service.execute({ merchantId: MERCHANT, actorId: null })).rejects.toBeInstanceOf(
      ReconciliationExceptionError,
    );
  });

  it('lets the freeze through once the correction has landed', async () => {
    const { service } = harness({ owed: [RECORD], posted: [RECORD] });

    // Reaches the freeze and finds no unsettled entries — the stub says "nothing to settle", which
    // is a different refusal and proves the correction window is what let it get that far.
    await expect(service.execute({ merchantId: MERCHANT, actorId: null })).rejects.toThrow(
      /no unsettled cod collections/i,
    );
  });

  it('checks the ledger only for the reviews that actually owe something', async () => {
    // Every merchant with one unreviewed parcel would otherwise pay for a ledger round trip.
    const { service, asked } = harness({ owed: [], posted: [] });

    await service.execute({ merchantId: MERCHANT, actorId: null }).catch(() => undefined);
    expect(asked).not.toContain(`posted:${RECORD}`);
  });

  it('still refuses on an unreviewed exception before it asks about corrections', async () => {
    // Ordering matters: an unreviewed exception is the merchant's own money, a missing correction is
    // bookkeeping that will arrive on its own. Reporting them in the other order would tell an
    // operator to go and look in the wrong place first.
    const { service, asked } = harness({
      blocks: new Map([['RECONCILIATION_EXCEPTION', 1]]),
      owed: [RECORD],
      posted: [],
    });

    await expect(service.execute({ merchantId: MERCHANT, actorId: null })).rejects.toThrow(
      /unreviewed collections/i,
    );
    expect(asked.some((call) => call.startsWith('posted:'))).toBe(false);
  });

  it('reports only the corrections that are genuinely missing', async () => {
    // Two reviews land, one correction arrives first. The freeze must wait on the other, and the
    // count in the message has to be 1 — "2 are still being corrected" sends the operator to audit a
    // row that is already correct.
    const OTHER = '33333333-3333-4333-8333-333333333333';
    const { service } = harness({ owed: [RECORD, OTHER], posted: [OTHER] });

    await expect(service.execute({ merchantId: MERCHANT, actorId: null })).rejects.toThrow(
      /^1 reviewed collection/,
    );
  });
});
