/**
 * Bulk import rules. Framework-free: no @nestjs, no typeorm, no class-validator.
 *
 * Two pure decisions live here:
 *
 * 1. CSV parsing: RFC-4180-ish (quoted fields, escaped quotes, CRLF). No dependency —
 *    a parser is ~40 lines and the failure modes are ours to name. XLSX is out of
 *    scope for this slice: CSV in, CSV out; the doc names XLSX as later.
 * 2. Row validation + preview: every row validates to either READY or a named
 *    failure BEFORE anything inserts. The preview is the human checkpoint — the
 *    first upload always has a column-mapping mistake, and 10,000 mis-mapped
 *    shipments is a support incident.
 *
 * Idempotency is on merchant invoice reference, not row number: re-uploading a
 * corrected file skips existing invoices (SKIPPED_DUPLICATE) instead of doubling
 * 10,000 parcels.
 */

export const BULK_COLUMNS = [
  'invoice',
  'recipient_name',
  'recipient_phone',
  'recipient_address',
  'destination_area',
  'cod_amount',
  'parcel_weight',
  'item_description',
  'delivery_note',
] as const;

export type BulkColumn = (typeof BULK_COLUMNS)[number];

/** Job lifecycle: upload → validate → human preview → chunked processing → done. */
export const BULK_JOB_STATUSES = [
  'PENDING',
  'VALIDATING',
  'PREVIEW',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'COMPLETED_WITH_ERRORS',
] as const;

export type BulkJobStatus = (typeof BULK_JOB_STATUSES)[number];

export type RowOutcome =
  | { readonly kind: 'READY' }
  | { readonly kind: 'FAILED'; readonly reason: string }
  | { readonly kind: 'SKIPPED_DUPLICATE'; readonly reason: string };

export interface ParsedRow {
  readonly lineNumber: number;
  readonly fields: Record<string, string>;
}

/** Minimal CSV parse: quoted fields, doubled quotes, CRLF/LF. Throws on unbalanced quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  // `atEnd` is post-consume: only the final newline's empty row is skipped.
  // Checking pre-consume misfires on a lone "\n" (i=0 < length=1) and keeps it.
  const pushRow = (atEnd: boolean): void => {
    pushField();
    if (row.length === 1 && row[0] === '' && atEnd) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += char;
        i += 1;
      }
    } else if (char === '"') {
      inQuotes = true;
      i += 1;
    } else if (char === ',') {
      pushField();
      i += 1;
    } else if (char === '\r') {
      i += text[i + 1] === '\n' ? 2 : 1;
      pushRow(i >= text.length);
    } else if (char === '\n') {
      i += 1;
      pushRow(i >= text.length);
    } else {
      field += char;
      i += 1;
    }
  }
  if (inQuotes) throw new Error('Unbalanced quote in CSV input.');
  if (field !== '' || row.length > 0) pushRow(true);
  return rows;
}

/** Header row -> column index. Unknown columns are ignored; missing required ones fail. */
export function mapHeader(header: string[]): { index: Record<string, number>; missing: string[] } {
  const index: Record<string, number> = {};
  header.forEach((name, position) => {
    const normalized = name.trim().toLowerCase();
    if (
      (BULK_COLUMNS as readonly string[]).includes(normalized) &&
      index[normalized] === undefined
    ) {
      index[normalized] = position;
    }
  });
  const missing = (
    ['invoice', 'recipient_name', 'recipient_phone', 'recipient_address'] as const
  ).filter((required) => index[required] === undefined);
  return { index, missing: [...missing] };
}

const BD_PHONE = /^\+8801[3-9]\d{8}$/;

export function validateRow(fields: Record<string, string>): RowOutcome {
  const invoice = (fields.invoice ?? '').trim();
  if (!invoice) return { kind: 'FAILED', reason: 'invoice is required' };

  const name = (fields.recipient_name ?? '').trim();
  if (!name) return { kind: 'FAILED', reason: 'recipient_name is required' };

  const phone = (fields.recipient_phone ?? '').trim();
  if (!BD_PHONE.test(phone)) {
    return { kind: 'FAILED', reason: 'recipient_phone invalid: expected +8801XXXXXXXXX' };
  }

  const address = (fields.recipient_address ?? '').trim();
  if (!address) return { kind: 'FAILED', reason: 'recipient_address is required' };

  const weightRaw = (fields.parcel_weight ?? '').trim();
  if (weightRaw) {
    const weight = Number(weightRaw);
    if (!Number.isInteger(weight) || weight <= 0) {
      return { kind: 'FAILED', reason: 'parcel_weight must be a positive integer (grams)' };
    }
  }

  const codRaw = (fields.cod_amount ?? '').trim();
  if (codRaw) {
    // Minor units, integer only. A decimal here is a bug, not a convenience.
    if (!/^\d+$/.test(codRaw)) {
      return { kind: 'FAILED', reason: 'cod_amount must be integer minor units (poisha)' };
    }
  }

  return { kind: 'READY' };
}

export interface PreviewRow {
  readonly lineNumber: number;
  readonly invoice: string;
  readonly outcome: RowOutcome;
}

/** Full preview: parse, map, validate every row. Pure — no database, no side effects. */
export function previewImport(text: string): { rows: PreviewRow[]; headerError: string | null } {
  let grid: string[][];
  try {
    grid = parseCsv(text);
  } catch (error) {
    return { rows: [], headerError: error instanceof Error ? error.message : String(error) };
  }
  if (grid.length === 0) return { rows: [], headerError: 'Empty file.' };

  const { index, missing } = mapHeader(grid[0]!);
  if (missing.length > 0) {
    return { rows: [], headerError: `Missing required columns: ${missing.join(', ')}.` };
  }

  const rows: PreviewRow[] = [];
  for (let line = 1; line < grid.length; line++) {
    const cells = grid[line]!;
    const fields: Record<string, string> = {};
    for (const column of BULK_COLUMNS) {
      const position = index[column];
      fields[column] = position !== undefined ? (cells[position] ?? '') : '';
    }
    rows.push({
      lineNumber: line + 1,
      invoice: (fields.invoice ?? '').trim(),
      outcome: validateRow(fields),
    });
  }
  return { rows, headerError: null };
}

/** Chunk a row list for BullMQ: 100 rows per job, each its own transaction. */
export function chunkRows<T>(rows: readonly T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}
