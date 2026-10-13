import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Badge,
  Breadcrumbs,
  Button,
  Dialog,
  ErrorState,
  MoneyText,
  Skeleton,
  Textarea,
} from '@zipzap/ui';
import { ZipZapApiError } from '@zipzap/api-client';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '@zipzap/web-kit';
import { formatWhen, humanStatus, statusTone } from '@zipzap/web-kit';
import { actionsFor, anyActionAvailable } from '../../lib/actions.ts';
import { timelineLines, type TimelineLine } from '../../lib/timeline.ts';

export const Route = createFileRoute('/app/shipments/$id')({
  component: ShipmentDetail,
});

type Pending = 'cancel' | 'hold' | 'release' | 'LOST' | 'DAMAGED' | null;

function ShipmentDetail() {
  const { id } = Route.useParams();
  const shipment = useAsync(() => apiClient().getShipment(id));
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(action: NonNullable<Pending>) {
    setBusy(true);
    setActionError(null);
    try {
      const client = apiClient();
      if (action === 'cancel') await client.cancelShipment(id);
      else if (action === 'hold') await client.holdShipment(id, note || undefined);
      else if (action === 'release') await client.releaseShipment(id);
      else await client.reportException(id, action, note || undefined);
      setPending(null);
      setNote('');
      // The status changed server-side; refetch rather than guess the new one.
      shipment.reload();
    } catch (error) {
      // INVALID_TRANSITION is the state machine refusing, and it names both states —
      // that is the most useful thing this screen can show a merchant.
      setActionError(
        error instanceof ZipZapApiError
          ? `${error.code}: ${error.envelope.detail}`
          : error instanceof Error
            ? error.message
            : String(error),
      );
    } finally {
      setBusy(false);
    }
  }

  if (shipment.error) {
    return <ErrorState message={shipment.error} retry={shipment.reload} />;
  }
  if (!shipment.data) {
    return <Skeleton className="h-64 w-full" />;
  }

  const s = shipment.data;
  const actions = actionsFor(s.status);
  const lines = timelineLines(s.timeline, s.codCurrency);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[{ label: 'Shipments', href: '/app/shipments' }, { label: s.trackingCode }]}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{s.trackingCode}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Created {formatWhen(s.createdAt)} · pricing v{s.pricingVersion}
          </p>
        </div>
        <Badge tone={statusTone(s.status)}>{humanStatus(s.status)}</Badge>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Sender">
          <Field label="Name" value={s.senderName} />
          <Field label="Phone" value={s.senderPhone} />
          <Field label="Address" value={s.senderAddress} wrap />
        </Card>

        <Card title="Recipient">
          <Field label="Name" value={s.recipientName} />
          <Field label="Phone" value={s.recipientPhone} />
          <Field label="Address" value={s.recipientAddress} wrap />
        </Card>

        <Card title="Parcel">
          <Field label="Description" value={s.parcelDescription} />
          <Field label="Weight" value={`${s.parcelWeightGrams} g`} />
        </Card>

        <Card title="Cash on delivery">
          <div className="flex items-baseline gap-2">
            <MoneyText
              amountMinor={s.codAmountMinor}
              currency={s.codCurrency as 'BDT'}
              className="text-lg font-semibold text-slate-900"
            />
            <span className="text-sm text-slate-500">{s.codCurrency}</span>
          </div>
          {s.merchantReference ? (
            <Field label="Your reference" value={s.merchantReference} />
          ) : null}
        </Card>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Actions</h2>
        {actionError ? (
          <p role="alert" className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {actionError}
          </p>
        ) : null}
        {anyActionAvailable(actions) ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.canHold ? (
              <Button size="sm" variant="secondary" onClick={() => setPending('hold')}>
                Hold
              </Button>
            ) : null}
            {actions.canRelease ? (
              <Button size="sm" variant="secondary" onClick={() => setPending('release')}>
                Release
              </Button>
            ) : null}
            {actions.canCancel ? (
              <Button size="sm" variant="destructive" onClick={() => setPending('cancel')}>
                Cancel shipment
              </Button>
            ) : null}
            {actions.canReportLost ? (
              <Button size="sm" variant="secondary" onClick={() => setPending('LOST')}>
                Report lost
              </Button>
            ) : null}
            {actions.canReportDamaged ? (
              <Button size="sm" variant="secondary" onClick={() => setPending('DAMAGED')}>
                Report damaged
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            No actions are available on a parcel that is {humanStatus(s.status).toLowerCase()}.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Movement history</h2>
        <p className="mt-1 text-xs text-slate-500">
          Scans, hubs and riders, as recorded by ZipZap. Your customer sees the same journey on the
          tracking page, without the operational detail.
        </p>
        {lines.length > 0 ? (
          <div className="mt-4">
            <Timeline lines={lines} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            Nothing recorded yet — this parcel was created moments ago.
          </p>
        )}
      </section>

      {/* Cancel is irreversible in practice: the parcel is gone and a new one costs money.
          Every destructive action gets a typed confirmation rather than a bare confirm. */}
      <Dialog
        open={pending === 'cancel'}
        title="Cancel this shipment?"
        onClose={() => setPending(null)}
        actions={
          <Button variant="destructive" disabled={busy} onClick={() => void run('cancel')}>
            {busy ? 'Cancelling…' : 'Yes, cancel it'}
          </Button>
        }
      >
        <p>
          This parcel will not be delivered and cannot be resumed. Any cash-on-delivery amount stays
          yours to collect from the customer.
        </p>
      </Dialog>

      <Dialog
        open={pending === 'hold'}
        title="Hold this shipment?"
        onClose={() => setPending(null)}
        actions={
          <Button disabled={busy} onClick={() => void run('hold')}>
            {busy ? 'Holding…' : 'Hold it'}
          </Button>
        }
      >
        <p className="mb-3">Movement pauses. You can release it afterwards.</p>
        <Textarea
          aria-label="Reason for holding"
          rows={2}
          placeholder="Why are you holding it? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Dialog>

      <Dialog
        open={pending === 'release'}
        title="Release this shipment?"
        onClose={() => setPending(null)}
        actions={
          <Button disabled={busy} onClick={() => void run('release')}>
            {busy ? 'Releasing…' : 'Release it'}
          </Button>
        }
      >
        <p>It resumes from the step it stopped at, not from the beginning.</p>
      </Dialog>

      <Dialog
        open={pending === 'LOST' || pending === 'DAMAGED'}
        title={pending === 'LOST' ? 'Report this parcel lost?' : 'Report this parcel damaged?'}
        onClose={() => setPending(null)}
        actions={
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => pending && void run(pending)}
          >
            {busy ? 'Reporting…' : 'Report it'}
          </Button>
        }
      >
        <p className="mb-3">
          {pending === 'LOST'
            ? 'A lost parcel ends the delivery and is excluded from the next settlement run.'
            : 'A damaged parcel is inspected at the hub. Claiming damage you have not checked is fraud.'}
        </p>
        <Textarea
          aria-label="What happened?"
          rows={2}
          placeholder="What happened? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Dialog>
    </div>
  );
}

