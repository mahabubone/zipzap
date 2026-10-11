import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ErrorState, PageHeader, Skeleton } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import {
  applyToggle,
  revertToggle,
  type PreferenceRow,
} from '../../rules/notification-preference.ts';

export const Route = createFileRoute('/app/notifications')({
  component: NotificationPreferencesScreen,
});

/**
 * What a merchant's customers get told, and how to stop it.
 *
 * All three competitors ship this screen, and the reason they all have it is not the switch — it is
 * that a courier's SMS bill and a customer's phone are both the merchant's problem, and a merchant
 * who cannot turn a class of message off will leave the platform rather than pay for it.
 *
 * The labels are the argument, not the toggles. "Parcel created" is a fact about our database; "a
 * new order was received" is what the merchant's customer cares about. A screen full of event-type
 * names is a schema dump that teaches a merchant nothing about what their customers will receive.
 *
 * Every toggle here starts on, because absence means on. A merchant who has never opened this page
 * has never muted anything, and the screen says so in as many words rather than letting an empty
 * list imply that nothing has been configured.
 */

const LABELS: Record<string, { title: string; detail: string }> = {
  ShipmentCreated: {
    title: 'New order received',
    detail: 'Sent the moment an order is imported or created, before it moves anywhere.',
  },
  DeliveryOutForDelivery: {
    title: 'Out for delivery',
    detail: 'The parcel has left the hub and a rider is on the way.',
  },
  DeliveryCompleted: {
    title: 'Delivered',
    detail: 'The parcel was handed over, with proof of delivery captured against it.',
  },
};

type Preference = PreferenceRow;

function NotificationPreferencesScreen() {
  const preferences = useAsync(() => apiClient().notificationPreferences());
  const [pending, setPending] = useState<string | null>(null);
  const [rows, setRows] = useState<readonly Preference[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = rows ?? preferences.data;

  async function toggle(eventType: string, enabled: boolean) {
    setPending(eventType);
    setError(null);
    // The switch moves first and the request follows. Waiting for the round trip to paint a toggle
    // makes the screen feel broken on a slow connection, and a merchant who taps twice because
    // nothing happened is a merchant who has just muted something they meant to enable.
    //
    // `applyToggle` is scoped to the tapped row. An earlier version mapped over every row with the
    // same `enabled`, so one switch moved all three — and because the server only persisted the
    // tapped row, the screen then disagreed with the database for the other two. The pure function
    // in `rules/` has the regression test; this is just the call site.
    setRows((prev) => applyToggle(prev ?? preferences.data ?? [], eventType, enabled));
    try {
      await apiClient().setNotificationPreference(eventType, enabled);
    } catch (err) {
      setRows((prev) => revertToggle(prev ?? [], eventType, !enabled));
      setError(err instanceof Error ? err.message : 'Could not save that preference.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customer notifications"
        description="The SMS your customers receive, and when. Everything is on unless you turn it off here."
      />

      {error ? <ErrorState message={error} retry={() => setError(null)} /> : null}

      {preferences.error ? (
        <ErrorState message={preferences.error} retry={preferences.reload} />
      ) : !current ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white">
          <ul className="divide-y divide-slate-100">
            {current.map((row) => {
              const copy = LABELS[row.eventType];
              return (
                <li key={row.eventType} className="flex items-start gap-4 px-5 py-4">
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-sm font-medium text-slate-900">
                      {copy?.title ?? row.eventType}
                    </span>
                    <span className="text-sm text-slate-500">
                      {copy?.detail ?? 'A parcel lifecycle update.'}
                    </span>
                    <span className="text-xs text-slate-400">
                      {row.enabled
                        ? row.isDefault
                          ? 'On — default'
                          : 'On'
                        : 'Off — this message is not being sent'}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.enabled}
                    aria-label={copy?.title ?? row.eventType}
                    disabled={pending === row.eventType}
                    onClick={() => void toggle(row.eventType, !row.enabled)}
                    className={[
                      'relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors',
                      row.enabled ? 'bg-slate-900' : 'bg-slate-300',
                      pending === row.eventType ? 'opacity-60' : '',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
                        row.enabled ? 'left-[22px]' : 'left-0.5',
                      ].join(' ')}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="text-xs text-slate-500">
        One SMS per event per parcel, sent to the phone number on the order. Turning a message off
        here stops it immediately, including for parcels already in transit.
      </p>
    </div>
  );
}
