import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  add,
  allocate,
  applyBasisPoints,
  format,
  money,
  multiply,
  parseMajor,
  subtract,
  sum,
  type Currency,
} from '../src/common/money.ts';

describe('money', () => {
  test('rejects a float — the rule that makes the rest of this file matter', () => {
    assert.throws(() => money(1250.5), RangeError);
    assert.throws(() => money(Number.NaN), RangeError);
    assert.throws(() => money(Number.POSITIVE_INFINITY), RangeError);
  });

  test('1250.50 taka is 125050 poisha', () => {
    assert.deepEqual(parseMajor('1250.50'), { amountMinor: 125050, currency: 'BDT' });
    assert.deepEqual(parseMajor('1250.5'), { amountMinor: 125050, currency: 'BDT' });
    assert.deepEqual(parseMajor('1250'), { amountMinor: 125000, currency: 'BDT' });
    assert.deepEqual(parseMajor('-0.07'), { amountMinor: -7, currency: 'BDT' });
  });

  test('rejects amounts it cannot represent exactly', () => {
    assert.throws(() => parseMajor('1250.555'), RangeError);
    assert.throws(() => parseMajor('abc'), RangeError);
    assert.throws(() => parseMajor(''), RangeError);
  });

  test('arithmetic is exact where floats are not', () => {
    // 0.1 + 0.2 !== 0.3 in floating point. In minor units it is exact.
    assert.equal(add(money(10), money(20)).amountMinor, 30);
    assert.equal(sum([money(1), money(2), money(3)]).amountMinor, 6);
    assert.equal(subtract(money(100), money(250)).amountMinor, -150);
    assert.equal(multiply(money(125050), 3).amountMinor, 375150);
  });

  test('refuses to combine different currencies', () => {
    // Cast, because EUR is not a supported currency yet — the point is that a cross-currency
    // sum is a runtime error rather than a silent 200.
    assert.throws(() => add(money(100, 'BDT'), money(100, 'EUR' as Currency)), RangeError);
  });

  test('multiplies by whole quantities only', () => {
    assert.throws(() => multiply(money(100), 1.5), RangeError);
  });

  test('allocate never loses or invents a minor unit', () => {
    const total = money(100);
    const shares = allocate(total, 1, 1, 1);
    assert.deepEqual(
      shares.map((share) => share.amountMinor),
      [34, 33, 33],
    );
    assert.equal(sum(shares).amountMinor, 100);
  });

  test('allocate handles an indivisible split exactly', () => {
    // 10 poisha across three shares. Every scheme that uses Math.round loses a unit.
    const shares = allocate(money(10), 1, 1, 1);
    assert.equal(sum(shares).amountMinor, 10);
  });

  test('allocate handles negatives and zero weights', () => {
    assert.equal(sum(allocate(money(-100), 1, 1)).amountMinor, -100);
    assert.throws(() => allocate(money(100), 0, 0), RangeError);
  });

  test('basis points are integer in, integer out', () => {
    assert.equal(applyBasisPoints(money(10000), 250).amountMinor, 250);
    assert.equal(applyBasisPoints(money(1), 100).amountMinor, 0);
    assert.throws(() => applyBasisPoints(money(100), 2.5), RangeError);
  });

  test('format renders thousands separators and two decimals', () => {
    assert.equal(format(money(125050)), '1,250.50');
    assert.equal(format(money(5)), '0.05');
    assert.equal(format(money(-125050)), '-1,250.50');
    assert.equal(format(money(0)), '0.00');
  });
});
