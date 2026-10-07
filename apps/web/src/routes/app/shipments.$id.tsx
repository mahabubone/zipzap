import { createFileRoute } from '@tanstack/react-router';
import { Badge, Breadcrumbs, ErrorState, MoneyText, Skeleton } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { formatWhen, humanStatus, statusTone } from '../../lib/format.ts';

export const Route = createFileRoute('/app/shipments/$id')({
  component: ShipmentDetail,
});

function ShipmentDetail() {
  const { id } = Route.useParams();
  const shipment = useAsync(() => apiClient().getShipment(id));

  if (shipment.error) {
    return <ErrorState message={shipment.error} retry={shipment.reload} />;
  }
  if (!shipment.data) {
    return <Skeleton className="h-64 w-full" />;
  }

  const s = shipment.data;
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
        </Card>

        <Card title="Recipient">
          <Field label="Name" value={s.recipientName} />
          <Field label="Phone" value={s.recipientPhone} />
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

      <p className="text-xs text-slate-400">
        Movement history for this parcel is on the public tracking page.
      </p>
    </div>
  );
}

function Card({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="truncate font-medium text-slate-900">{value}</span>
    </div>
  );
}
