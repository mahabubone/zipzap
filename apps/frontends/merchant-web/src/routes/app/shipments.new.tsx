import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  FormField,
  Input,
  MoneyText,
  PageHeader,
  Select,
  Textarea,
} from '@zipzap/ui';
import type { Coverage, Quote } from '@zipzap/api-client';
import { apiClient } from '../../lib/api.ts';
import { toE164 } from '../../lib/phone.ts';
import { parseAmount } from '../../lib/money.ts';

export const Route = createFileRoute('/app/shipments/new')({
  component: NewShipment,
});

/** Zones the seed covers. `GET /v1/coverage?zone=` is the authority, not this list. */
const ZONES = [
  'dhaka-metro',
  'dhaka-outside',
  'chattogram',
  'sylhet',
  'khulna',
  'rajshahi',
  'cumilla',
  'bogura',
  'barishal',
  'rangpur',
  'mymensingh',
] as const;

const PLANS = ['standard', 'express', 'economy'] as const;

interface Form {
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  parcelWeightGrams: string;
  parcelDescription: string;
  codAmount: string;
  zone: string;
  remoteArea: boolean;
  fragile: boolean;
  merchantPlan: string;
}

const EMPTY: Form = {
  senderName: '',
  senderPhone: '',
  senderAddress: '',
  recipientName: '',
  recipientPhone: '',
  recipientAddress: '',
  parcelWeightGrams: '',
  parcelDescription: '',
  codAmount: '',
  zone: 'dhaka-metro',
  remoteArea: false,
  fragile: false,
  merchantPlan: 'standard',
};

/** A fresh key per submission attempt, so a retry after a timeout cannot duplicate a
 *  parcel (rule 9). Held in a ref: it must survive a re-render but not a reload. */
