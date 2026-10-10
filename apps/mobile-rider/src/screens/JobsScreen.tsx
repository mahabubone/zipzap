import { useQuery } from '@tanstack/react-query';
import { JOBS_QUERY_KEY } from '../navigation.tsx';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Badge, Card, Muted, Title } from '../components/ui.tsx';
import { colors, space } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';

/**
 * The rider's home feed: today's pickups and delivery jobs in one
 * list, newest first. Read-only — the actions live on the job screen,
 * because every action is an offline-queued command and belongs to
 * the parcel it acts on.
 *
 * TanStack Query owns the cache. A pull-to-refresh refetches; there
 * is no manual cache mutation anywhere, because the server is the
 * only source of truth and the queue is the only write path.
 */

export function JobsScreen({
  riderClient,
  onOpenJob,
}: {
  riderClient: RiderClient;
  onOpenJob: (job: JobRow) => void;
}) {
  const query = useQuery({
    queryKey: [JOBS_QUERY_KEY],
    queryFn: () => riderClient.client.riderJobs(riderClient.riderId, 100),
  });

  const jobs = toJobRows(query.data as RiderJobs | undefined);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Title>Today&apos;s Jobs</Title>
        {query.isFetching && !query.isRefetching ? null : (
          <Text style={styles.count}>
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
          </Text>
        )}
      </View>

      {query.isLoading ? (
        <View style={styles.center}>
          <Muted>Loading jobs…</Muted>
        </View>
      ) : query.isError ? (
        <View style={styles.center}>
          <Muted>Could not load jobs. They will appear when you sync.</Muted>
        </View>
      ) : jobs.length === 0 ? (
        <View style={styles.center}>
          <Muted>No jobs assigned to you today.</Muted>
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(job) => job.key}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={query.refetch}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => <JobCard job={item} onPress={() => onOpenJob(item)} />}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

/**
 * One row in the merged feed. `kind` decides which actions the job screen offers.
 *
 * Exported because the job and proof screens resolve their route param back into this row — see
 * `useJobFromRoute` in navigation.tsx. The alternative, passing the row as a navigation param, would
 * copy a projection into navigation state where it goes stale silently.
 */
export interface JobRow {
  readonly key: string;
  readonly kind: 'pickup' | 'delivery';
  readonly id: string;
  readonly shipmentId: string | null;
  readonly title: string;
  readonly status: string;
  readonly detail: string;
  readonly createdAt: string;
}

/**
 * The jobs query's cached value, as the raw server response.
 *
 * Exported so the navigation layer can re-read this query and resolve a route's `{ jobId }` back
 * into a row, rather than carrying rows through navigation params.
 */
export interface RiderJobs {
  readonly pickups: ReadonlyArray<{
    id: string;
    shipmentIds: readonly string[];
    status: string;
    totalWeightGrams: number;
    createdAt: string;
  }>;
  readonly deliveries: ReadonlyArray<{
    id: string;
    shipmentId: string;
    status: string;
    attemptsMade: number;
    lastFailureReason: string | null;
    createdAt: string;
  }>;
}

/** Projects the query into rows. Exported so the job screens do not re-implement the mapping. */
export function toJobRows(data: RiderJobs | undefined): JobRow[] {
  if (!data || !Array.isArray(data.pickups) || !Array.isArray(data.deliveries)) return [];
  const pickups: JobRow[] = data.pickups.map((p) => ({
    key: `pickup-${p.id}`,
    kind: 'pickup',
    id: p.id,
    shipmentId: p.shipmentIds[0] ?? null,
    title: `Pickup ${p.shipmentIds.length} ${p.shipmentIds.length === 1 ? 'parcel' : 'parcels'}`,
    status: p.status,
    detail: `${p.totalWeightGrams}g · ${p.shipmentIds.length} shipment${
      p.shipmentIds.length === 1 ? '' : 's'
    }`,
    createdAt: p.createdAt,
  }));
  const deliveries: JobRow[] = data.deliveries.map((d) => ({
    key: `delivery-${d.id}`,
    kind: 'delivery',
    id: d.id,
    shipmentId: d.shipmentId,
    title: `Delivery ${shortId(d.shipmentId)}`,
    status: d.status,
    detail:
      d.attemptsMade > 0
        ? `Attempt ${d.attemptsMade}${d.lastFailureReason ? ` · ${d.lastFailureReason}` : ''}`
        : 'Not yet attempted',
    createdAt: d.createdAt,
  }));
  // Newest first across both kinds — the order the server already
  // returns each list in, merged by timestamp.
  return [...pickups, ...deliveries].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function JobCard({ job, onPress }: { job: JobRow; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button">
      <Card style={styles.jobCard}>
        <View style={styles.jobTop}>
          <Text style={styles.jobTitle}>{job.title}</Text>
          <Badge label={job.status} tone={statusTone(job.status)} />
        </View>
        <Text style={styles.jobDetail}>{job.detail}</Text>
        <View style={styles.jobFooter}>
          <Text style={styles.jobKind}>{job.kind === 'pickup' ? 'PICKUP' : 'DELIVERY'}</Text>
          <Text style={styles.jobTime}>{timeAgo(job.createdAt)}</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

/** Status tone: terminal states are green, failures red, the rest neutral. */
function statusTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (status) {
    case 'DELIVERED':
    case 'COMPLETED':
    case 'COLLECTED':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'ATTEMPTED':
    case 'EXCEPTION':
      return 'warning';
    default:
      return 'neutral';
  }
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  count: { fontSize: 13, color: colors.textMuted },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  jobCard: { marginBottom: space.md },
  jobTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  jobTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  jobDetail: { fontSize: 13, color: colors.textMuted, marginBottom: space.sm },
  jobFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  jobKind: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  jobTime: { fontSize: 11, color: colors.textFaint },
});
