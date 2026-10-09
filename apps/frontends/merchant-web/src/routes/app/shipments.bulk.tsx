import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, DataTable, PageHeader, Progress, type DataTableColumn } from '@zipzap/ui';
import {
  ZipZapApiError,
  type BulkJob,
  type BulkPreview,
  type BulkPreviewRow,
} from '@zipzap/api-client';
import { apiClient } from '../../lib/api.ts';
import {
  isTerminal,
  jobHeadline,
  jobSucceeded,
  progressPercent,
  reasonsByFrequency,
  summarisePreview,
  templateCsv,
} from '../../lib/bulk.ts';

export const Route = createFileRoute('/app/shipments/bulk')({
  component: BulkImport,
});

/** How often to ask the server how far the import has got. */
const POLL_MS = 1500;

function outcomeTone(outcome: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  if (outcome === 'CREATED') return 'success';
  if (outcome === 'FAILED') return 'danger';
  if (outcome === 'SKIPPED_DUPLICATE') return 'warning';
  return 'neutral';
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'READY':
      return 'Will import';
    case 'CREATED':
      return 'Created';
    case 'FAILED':
      return 'Failed';
    case 'SKIPPED_DUPLICATE':
      return 'Already exists';
    default:
      // An outcome this build has never heard of must be visible, not folded
      // into "fine". Silent passivity here reads as "imported".
      return outcome;
  }
}

