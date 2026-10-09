/**
 * The settlement statement, as a value. Framework-free — see rule 3.
 *
 * One settlement, presented twice: as JSON for the screen and as CSV for the download. Both come
 * from `statement()` here, which is the whole reason the plan's exit check — *"a statement
 * downloads and its totals match what the screen showed"* — is satisfiable rather than aspirational.
 *
 * Two implementations of "the statement" is the failure this file exists to prevent. A screen that
 * sums `itemsJson` one way and a CSV that sums it another will agree until the day one of them
 * learns a rule the other does not, and then a merchant is looking at two different totals for the
 * same settlement with nothing to arbitrate between them.
 *
 * Money appears as **minor units only**. There is no formatted amount anywhere in this file, on
 * purpose: a CSV cell holding `৳1,250.50` cannot be summed, and a statement whose totals disagree
 * because one column is text is the defect this whole stage is about. Minor units in the file,
 * formatting in the reader's spreadsheet.
 */

/** One line of a statement. `amountMinor` is signed: positive is owed to the merchant. */
export interface StatementLine {
  readonly entryId: string;
  readonly type: string;
  readonly direction: 1 | -1;
  readonly amountMinor: number;
  /** The ledger memo, carried through so a line can be explained without a second lookup. */
  readonly memo: string | null;
  /** When the money moved. The merchant reconciles against their bank date, not our created_at. */
  readonly occurredAt: string;
  /** The shipment this line is about, when the reference is a COD record. Null for fees. */
  readonly shipmentId: string | null;
}

export interface SettlementStatement {
  readonly reference: string;
  readonly status: string;
  readonly currency: string;
  readonly createdAt: string;
  /** Frozen at approval. The sum of `lines`, and the number the CSV's last row repeats. */
  readonly netMinor: number;
  readonly lines: ReadonlyArray<StatementLine>;
}

export interface SettlementItem {
  readonly entryId: string;
  readonly type: string;
  readonly direction: 1 | -1;
  readonly amountMinor: number;
}

export interface StatementInput {
  readonly reference: string;
  readonly status: string;
  readonly currency: string;
  readonly createdAt: string;
  readonly frozenNetMinor: number;
  readonly items: ReadonlyArray<SettlementItem>;
  /** The ledger memos and timestamps, keyed by entry id. Absent ones render as blanks. */
  readonly detailByEntry?: ReadonlyMap<
    string,
    { memo: string | null; occurredAt: string; shipmentId: string | null }
  >;
}

/**
 * Assembles the statement.
 *
 * The net is **not** recomputed from the lines. It is the frozen figure from the settlement row, and
 * that is deliberate: `frozen_net_minor` is the number the merchant agreed to be paid, and if the
 * lines no longer sum to it then one of the two is wrong — which is a fact worth surfacing, not one
 * to paper over by quietly reporting whichever number looks better. `assertStatementTotals` checks
 * it and the caller fails loudly.
 */
export function statement(input: StatementInput): SettlementStatement {
  const detail = input.detailByEntry ?? new Map();
  const lines = input.items.map((item) => {
    const extra = detail.get(item.entryId);
    return {
      entryId: item.entryId,
      type: item.type,
      direction: item.direction,
      amountMinor: item.amountMinor,
      memo: extra?.memo ?? null,
      occurredAt: extra?.occurredAt ?? input.createdAt,
      shipmentId: extra?.shipmentId ?? null,
    };
  });

  return {
    reference: input.reference,
    status: input.status,
    currency: input.currency,
    createdAt: input.createdAt,
    netMinor: input.frozenNetMinor,
    lines,
  };
}

/**
 * The invariant the exit check names: the itemised lines sum to exactly the frozen net.
 *
 * No tolerance band, because there is no tolerance band in money. A single missing poisha is worth
 * nothing on its own and worth the same single poisha every month, which is how it goes unnoticed
 * for a year.
 */
export function assertStatementTotals(statement: SettlementStatement): void {
  const sum = statement.lines.reduce(
    (total, line) => total + (line.direction === 1 ? line.amountMinor : -line.amountMinor),
    0,
  );
  if (sum !== statement.netMinor) {
    throw new Error(
      `Settlement ${statement.reference} itemises to ${sum} but was frozen at ${statement.netMinor}. ` +
        'The frozen net is a checksum of the freeze — one of the two is wrong.',
    );
  }
}

/**
 * A spreadsheet-openable CSV of the statement.
 *
 * Three decisions worth naming:
 *
 *   - **A UTF-8 BOM.** Excel on Windows reads a bare `reference,type,...` as Latin-1 and renders
 *     `৳` as mojibake, which is what a Bangladeshi merchant actually opens this in. The BOM is
 *     three bytes that make the file correct for the reader who matters.
 *   - **Minor units, and a header that says so.** `amount_minor` rather than `amount`, so nobody
 *     sums the column and believes they have ৳125,055 rather than ৳1,250.55.
 *   - **A signed `net_minor` row at the end.** The download must stand alone: a merchant who opens
 *     the CSV months later must not have to also open the app to learn what they were paid.
 *
 * `csvCell` quotes on the same three characters a spreadsheet treats as structural — comma, quote,
 * newline — rather than on "contains a comma". A reference with a comma in it is rare; a reference
 * with a comma in it that silently shifts every following column is not.
 */
export function statementCsv(statement: SettlementStatement): string {
  const header = [
    'reference',
    'status',
    'line',
    'type',
    'direction',
    'shipment_id',
    'amount_minor',
    'occurred_at',
    'memo',
  ];

  const rows = statement.lines.map((line, index) =>
    [
      statement.reference,
      statement.status,
      String(index + 1),
      line.type,
      line.direction === 1 ? 'credit' : 'debit',
      line.shipmentId ?? '',
      // Signed, so the column sums to the net without the reader needing the direction column.
      String(line.direction * line.amountMinor),
      line.occurredAt,
      line.memo ?? '',
    ]
      .map(csvCell)
      .join(','),
  );

  const total = [
    statement.reference,
    statement.status,
    '',
    'NET',
    '',
    '',
    String(statement.netMinor),
    '',
    'Agreed amount, frozen at approval. Positive is owed to the merchant.',
  ]
    .map(csvCell)
    .join(',');

  return '﻿' + [header.join(','), ...rows, total].join('\r\n') + '\r\n';
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