function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function NewShipment() {
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<{ trackingCode: string; id: string } | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Phones normalise as they are typed, so the field shows what will be sent.
  const senderE164 = toE164(form.senderPhone);
  const recipientE164 = toE164(form.recipientPhone);
  const grams = Number(form.parcelWeightGrams);
  const weightGrams = Number.isInteger(grams) && grams > 0 ? grams : null;
  // Parsed, not `Math.round(Number(x) * 100)`: that rounded 1.005 down and 8.115 up, so the
  // direction depended on the binary representation rather than on what the merchant typed.
  // See lib/money.ts. `cod` is null while the field is unusable, which blocks submit and
  // surfaces the reason under the input rather than silently charging a rounded figure.
  const cod = parseAmount(form.codAmount);
  const codMinor = cod.minor ?? 0;

  /** Everything the API needs, or null while the form is incomplete. */
  const draft = useMemo(() => {
    if (!senderE164 || !recipientE164) return null;
    if (!form.senderName.trim() || !form.recipientName.trim()) return null;
    if (!form.senderAddress.trim() || !form.recipientAddress.trim()) return null;
    if (!form.parcelDescription.trim()) return null;
    if (weightGrams === null) return null;
    if (cod.minor === null) return null;
    return {
      senderName: form.senderName.trim(),
      senderPhone: senderE164,
      senderAddress: form.senderAddress.trim(),
      recipientName: form.recipientName.trim(),
      recipientPhone: recipientE164,
      recipientAddress: form.recipientAddress.trim(),
      parcelWeightGrams: weightGrams,
      parcelDescription: form.parcelDescription.trim(),
      codAmountMinor: codMinor,
      zone: form.zone,
      remoteArea: form.remoteArea,
      fragile: form.fragile,
      merchantPlan: form.merchantPlan,
    };
    // `cod` rather than `codMinor`: the memo must also re-run when the field becomes
    // unusable, and that is the `null` case, which `codMinor` flattens to 0.
  }, [form, senderE164, recipientE164, weightGrams, cod.minor]);

  // Coverage is a property of the zone alone, so it re-runs when the zone changes —
  // not on every keystroke.
  useEffect(() => {
    let live = true;
    apiClient()
      .coverage(form.zone)
      .then((c) => live && setCoverage(c))
      .catch(() => live && setCoverage(null));
    return () => {
      live = false;
    };
  }, [form.zone]);

  // The quote preview. Debounced because it fires on every field change, and it is a
  // POST — unthrottled it would burn the merchant's own rate limit on typing.
  useEffect(() => {
    if (!draft) {
      setQuote(null);
      return;
    }
    let live = true;
    setQuoting(true);
    const timer = setTimeout(() => {
      apiClient()
        .quote({
          weightGrams: draft.parcelWeightGrams,
          codAmountMinor: draft.codAmountMinor,
          zone: draft.zone,
          remoteArea: draft.remoteArea,
          fragile: draft.fragile,
          merchantPlan: draft.merchantPlan,
        })
        .then((q) => live && setQuote(q))
        .catch(() => live && setQuote(null))
        .finally(() => live && setQuoting(false));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft]);

  const submit = useCallback(async () => {
    if (!draft || submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const result = await apiClient().createShipment(
        {
          senderName: draft.senderName,
          senderPhone: draft.senderPhone,
          senderAddress: draft.senderAddress,
          recipientName: draft.recipientName,
          recipientPhone: draft.recipientPhone,
          recipientAddress: draft.recipientAddress,
          parcelWeightGrams: draft.parcelWeightGrams,
          parcelDescription: draft.parcelDescription,
          ...(draft.codAmountMinor > 0
            ? { codAmountMinor: draft.codAmountMinor, codCurrency: 'BDT' }
            : {}),
          zone: draft.zone,
          remoteArea: draft.remoteArea,
          fragile: draft.fragile,
          merchantPlan: draft.merchantPlan,
        },
        idempotencyKey.current,
      );
      setCreated({ trackingCode: result.trackingCode, id: result.id });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      // A fresh key for the next attempt: this one may already be recorded server-side,
      // and reusing it would replay the original request instead of retrying it.
      idempotencyKey.current = newIdempotencyKey();
    } finally {
      setSubmitting(false);
    }
  }, [draft, submitting]);

  if (created) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Shipment created" description="It is in your account now." />
        <div className="rounded-lg border border-green-200 bg-green-50 p-6">
          <p className="text-sm text-green-800">Tracking code</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-green-900">
            {created.trackingCode}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => void navigate({ to: '/app/shipments/$id', params: { id: created.id } })}
          >
            Open shipment
          </Button>
          <Button variant="secondary" onClick={() => void navigate({ to: '/app/shipments' })}>
            Back to list
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setCreated(null);
              setForm(EMPTY);
              idempotencyKey.current = newIdempotencyKey();
            }}
          >
            Create another
          </Button>
        </div>
      </div>
    );
  }

  const blocked = coverage !== null && !coverage.serviceable;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Create a shipment"
        description="Prices are confirmed by the server. The estimate below updates as you type."
      />

      <form
        className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-6">
          <Panel title="Sender">
            <FormField label="Name" htmlFor="senderName">
              <Input
                id="senderName"
                value={form.senderName}
                onChange={(e) => set('senderName', e.target.value)}
              />
            </FormField>
            <FormField
              label="Phone"
              htmlFor="senderPhone"
              hint={senderE164 ? `Sent as ${senderE164}` : 'Bangladeshi number, e.g. 01712345678'}
              error={
                form.senderPhone.trim() === ''
                  ? undefined
                  : senderE164
                    ? undefined
                    : 'Not a valid Bangladeshi mobile number'
              }
            >
              <Input
                id="senderPhone"
                inputMode="tel"
                value={form.senderPhone}
                invalid={form.senderPhone.trim() !== '' && !senderE164}
                onChange={(e) => set('senderPhone', e.target.value)}
              />
            </FormField>
            <FormField label="Address" htmlFor="senderAddress">
              <Textarea
                id="senderAddress"
                rows={2}
                value={form.senderAddress}
                onChange={(e) => set('senderAddress', e.target.value)}
              />
            </FormField>
          </Panel>

          <Panel title="Recipient">
            <FormField label="Name" htmlFor="recipientName">
              <Input
                id="recipientName"
                value={form.recipientName}
                onChange={(e) => set('recipientName', e.target.value)}
              />
            </FormField>
            <FormField
              label="Phone"
              htmlFor="recipientPhone"
              hint={recipientE164 ? `Sent as ${recipientE164}` : 'The rider calls this number'}
              error={
                form.recipientPhone.trim() === ''
                  ? undefined
                  : recipientE164
                    ? undefined
                    : 'Not a valid Bangladeshi mobile number'
              }
            >
              <Input
                id="recipientPhone"
                inputMode="tel"
                value={form.recipientPhone}
                invalid={form.recipientPhone.trim() !== '' && !recipientE164}
                onChange={(e) => set('recipientPhone', e.target.value)}
              />
            </FormField>
            <FormField label="Address" htmlFor="recipientAddress">
              <Textarea
                id="recipientAddress"
                rows={2}
                value={form.recipientAddress}
                onChange={(e) => set('recipientAddress', e.target.value)}
              />
            </FormField>
          </Panel>

          <Panel title="Parcel">
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Weight (grams)" htmlFor="weight">
                <Input
                  id="weight"
                  inputMode="numeric"
                  value={form.parcelWeightGrams}
                  onChange={(e) => set('parcelWeightGrams', e.target.value)}
                />
              </FormField>
              <FormField label="Zone" htmlFor="zone">
                <Select
                  id="zone"
                  value={form.zone}
                  onChange={(e) => set('zone', e.target.value)}
                  options={ZONES.map((z) => ({ value: z, label: z }))}
                />
              </FormField>
              <FormField label="Plan" htmlFor="plan">
                <Select
                  id="plan"
                  value={form.merchantPlan}
                  onChange={(e) => set('merchantPlan', e.target.value)}
                  options={PLANS.map((p) => ({ value: p, label: p }))}
                />
              </FormField>
            </div>
            <FormField label="Description" htmlFor="description">
              <Input
                id="description"
                value={form.parcelDescription}
                onChange={(e) => set('parcelDescription', e.target.value)}
              />
            </FormField>
            <FormField
              label="Cash on delivery (৳)"
              htmlFor="cod"
              hint={cod.error === null ? 'Leave blank if the recipient pays nothing.' : undefined}
              error={cod.error ?? undefined}
            >
              <Input
                id="cod"
                inputMode="decimal"
                value={form.codAmount}
                aria-invalid={cod.error !== null}
                onChange={(e) => set('codAmount', e.target.value)}
              />
            </FormField>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Checkbox
                  checked={form.remoteArea}
                  onChange={(e) => set('remoteArea', e.target.checked)}
                />
                Remote area
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Checkbox
                  checked={form.fragile}
                  onChange={(e) => set('fragile', e.target.checked)}
                />
                Fragile
              </label>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Estimate</h2>
            {coverage && !coverage.serviceable ? (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {coverage.reason ?? 'This zone is not serviceable.'}
              </p>
            ) : quote ? (
              <>
                <ul className="mt-3 flex flex-col gap-1 text-sm">
                  {quote.lines.map((line) => (
                    <li key={line.kind} className="flex justify-between gap-3">
                      <span className="text-slate-600">{line.label}</span>
                      <MoneyText
                        amountMinor={line.amount.amountMinor}
                        currency={quote.currency as 'BDT'}
                      />
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-baseline justify-between border-t border-slate-200 pt-3">
                  <span className="text-sm font-medium text-slate-700">Total</span>
                  <MoneyText
                    amountMinor={quote.total.amountMinor}
                    currency={quote.currency as 'BDT'}
                    className="text-lg font-semibold text-slate-900"
                  />
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Estimate on pricing v{quote.version}. The server prices at creation.
                </p>
              </>
            ) : quoting ? (
              <p className="mt-2 text-sm text-slate-500">Pricing…</p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Fill in the parcel details to see a price.
              </p>
            )}
          </section>

          {coverage?.serviceable && coverage.estimatedDays !== null ? (
            <p className="text-xs text-slate-500">
              Estimated delivery in {coverage.estimatedDays} day
              {coverage.estimatedDays === 1 ? '' : 's'}.
            </p>
          ) : null}

          {failure ? (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {failure}
            </p>
          ) : null}

          <Button type="submit" disabled={!draft || submitting || blocked}>
            {submitting ? 'Creating…' : 'Create shipment'}
          </Button>
          <p className="text-xs text-slate-400">
            Creation is idempotent: a retry with the same key returns the same parcel instead of
            duplicating it.
          </p>
        </div>
      </form>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}