function BulkImport() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [job, setJob] = useState<BulkJob | null>(null);
  const [filename, setFilename] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = (e: unknown) =>
    e instanceof ZipZapApiError ? `${e.code}: ${e.envelope.detail}` : String(e);

  const send = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      // Read as TEXT here, not as multipart: the endpoint takes the CSV content
      // as a JSON string, and `File.text()` is the only decoding step needed.
      const csv = await file.text();
      const result = await apiClient().uploadBulk(file.name, csv);
      setPreview(result);
      setJob(result.job);
      setFilename(file.name);
    } catch (e) {
      setError(message(e));
      // A rejected file leaves nothing to check, so the old preview must go —
      // leaving it on screen says "this is your file" about the previous one.
      setPreview(null);
      setJob(null);
      setFilename('');
    } finally {
      setUploading(false);
    }
  }, []);

  const accept = useCallback(async () => {
    if (!job) return;
    setError(null);
    try {
      setJob(await apiClient().acceptBulk(job.id));
    } catch (e) {
      setError(message(e));
    }
  }, [job]);

  const poll = useCallback(async () => {
    if (!job) return;
    try {
      setJob(await apiClient().bulkProgress(job.id));
    } catch (e) {
      setError(message(e));
    }
  }, [job]);

  // Poll PROCESSING only. Gating on `!isTerminal` looks equivalent and is not: a
  // job sitting at PREVIEW is not terminal, so that version polled a preview that
  // never moves — and, worse, `!running` was false, so the Accept button it also
  // gated never rendered and the checkpoint could not be passed at all.
  const processing = job?.status === 'PROCESSING';
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [processing, poll]);

  const download = useCallback(async () => {
    if (!job) return;
    try {
      const csv = await apiClient().bulkResultCsv(job.id);
      // A Blob, not a link to the endpoint: the endpoint needs the Authorization
      // header, and an <a href> cannot send one. Without this the browser saves
      // a login page under the name of a result file.
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${job.filename.replace(/\.csv$/i, '')}-result.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(message(e));
    }
  }, [job]);

  const downloadTemplate = useCallback(() => {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zipzap-bulk-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const summary = preview ? summarisePreview(preview.rows) : null;
  const reasons = preview ? reasonsByFrequency(preview.rows) : [];
  const done = job !== null && isTerminal(job);

  const columns: ReadonlyArray<DataTableColumn<BulkPreviewRow>> = [
    {
      id: 'lineNumber',
      header: 'Line',
      align: 'right',
      accessor: (r) => r.lineNumber,
      cell: (r) => <span className="font-mono text-xs text-slate-500">{r.lineNumber}</span>,
    },
    {
      id: 'invoice',
      header: 'Invoice',
      accessor: (r) => r.invoice,
      cell: (r) => <span className="font-medium text-slate-900">{r.invoice}</span>,
    },
    {
      id: 'outcome',
      header: 'Outcome',
      accessor: (r) => r.outcome,
      cell: (r) => <Badge tone={outcomeTone(r.outcome)}>{outcomeLabel(r.outcome)}</Badge>,
    },
    {
      id: 'reason',
      header: 'Reason',
      accessor: (r) => r.reason ?? '',
      cell: (r) =>
        r.reason ? (
          <span className="text-slate-600">{r.reason}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bulk import"
        description="Upload a CSV, check what it will create, then import. Nothing is created until you accept."
        actions={
          <Button size="sm" onClick={() => void navigate({ to: '/app/shipments' })}>
            Back to shipments
          </Button>
        }
      />

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="bulk-file" className="text-sm font-medium text-slate-900">
            CSV file
          </label>
          <input
            ref={fileInput}
            id="bulk-file"
            type="file"
            accept=".csv,text/csv"
            disabled={uploading || processing}
            aria-describedby="bulk-file-hint"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void send(file);
              // Cleared so re-picking the same file fires `change` again —
              // otherwise a merchant who fixed a row and re-picked the same
              // filename sees nothing happen.
              e.target.value = '';
            }}
            className="text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700 disabled:opacity-50"
          />
          <Button variant="secondary" size="sm" onClick={downloadTemplate}>
            Download template
          </Button>
        </div>
        <p id="bulk-file-hint" className="mt-2 text-sm text-slate-500">
          Columns: <code className="font-mono text-xs">invoice</code>,{' '}
          <code className="font-mono text-xs">recipient_name</code>,{' '}
          <code className="font-mono text-xs">recipient_phone</code>,{' '}
          <code className="font-mono text-xs">recipient_address</code>, and optionally{' '}
          <code className="font-mono text-xs">destination_area</code>,{' '}
          <code className="font-mono text-xs">cod_amount</code>,{' '}
          <code className="font-mono text-xs">parcel_weight</code>,{' '}
          <code className="font-mono text-xs">item_description</code>. Phones must be{' '}
          <code className="font-mono text-xs">+8801XXXXXXXXX</code> and COD is integer poisha.
        </p>
      </section>

      {error !== null ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      {job === null ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
          <p className="text-sm text-slate-500">
            {uploading ? 'Reading your file…' : 'No file uploaded yet.'}
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{jobHeadline(job)}</h2>
              <span className="text-xs text-slate-500">
                {filename} · {job.totalRows} rows
              </span>
            </div>

            {processing ? (
              <div className="mt-3">
                <Progress value={progressPercent(job)} label="Import progress" />
                <p className="mt-1 text-xs text-slate-500">
                  Creating parcels in batches. You can leave this page — the import keeps going.
                </p>
              </div>
            ) : null}

            {done ? (
              <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Created</dt>
                  <dd className="text-lg font-semibold text-emerald-700">{job.succeededRows}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Failed</dt>
                  <dd className="text-lg font-semibold text-red-700">{job.failedRows}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Already existed</dt>
                  <dd className="text-lg font-semibold text-amber-700">{job.skippedRows}</dd>
                </div>
              </dl>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {/* Accept is offered only at the checkpoint. Anywhere else it is
                  either a duplicate or a job that has already been accepted. */}
              {job.status === 'PREVIEW' ? (
                <Button onClick={() => void accept()}>
                  Create {summary?.ready ?? 0} parcel{summary?.ready === 1 ? '' : 's'}
                </Button>
              ) : null}
              {done ? (
                <>
                  <Button onClick={() => void download()}>Download result CSV</Button>
                  <Button
                    variant="secondary"
                    onClick={() => void navigate({ to: '/app/shipments' })}
                  >
                    View shipments
                  </Button>
                </>
              ) : null}
              {job.status === 'PREVIEW' && summary?.problems ? (
                <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                  Upload a corrected file
                </Button>
              ) : null}
            </div>

            {done && jobSucceeded(job) && job.failedRows > 0 ? (
              <p className="mt-3 text-sm text-slate-600">
                The rows that failed are listed in the result CSV, with the reason on each. Fix them
                in your file and upload it again — rows that already exist are skipped, not created
                twice.
              </p>
            ) : null}
          </section>

          {preview && summary ? (
            <>
              {reasons.length > 0 ? (
                <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h2 className="text-sm font-semibold text-amber-900">
                    {summary.problems} of {summary.total} rows will not import
                  </h2>
                  <ul className="mt-2 space-y-1 text-sm text-amber-900">
                    {reasons.map((r) => (
                      <li key={r.reason} className="flex justify-between gap-4">
                        <span>{r.reason}</span>
                        <span className="font-medium tabular-nums">{r.count}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <DataTable
                caption="What this file will create"
                columns={columns}
                rows={summary.shown}
                rowKey={(r) => String(r.lineNumber)}
                searchable={false}
                empty={
                  <p className="py-6 text-center text-sm text-slate-500">
                    This file has no data rows.
                  </p>
                }
              />

              {summary.hiddenReady > 0 ? (
                <p className="text-sm text-slate-500">
                  Showing {summary.shown.length} of {summary.total} rows.
                  {summary.problems > 0
                    ? ' Every problem row is listed'
                    : ` ${summary.hiddenReady} ready rows are summarised rather than listed`}
                  . The result CSV has every row.
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
