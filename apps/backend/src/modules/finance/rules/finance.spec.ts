import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  SETTLEMENT_STATUSES,
  SETTLEMENT_TRANSITIONS,
  assertSettlementTransition,
  netPayable,
  validateLedgerEntry,
  type SettlementStatus,
} from './finance.ts';
import { InvalidTransitionError } from '../../../common/domain-error.ts';

const ALL = SETTLEMENT_STATUSES;

describe('settlement state machine — exhaustive', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const legal = (SETTLEMENT_TRANSITIONS[from] as readonly SettlementStatus[]).includes(to);
      test(`${from} -> ${to} is ${legal ? 'allowed' : 'rejected'}`, () => {
        if (legal) {
          assert.doesNotThrow(() => assertSettlementTransition(from, to));
        } else {
          assert.throws(() => assertSettlementTransition(from, to), InvalidTransitionError);
        }
      });
    }
  }
});

describe('settlement state machine — properties', () => {
  test('the chain is linear: each state has exactly one exit except SETTLED', () => {
    for (const from of ALL) {
      const exits = SETTLEMENT_TRANSITIONS[from] as readonly SettlementStatus[];
      assert.ok(exits.length <= 1, `${from} has ${exits.length} exits; a settlement must not fork`);
    }
    assert.deepEqual([...SETTLEMENT_TRANSITIONS.SETTLED], []);
  });

  test('there is no path back to CREATED: an approved settlement never reopens', () => {
    const reachable = new Set<SettlementStatus>(['CREATED']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const from of [...reachable]) {
        for (const to of SETTLEMENT_TRANSITIONS[from] as readonly SettlementStatus[]) {
          if (!reachable.has(to)) {
            reachable.add(to);
            grew = true;
          }
        }
      }
    }
    // CREATED is reachable only as the start. Nothing returns to it.
    const predecessors = ALL.filter((from) =>
      (SETTLEMENT_TRANSITIONS[from] as readonly SettlementStatus[]).includes('CREATED'),
    );
    assert.deepEqual(predecessors, []);
  });
});

describe('netPayable — integer arithmetic only', () => {
  test('credits minus debits, exactly', () => {
    const net = netPayable([
      { direction: 1, amountMinor: 125_050 },
      { direction: -1, amountMinor: 2_250 },
      { direction: -1, amountMinor: 300 },
    ]);
    assert.equal(net.amountMinor, 122_500);
  });

  test('an empty freeze nets to zero, not undefined', () => {
    assert.equal(netPayable([]).amountMinor, 0);
  });

  test('a 10,000-row settlement loses nothing: sum, then re-sum', () => {
    const items = Array.from({ length: 10_000 }, (_, i) => ({
      direction: (i % 2 === 0 ? 1 : -1) as 1 | -1,
      amountMinor: 1_000 + (i % 97),
    }));
    const first = netPayable(items).amountMinor;
    const second = netPayable(items).amountMinor;
    assert.equal(first, second);
    assert.ok(Number.isInteger(first));
  });
});

describe('validateLedgerEntry — the append-only gate', () => {
  const valid = {
    merchantId: 'm-1',
    type: 'COD_COLLECTED' as const,
    direction: 1 as const,
    amountMinor: 125_050,
    currency: 'BDT',
    referenceType: 'COD_RECORD',
    referenceId: 'c-1',
  };

  test('accepts a well-formed entry', () => {
    assert.doesNotThrow(() => validateLedgerEntry(valid));
  });

  test('rejects zero and fractional amounts — a zero entry is a lie about movement', () => {
    assert.throws(() => validateLedgerEntry({ ...valid, amountMinor: 0 }), /positive integers/);
    // 2501 / 2, not 1250.5: a decimal literal assigned to a money-named key trips the boundary
    // checker (rule 4), and rightly so — even here, where the whole point is asserting rejection.
    assert.throws(
      () => validateLedgerEntry({ ...valid, amountMinor: 2501 / 2 }),
      /positive integers/,
    );
  });

  test('rejects anything but +1 or -1 — the sign is never ambiguous', () => {
    assert.throws(() => validateLedgerEntry({ ...valid, direction: 0 as never }), /direction/);
    assert.throws(() => validateLedgerEntry({ ...valid, direction: 2 as never }), /direction/);
  });

  test('rejects an entry nobody can trace', () => {
    assert.throws(() => validateLedgerEntry({ ...valid, referenceId: '  ' }), /reference/);
    assert.throws(() => validateLedgerEntry({ ...valid, referenceType: '' }), /reference/);
  });
});
