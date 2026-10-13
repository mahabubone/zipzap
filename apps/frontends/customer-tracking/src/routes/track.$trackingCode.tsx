import { createFileRoute, Link } from '@tanstack/react-router';
import { Badge, ErrorState, Skeleton } from '@zipzap/ui';
import { anonClient } from '../lib/api.ts';
import { useAsync } from '@zipzap/web-kit';
import { formatWhen, humanStatus, statusTone } from '@zipzap/web-kit';
import { Logo } from '../lib/brand.tsx';

export const Route = createFileRoute('/track/$trackingCode')({
  component: TrackParcel,
});

/**
 * The customer-facing half of the story: a projection of the same events the
 * merchant console and the operations board read. Reads the public endpoint —
 * no session, and no field here that the projection does not already expose.
 */
function TrackParcel() {
  const { trackingCode } = Route.useParams();
  const tracking = useAsync(() => anonClient().track(trackingCode));

  const events = tracking.data ? [...tracking.data.timeline] : [];

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Logo />
          <Link to="/track" className="text-sm text-slate-600 hover:text-slate-900">
            Track another
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-slate-900">
            {trackingCode}
          </h1>
          {tracking.data?.status ? (
            <Badge tone={statusTone(tracking.data.status)}>
              {humanStatus(tracking.data.status)}
            </Badge>
          ) : null}
        </div>

        {tracking.error ? (
          <div className="mt-8">
            <ErrorState
              title="Parcel not found"
              message="Check the code and try again. It is printed on your delivery notice."
            />
            <Link to="/track" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
              Try another code
            </Link>
          </div>
        ) : !tracking.data ? (
          <div className="mt-8 flex flex-col gap-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : events.length === 0 ? (
          <p className="mt-8 text-sm text-slate-500">
            No scans recorded yet. The first one lands as soon as the parcel is scanned.
          </p>
        ) : (
          <ol className="mt-8 flex flex-col">
            {[...events]
              .sort((a, b) => b.sequence - a.sequence)
              .map((e, i) => (
                <li key={e.sequence} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span
                      aria-hidden
                      className={
                        i === 0
                          ? 'mt-1.5 size-3 rounded-full bg-brand-600 ring-4 ring-brand-100'
                          : 'mt-1.5 size-3 rounded-full bg-slate-300'
                      }
                    />
                    {i < events.length - 1 ? (
                      <span aria-hidden className="w-px flex-1 bg-slate-200" />
                    ) : null}
                  </div>
                  <div className="pb-8">
                    <p className="font-medium text-slate-900">{humanStatus(e.event)}</p>
                    <p className="mt-0.5 text-sm text-slate-500">{formatWhen(e.occurredAt)}</p>
                  </div>
                </li>
              ))}
          </ol>
        )}

        <p className="mt-10 border-t border-slate-200 pt-6 text-xs text-slate-400">
          Status updates as each scan is recorded. Questions about a delivery? Contact the shop that
          sent it.
        </p>
      </main>
    </div>
  );
}
