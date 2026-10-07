import { createFileRoute } from '@tanstack/react-router';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  Timeline,
} from '@zipzap/ui';
import { useState, type FormEvent } from 'react';
import { anonClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { formatWhen, humanStatus, statusTone } from '../../lib/format.ts';

export const Route = createFileRoute('/app/track')({
  component: Track,
});

function Track() {
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState('');
  // Public endpoint — no session needed, and the same shape a recipient gets.
  // Nothing to fetch until a code is submitted, so the hook idles on a never-
  // resolving promise rather than growing a `skip` flag.
  const tracking = useAsync(() =>
    submitted === '' ? new Promise<never>(() => {}) : anonClient().track(submitted),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(code.trim().toUpperCase());
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Track parcel"
        description="Movement history for any tracking code on the network."
      />

      <form onSubmit={submit} className="flex max-w-md items-end gap-2">
        <FormField label="Tracking code" htmlFor="tracking" className="flex-1">
          <Input
            id="tracking"
            name="tracking"
            placeholder="ZP-XXXXXXXXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </FormField>
        <Button type="submit" disabled={code.trim() === ''}>
          Track
        </Button>
      </form>

      {submitted === '' ? (
        <EmptyState
          title="No parcel selected"
          description="Enter a tracking code above to see its journey so far."
        />
      ) : tracking.error ? (
        <ErrorState title="Not found" message={tracking.error} />
      ) : !tracking.data ? (
        <p className="text-sm text-slate-500">Loading {submitted}…</p>
      ) : (
        <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-slate-900">{tracking.data.trackingCode}</span>
            {tracking.data.status ? (
              <Badge tone={statusTone(tracking.data.status)}>
                {humanStatus(tracking.data.status)}
              </Badge>
            ) : null}
          </div>

          {tracking.data.timeline.length === 0 ? (
            <p className="text-sm text-slate-500">
              No events recorded yet. The first one lands once the parcel is scanned.
            </p>
          ) : (
            <Timeline
              events={[...tracking.data.timeline]
                .sort((a, b) => b.sequence - a.sequence)
                .map((e) => ({
                  at: formatWhen(e.occurredAt),
                  label: humanStatus(e.event),
                }))}
            />
          )}
        </section>
      )}
    </div>
  );
}
