import { useQuery } from '@tanstack/react-query';
import { JOBS_QUERY_KEY } from '../navigation.tsx';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, EmptyState, ErrorState, Icon, Skeleton, Title } from '../components/ui.tsx';
import { colors, radius, space, typography } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';
import { toJobRows } from '../handoff/job-rows.ts';
import type { JobRow, RiderJobs, ShipmentHandoff } from '../handoff/job-rows.ts';
import { formatAge } from '@zipzap/lexicon';
import { jobTone, statusLabel } from '../status.ts';

/**
 * Re-exported so screens that already import from this module keep importing from here, and so
 * there is one definition of a job row rather than a view layer and a pure layer that must agree.
 */
export type { JobRow, RiderJobs, ShipmentHandoff } from '../handoff/job-rows.ts';

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
  offline,
  onOpenJob,
}: {
  riderClient: RiderClient;
  /** From `useAutoSync`. Shown because it changes what tapping a job will actually do. */
  offline: boolean;
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
        <View style={styles.headerText}>
          {/* A greeting rather than a bare title. A rider opening this nine times a shift should
              not be told what screen they are on; they should be told what state they are in. */}
          <Text style={styles.greeting}>{greeting()}</Text>
          <Title>{jobs.length === 0 ? 'No jobs yet' : `${jobs.length} today`}</Title>
        </View>
        {/* The one piece of ambient state worth a coloured chip: offline, because it changes what
            a tap will do. Everything else belongs on the Sync screen. */}
        {offline && (
          <View style={styles.offlineChip}>
            <Icon name="cloud-offline" size="sm" color={colors.warning} />
            <Text style={styles.offlineLabel}>Offline</Text>
          </View>
        )}
      </View>

      {query.isLoading ? (
        <JobsSkeleton />
      ) : query.isError ? (
        <ErrorState
          title="Could not load your jobs"
          detail="They will appear once you have signal again. Anything you have already queued is safe."
          onRetry={() => void query.refetch()}
        />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon="bicycle-outline"
          title="Nothing assigned to you"
          detail="When a merchant or a dispatcher assigns you a pickup or a delivery, it shows up here."
          action={{ label: 'Refresh', icon: 'refresh', onPress: () => void query.refetch() }}
        />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(job) => job.key}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={query.refetch}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          renderItem={({ item }) => <JobCard job={item} onPress={() => onOpenJob(item)} />}
          contentContainerStyle={styles.list}
          // A row separator keeps a list of cards from reading as one block, and is cheaper than
          // a margin on every card.
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

/** Skeleton rows for the first paint, shaped like the real cards. */
function JobsSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={styles.skeletonCard}>
          <View style={styles.skeletonTop}>
            <Skeleton width="45%" height={16} />
            <Skeleton width={64} height={20} radius={999} />
          </View>
          <Skeleton width="70%" height={13} />
          <Skeleton width="35%" height={13} />
        </View>
      ))}
    </View>
  );
}

/** Good morning / afternoon / evening. Deliberately not the rider's name — no RTT on a dock. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function JobCard({ job, onPress }: { job: JobRow; onPress: () => void }) {
  const tone = jobTone(job.status);
  // A coloured rail down the leading edge, so the list is scannable by colour alone: a rider can
  // find the one failed delivery without reading a word.
  // Every tone the mapping can produce, so a state added tomorrow cannot render a rail with no
  // colour — which would look like "this job has no state" rather than "this job has a new one".
  const rail = {
    success: colors.success,
    danger: colors.danger,
    warning: colors.warning,
    brand: colors.brand,
    info: colors.info,
    neutral: colors.borderStrong,
  }[tone];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${job.kind === 'pickup' ? 'Pickup' : 'Delivery'}, ${job.title}, ${statusLabel(job.status)}`}
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <View style={styles.cardOuter}>
        <View style={[styles.rail, { backgroundColor: rail }]} />
        <Card style={styles.jobCard}>
          <View style={styles.jobTop}>
            <View
              style={[
                styles.kindChip,
                job.kind === 'pickup' ? styles.kindPickup : styles.kindDelivery,
              ]}
            >
              <Icon
                name={job.kind === 'pickup' ? 'cube' : 'navigate'}
                size="sm"
                color={job.kind === 'pickup' ? colors.brand : colors.text}
              />
              <Text style={styles.kindLabel}>{job.kind === 'pickup' ? 'PICKUP' : 'DELIVERY'}</Text>
            </View>
            <Text style={styles.jobTime}>{formatAge(job.createdAt)}</Text>
          </View>

          <Text style={styles.jobTitle}>{job.title}</Text>
          <Text style={styles.jobDetail}>{job.detail}</Text>

          <View style={styles.jobFooter}>
            <Badge label={statusLabel(job.status)} tone={tone} dot />
            <View style={styles.jobCta}>
              <Text style={styles.jobCtaLabel}>Open</Text>
              <Icon name="chevron-forward" size="sm" color={colors.brand} />
            </View>
          </View>
        </Card>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
    gap: space.md,
  },
  headerText: { flex: 1, gap: space.xxs },
  greeting: { ...typography.overline, color: colors.textFaint },
  offlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.warningBg,
    borderColor: colors.warningBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  offlineLabel: { ...typography.caption, fontWeight: '700', color: colors.warning },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  separator: { height: space.md },
  cardPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },

  cardOuter: { position: 'relative' },
  rail: {
    position: 'absolute',
    left: 0,
    top: space.md,
    bottom: space.md,
    width: 3,
    borderRadius: radius.pill,
  },
  jobCard: { marginLeft: space.sm, paddingVertical: space.md },
  jobTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  jobTime: { ...typography.caption, color: colors.textFaint, fontVariant: ['tabular-nums'] },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  kindPickup: { backgroundColor: colors.brandSoft },
  kindDelivery: { backgroundColor: colors.neutralBg },
  kindLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: colors.text },
  jobTitle: { ...typography.heading, marginBottom: space.xxs },
  jobDetail: { ...typography.caption, color: colors.textMuted, marginBottom: space.sm },
  jobFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  jobCta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  jobCtaLabel: { ...typography.label, fontSize: 12, color: colors.brand },

  skeletonCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  skeletonTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