function Timeline({ lines }: { readonly lines: ReadonlyArray<TimelineLine> }) {
  return (
    <ol className="relative flex flex-col gap-4 border-l border-slate-200 pl-6">
      {lines.map((line) => (
        <li key={line.key} className="relative">
          <span
            className={`absolute -left-[31px] top-1 size-2.5 rounded-full ${
              line.corrects ? 'bg-amber-500' : 'bg-brand-500'
            }`}
          />
          <p className="text-sm font-medium text-slate-800">
            {line.label}
            {line.corrects ? (
              <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-normal text-amber-800">
                correction
              </span>
            ) : null}
          </p>
          {line.detail ? <p className="text-xs text-slate-600">{line.detail}</p> : null}
          <p className="mt-0.5 text-xs text-slate-400">
            {formatWhen(line.occurredAt)} · {actorLabel(line.actorType)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Who caused it, not who they are — the log deliberately stores no identity here. */
function actorLabel(actorType: string): string {
  if (actorType === 'rider') return 'rider';
  if (actorType === 'merchant') return 'you';
  if (actorType === 'system') return 'system';
  return actorType;
}

function Card({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

// `wrap` for the fields whose whole value is the point: an address elided to
// "… Mirpur" is the one piece of information a merchant calls about. Names and phone
// numbers stay on one line, because a wrapped phone number reads as two numbers.
function Field({
  label,
  value,
  wrap = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly wrap?: boolean;
}) {
  return (
    <div className={wrap ? 'text-sm' : 'flex items-baseline justify-between gap-3 text-sm'}>
      <span className="text-slate-600">{wrap ? `${label}: ` : label}</span>
      <span className={wrap ? 'font-medium text-slate-900' : 'truncate font-medium text-slate-900'}>
        {value || '—'}
      </span>
    </div>
  );
}
