/**
 * Money in, money out: parsing what a merchant typed, and presenting what the ledger says.
 * Pure, no framework — testable without a browser.
 *
 * The one rule everything here serves: **show the number, then show why.** A balance alone is an
 * assertion; a balance with its itemisation is a claim the reader can check. Every function here
 * takes the raw API shape and returns something a person can read, so the arithmetic happens once
 * and in one place rather than in a JSX expression nobody can test.
 *
 * Minor units throughout, per ADR-0009. No float appears in this file and none may be added: a
 * formatted `৳1,250.50` is fine to *display* and must never be an input to a sum.
 */

import type { BalanceLine, CodException, MerchantBalance } from '@zipzap/api-client';
import { formatMinor } from '@zipzap/web-kit';

/**
 * The parsed amount as a bare integer, for callers that only want the number.
 *
 * A convenience over `parseAmount`, not a second parser: it returns `null` rather than guessing, so
 * a caller that ignores the error gets `null` and cannot quietly charge ৳0 for a mistyped ৳1250.
 */
export function parseAmountMinor(typed: string): number | null {
  return parseAmount(typed).minor;
}

/**
 * Parsing a typed amount into minor units. Integer arithmetic only — see ADR-0009.
 *
 * This exists because `Math.round(Number(x) * 100)` is not safe, and it is not safe in a way that
 * looks fine. The rounding direction comes from the binary representation of the double, so the same
 * expression rounds 1.005 DOWN to 100 and 8.115 UP to 812. A create form that used it accepted an
 * amount and charged a different one, and nothing about the input looked wrong.
 *
 * Here the decimal digits are taken as text and assembled as an integer. There is no double in the
 * path at all, so there is nothing to round.
 */

export interface ParsedAmount {
  /** null when the text is not a usable amount. Never a guess. */
  readonly minor: number | null;
  readonly error: string | null;
}

/** ৳99,999,999.99. Beyond this a minor-unit count stops being safely representable as a JS number. */
const MAX_MAJOR = 99_999_999;

export function parseAmount(typed: string): ParsedAmount {
  const cleaned = typed.replace(/[\s, ]/g, '');
  if (cleaned === '') return { minor: 0, error: null };

  // Either side of the point may be empty, because a merchant types `.50` and `12.` while still
  // typing and neither should flash an error mid-keystroke.
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return { minor: null, error: 'Enter an amount like 1250.55' };

  const [, wholePart = '', fractionPart = ''] = match;
  if (wholePart === '' && fractionPart === '') {
    return { minor: null, error: 'Enter an amount like 1250.55' };
  }
  if (fractionPart.length > 2) {
    return { minor: null, error: 'Use at most 2 decimal places — the poisha is the smallest unit' };
  }

  const whole = wholePart === '' ? 0 : Number(wholePart);
  if (!Number.isSafeInteger(whole) || whole > MAX_MAJOR) {
    return { minor: null, error: 'That amount is too large' };
  }

  const padded = fractionPart.padEnd(2, '0');
  const fraction = padded === '' ? 0 : Number(padded);
  const minor = whole * 100 + fraction;
  if (!Number.isSafeInteger(minor)) return { minor: null, error: 'That amount is too large' };

  return { minor, error: null };
}

/** One readable row of the breakdown. */
export interface BalanceRow {
  readonly label: string;
  /** Signed: negative reduces what the merchant is owed. */
  readonly amountMinor: number;
  readonly outgoing: boolean;
  /** How many ledger rows are behind it, so a ৳1 disagreement is traceable. */
  readonly entries: number;
}

/**
 * The labels a merchant reads, not the enum names.
 *
 * `COD_COLLECTED` on screen tells a merchant nothing; "Cash collected from recipients" tells them
 * what it is and where it came from. The backend's vocabulary is for the backend.
 */
const LINE_LABELS: Readonly<Record<string, string>> = {
  COD_COLLECTED: 'Cash collected from recipients',
  DELIVERY_FEE: 'Delivery charges',
  COD_FEE: 'Cash-on-delivery fees',
  RETURN_FEE: 'Return charges',
  ADJUSTMENT: 'Adjustments',
  SETTLEMENT_PAYOUT: 'Paid out to you',
};

/**
 * The breakdown, in the order the API sent it.
 *
 * Order is preserved rather than re-sorted because the server already put "paid out" last
 * deliberately — see `BALANCE_LINE_ORDER` in the finance rules. Re-sorting here would undo a
 * decision made where the knowledge is.
 */
export function balanceRows(lines: ReadonlyArray<BalanceLine>): ReadonlyArray<BalanceRow> {
  return lines.map((line) => ({
    label: LINE_LABELS[line.type] ?? line.type,
    amountMinor: line.direction * line.amountMinor,
    outgoing: line.direction === -1,
    entries: line.entries,
  }));
}

/**
 * The headline, in words.
 *
 * "You are owed ৳X" and "We owe you ৳X" are the same number and completely different sentences.
 * A negative balance means the platform is in the merchant's debt — an overpayment — and wording it
 * as "you are owed −৳500" is technically true and practically confusing.
 */
export function balanceHeadline(
  balanceMinor: number,
  currency: string,
): { readonly amount: string; readonly phrasing: string } {
  return {
    amount: formatMinor(balanceMinor, currency),
    phrasing:
      balanceMinor < 0
        ? 'We owe you — an overpayment, settled from your next invoice'
        : 'You are owed',
  };
}

/**
 * How many collections are waiting on a human.
 *
 * Only `RECONCILIATION_EXCEPTION` and `SETTLEMENT_HOLD` count. `COD_EXPECTED` means cash has not
 * been handed over yet, which is nobody's fault and is not a queue — lumping it in would tell a
 * merchant twelve parcels are "blocked" when the riders are simply still driving.
 */
export function needsReview(balance: MerchantBalance): number {
  return balance.blocked
    .filter((b) => b.status === 'RECONCILIATION_EXCEPTION' || b.status === 'SETTLEMENT_HOLD')
    .reduce((total, b) => total + b.count, 0);
}

/** One exception row, ready to render: the disagreement, signed and named. */
export interface ExceptionLine {
  /** Signed: positive means the rider took too much. */
  readonly signedMinor: number;
  readonly signed: string;
  /** A sentence, because "difference 50" tells a reviewer nothing about what to decide. */
  readonly verdict: string;
}

/**
 * One exception, in the terms a reviewer decides on.
 *
 * Over-collection and shortfall are the same arithmetic and completely different conversations.
 * A rider handed back MORE than the parcel was quoted is a problem — that is money leaving the
 * merchant. A rider handed back LESS is a delivery that fell short. Showing both as a signed number
 * with no verdict would make the first look like a windfall, which is exactly backwards.
 */
export function exceptionLine(item: CodException): ExceptionLine {
  const difference = item.differenceMinor;
  const magnitude = formatMinor(Math.abs(difference), item.currency);
  return {
    signedMinor: difference,
    signed: difference > 0 ? `+${magnitude}` : difference < 0 ? `−${magnitude}` : '৳0.00',
    verdict:
      difference > 0
        ? 'collected more than quoted'
        : difference < 0
          ? 'collected less than quoted'
          : 'matches the quote',
  };
}

/**
 * Basis points as a percentage, for the rate card's `180 bps` rows.
 *
 * One decimal place, and no trailing `.0`: a card saying "5.0%" and one saying "5%" mean the same
 * thing and only the second looks like a person wrote it.
 */
export function bps(percent: number): string {
  const value = percent / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
