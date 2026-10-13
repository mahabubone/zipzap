import { useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  Skeleton,
  Table,
} from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '@zipzap/web-kit';

export const Route = createFileRoute('/app/webhooks')({
  component: WebhooksScreen,
});

/**
 * Webhooks & Developer portal screen.
 *
 * Implements Stage 6b of docs/product/competition/plan.md:
 * 1. Register webhook endpoint with secret display once
 * 2. List endpoints (ACTIVE / PAUSED)
 * 3. Delivery attempt log with attempt count, status code, error message
 * 4. One-click replay of a failed delivery
 */
function WebhooksScreen() {
  const endpoints = useAsync(() => apiClient().listWebhooks());
  const deliveries = useAsync(() => apiClient().listWebhookDeliveries());

  const [url, setUrl] = useState('');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [replayedInfo, setReplayedInfo] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiClient().createWebhook({
        url: url.trim(),
        events: ['shipment.created', 'shipment.delivered', 'cod.collected'],
      });
      setCreatedSecret(res.secret);
      setUrl('');
      endpoints.reload();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleReplay(deliveryId: string) {
    setReplayingId(deliveryId);
    setReplayedInfo(null);
    try {
      const res = await apiClient().replayWebhookDelivery(deliveryId);
      setReplayedInfo(`Replayed as delivery ${res.deliveryId}`);
      deliveries.reload();
    } catch (err: unknown) {
      setReplayedInfo(`Replay failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReplayingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Webhooks & Developer"
        description="Receive realtime updates when shipments move, collect COD, or complete."
      />

      {/* 1. Register Webhook */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-medium text-slate-900">Register webhook endpoint</h2>
        <p className="mt-1 text-sm text-slate-600">
          We deliver HMAC-SHA256 signed POST payloads for shipment lifecycle events.
        </p>

        {createdSecret ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="text-sm font-semibold text-emerald-800">
              Endpoint registered successfully
            </h3>
            <p className="mt-1 text-xs text-emerald-700">
              Save your signing secret now. It will never be shown again:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded bg-emerald-100 px-2 py-1 font-mono text-sm text-emerald-900">
                {createdSecret}
              </code>
              <Button size="sm" variant="secondary" onClick={() => setCreatedSecret(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end"
            onSubmit={handleCreate}
          >
            <div className="flex-1">
              <FormField
                label="Endpoint URL"
                htmlFor="webhook-url"
                error={createError ?? undefined}
              >
                <Input
                  id="webhook-url"
                  placeholder="https://example.com/api/webhooks/zipzap"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </FormField>
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? 'Registering…' : 'Register endpoint'}
            </Button>
          </form>
        )}
      </section>

      {/* 2. Registered Endpoints */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-slate-900">Registered endpoints</h2>
        {endpoints.error ? (
          <ErrorState message={endpoints.error} retry={endpoints.reload} />
        ) : endpoints.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (endpoints.data ?? []).length === 0 ? (
          <EmptyState
            title="No webhook endpoints"
            description="Add a webhook URL above to start receiving notifications."
          />
        ) : (
          <Table
            columns={[
              {
                header: 'URL',
                cell: (row) => <span className="font-mono text-sm text-slate-800">{row.url}</span>,
              },
              {
                header: 'Events',
                cell: (row) => (
                  <div className="flex flex-wrap gap-1">
                    {row.events.map((ev) => (
                      <Badge key={ev} tone="neutral">
                        {ev}
                      </Badge>
                    ))}
                  </div>
                ),
              },
              {
                header: 'Status',
                cell: (row) => (
                  <Badge tone={row.status === 'ACTIVE' ? 'success' : 'warning'}>{row.status}</Badge>
                ),
              },
              {
                header: 'Created',
                cell: (row) => (
                  <span className="text-xs text-slate-500">
                    {new Date(row.createdAt).toLocaleDateString('en-GB')}
                  </span>
                ),
              },
            ]}
            rows={endpoints.data ?? []}
            rowKey={(row) => row.id}
          />
        )}
      </section>

      {/* 3. Delivery Log & Replay */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium text-slate-900">Delivery log</h2>
            <p className="text-xs text-slate-500">
              Every attempt, response status, and terminal outcome.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={deliveries.reload}>
            Refresh
          </Button>
        </div>

        {replayedInfo ? (
          <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            {replayedInfo}
          </div>
        ) : null}

        {deliveries.error ? (
          <ErrorState message={deliveries.error} retry={deliveries.reload} />
        ) : deliveries.loading ? (
          <Skeleton className="h-32 w-full" />
        ) : (deliveries.data?.data ?? []).length === 0 ? (
          <EmptyState
            title="No delivery attempts yet"
            description="Events will log here as they are dispatched to your endpoints."
          />
        ) : (
          <Table
            columns={[
              {
                header: 'Event',
                cell: (row) => (
                  <span className="font-mono text-xs font-semibold">{row.eventType}</span>
                ),
              },
              {
                header: 'Attempt',
                cell: (row) => <span className="text-xs text-slate-600">#{row.attempt}</span>,
              },
              {
                header: 'Status',
                cell: (row) => (
                  <Badge
                    tone={
                      row.statusCode && row.statusCode >= 200 && row.statusCode < 300
                        ? 'success'
                        : row.terminal
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {row.statusCode ? `${row.statusCode}` : (row.error ?? 'Pending')}
                  </Badge>
                ),
              },
              {
                header: 'Time',
                cell: (row) => (
                  <span className="text-xs text-slate-500">
                    {new Date(row.attemptedAt).toLocaleTimeString('en-GB')}
                  </span>
                ),
              },
              {
                header: 'Action',
                cell: (row) =>
                  row.terminal && !row.delivered ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={replayingId === row.id}
                      onClick={() => handleReplay(row.id)}
                    >
                      {replayingId === row.id ? 'Replaying…' : 'Replay'}
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  ),
              },
            ]}
            rows={deliveries.data?.data ?? []}
            rowKey={(row) => row.id}
          />
        )}
      </section>
    </div>
  );
}
