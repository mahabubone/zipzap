/**
 * What the bulk-import checkpoint shows, decided as plain data.
 *
 * Framework-free so `scripts/verify-bulk-preview.mjs` can assert it. The
 * decision that matters is which rows reach the screen: `upload` returns every
 * row, and a 10,000-row file is a 10,000-element array. Rendering all of them
 * produces a table no human reads and a browser that stalls, so the merchant
 * sees the rows they can act on and a count for the rest.
 */

import type { BulkJob, BulkPreviewRow } from '@zipzap/api-client';

/** A row is a problem if it will not become a parcel on this run. */
export function isProblem(row: BulkPreviewRow): boolean {
  return row.outcome === 'FAILED';
}

export interface PreviewSummary {
  readonly total: number;
  readonly ready: number;
  readonly problems: number;
  /** Rows rendered in the table: every problem, then filler up to the cap. */
  readonly shown: ReadonlyArray<BulkPreviewRow>;
  /** How many ready rows the cap left out. */
  readonly hiddenReady: number;
  /** Nothing is wrong: the import can be accepted as it stands. */
  readonly clean: boolean;
}

/**
 * Rows shown before the table stops. Chosen to fill a screen without scrolling:
 * a merchant needs every failure and a representative sample of the rest.
 */
const ROW_CAP = 50;

export function summarisePreview(rows: ReadonlyArray<BulkPreviewRow>): PreviewSummary {
  const problems = rows.filter(isProblem);
  const ready = rows.filter((r) => !isProblem(r));
  // Problems first, always in full. A merchant who scrolled past a failure
  // because the file had 400 good rows above it has been told the wrong thing.
  const shown = [...problems, ...ready].slice(0, Math.max(ROW_CAP, problems.length));
  return {
    total: rows.length,
    ready: ready.length,
    problems: problems.length,
    shown,
    hiddenReady: ready.length - Math.min(ready.length, shown.length - problems.length),
    clean: problems.length === 0,
  };
}

/** Every distinct failure reason, most frequent first — the "what did I get wrong" list. */
export function reasonsByFrequency(
  rows: ReadonlyArray<BulkPreviewRow>,
): ReadonlyArray<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.reason === null) continue;
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** Has the job stopped moving? Drives when the console stops polling. */
export function isTerminal(job: BulkJob): boolean {
  return (
    job.status === 'COMPLETED' || job.status === 'COMPLETED_WITH_ERRORS' || job.status === 'FAILED'
  );
}

/**
 * `COMPLETED_WITH_ERRORS` is a SUCCESS. A file where 9,997 rows imported and 3
 * failed is not a failed import — it is a finished import with a result file,
 * and treating it as an error teaches merchants that bulk import does not work.
 */
export function jobSucceeded(job: BulkJob): boolean {
  return job.status === 'COMPLETED' || job.status === 'COMPLETED_WITH_ERRORS';
}

/** 0-100, for the progress bar. Clamped: processed can exceed total on a replay. */
export function progressPercent(job: BulkJob): number {
  if (job.totalRows === 0) return 100;
  return Math.max(0, Math.min(100, Math.round((job.processedRows / job.totalRows) * 100)));
}

/** What to call the job in a sentence. One place, so the screen cannot disagree with itself. */
export function jobHeadline(job: BulkJob): string {
  switch (job.status) {
    case 'PENDING':
    case 'VALIDATING':
      return 'Reading your file…';
    case 'PREVIEW':
      return 'Check the file before importing';
    case 'PROCESSING':
      return `Creating parcels — ${job.processedRows} of ${job.totalRows}`;
    case 'COMPLETED':
      return `All ${job.succeededRows} parcels created`;
    case 'COMPLETED_WITH_ERRORS':
      return `Finished: ${job.succeededRows} created, ${job.failedRows + job.skippedRows} not created`;
    case 'FAILED':
      return 'The import failed';
    default:
      return 'Unknown status';
  }
}

/** The CSV header a merchant needs in order to build a file we can read. */
export const TEMPLATE_HEADER =
  'invoice,recipient_name,recipient_phone,recipient_address,destination_area,cod_amount,parcel_weight,item_description';

/** One worked example, so nobody has to guess the phone format or the units. */
export const TEMPLATE_ROW =
  'INV-1001,Rahim Uddin,+8801810000001,"Agrabad C/A, Chattogram",dhaka-metro,125050,1200,Two shirts';

export function templateCsv(): string {
  return `${TEMPLATE_HEADER}\n${TEMPLATE_ROW}\n`;
}
