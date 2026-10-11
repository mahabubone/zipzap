/**
 * "Your day" — the rider's home, and the screen the revmap builds first.
 *
 * A rider opens this app to answer four questions: am I working, what have I got, what am I
 * carrying, and what's next. The old home answered the second one only, so the other three were
 * invisible. This is all four, in the order a rider asks them.
 *
 * The figures here are **device-scoped and say so**. Cash is what this phone has recorded and the
 * server has ruled on — no balance endpoint exists, and inventing one is not this screen's job. A
 * number that claims to be more than it is would be worse than a number that honestly says where it
 * comes from, so the labels state the boundary rather than implying a wallet.
 */

import { useQuery } from '@tanstack/react-query';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Skeleton } from '../components/ui.tsx';
import { isJobInShift } from '../rules/shift.ts';
import { CASH_LIMIT_MINOR, computeCashInHand, formatCash } from '../rules/cash.ts';
import { formatDuration, useShift } from '../hooks/useShift.ts';
import { colors, radius, space, typography } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';
import type { JobRow, RiderJobs } from './JobsScreen.tsx';

/** The jobs query key, shared with the feed so both read one cache. */
const JOBS_QUERY_KEY = 'rider-jobs';

/** Cash is read from the queue itself, so it cannot disagree with what will actually replay. */
const CASH_QUERY_KEY = 'rider-cash-in-hand';

export function HomeScreen({
  riderClient,
  offline,
  onOpenJob,
}: {
  riderClient: RiderClient;
  /** From `useAutoSync`. Changes what a tap will do, so it belongs beside the work. */
  offline: boolean;
  onOpenJob: (job: JobRow) => void;
}) {
  const shift = useShift(riderClient.riderId);

  const query = useQuery({
    queryKey: [JOBS_QUERY_KEY],
    queryFn: () => riderClient.client.riderJobs(riderClient.riderId, 100),
  });

  const cash = useQuery({
    queryKey: [CASH_QUERY_KEY],
    queryFn: async () => {
      const [pending, settled] = await Promise.all([
        riderClient.queue.pending(),
        riderClient.queue.settled(),
      ]);
      return computeCashInHand(pending, settled);
    },
  });

  const all = query.data ? toRows(query.data) : [];
  // No shift means nothing is filtered: a rider who has not started one still sees the whole
  // feed, because hiding work from someone who has not been offered the choice to start is worse
  // than showing it.
  const jobs =
    shift.active === null
      ? all
      : all.filter((job) => isJobInShift(job.createdAt, shift.active!.startedAt));

  const done = jobs.filter((job) => job.status === 'DELIVERED').length;
  const cashInHand = cash.data?.collectedMinor ?? 0;
  const overLimit = cash.data?.shouldBlock === true;

  return (
    <FlatList
      data={jobs}
      keyExtractor={(job) => job.key}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          tintColor={colors.brand}
          colors={[colors.brand]}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <ShiftCard
            shift={shift}
            onStart={() => void shift.start(riderClient.riderId)}
            onEnd={() => void shift.end()}
          />

          <View style={styles.statRow}>
            <StatCard
              label="Jobs"
              value={String(jobs.length)}
              detail={done > 0 ? `${done} done` : 'none done yet'}
              icon="bicycle"
              loading={query.isLoading}
            />
            <StatCard
              label="In hand"
              value={formatCash(cashInHand)}
              detail={
                cash.data?.shouldWarn ? 'over 80% of carry limit' : 'estimated on this device'
              }
              icon="wallet"
              tone={cash.data?.shouldWarn ? 'warning' : 'default'}
              loading={cash.isLoading}
            />
          </View>

          {overLimit && (
            <View style={[styles.banner, styles.bannerBlock]}>
              <Icon name="warning" size="sm" color={colors.danger} />
              <Text style={[styles.bannerText, styles.bannerTextBlock]}>
                You are at the carry limit ({formatCash(5_000_000)}). Deposit before collecting
                more.
              </Text>
            </View>
          )}

          {offline && (
            <View style={styles.offlineChip}>
              <Icon name="cloud-offline" size="sm" color={colors.warning} />
              <Text style={styles.offlineLabel}>Offline — work is queued safely</Text>
            </View>
          )}

          <Text style={styles.sectionLabel}>
            {shift.active === null ? 'All jobs' : "Today's jobs"}
          </Text>
        </View>
      }
      ListEmptyComponent={
        query.isLoading ? (
          <View style={styles.skeletons}>
            {[0, 1, 2].map((index) => (
              <View key={index} style={styles.skeletonCard}>
                <Skeleton width="45%" height={16} />
                <Skeleton width="70%" height={13} />
              </View>
            ))}
          </View>
        ) : query.isError ? (
          <ErrorState
            title="Could not load your jobs"
            detail="They will appear once you have signal again. Anything you have queued is safe."
            onRetry={() => void query.refetch()}
          />
        ) : (
          <EmptyState
            icon={shift.active === null ? 'time-outline' : 'bicycle-outline'}
            title={shift.active === null ? 'Start your shift' : 'Nothing assigned yet'}
            detail={
              shift.active === null
                ? 'Starting a shift means the jobs you see are the ones from this shift, not yesterday’s.'
                : 'When a merchant or dispatcher assigns you a pickup or a delivery, it shows up here.'
            }
            action={
              shift.active === null
                ? {
                    label: 'Start shift',
                    icon: 'play',
                    onPress: () => void shift.start(riderClient.riderId),
                  }
                : { label: 'Refresh', icon: 'refresh', onPress: () => void query.refetch() }
            }
          />
        )
      }
      renderItem={({ item }) => <JobPreview job={item} onPress={() => onOpenJob(item)} />}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

/**
 * The shift: is the rider working, and for how long.
 *
 * The one control on this card that is not a display. Starting and ending are both explicit: the
 * rider says when their day starts, which is why the job feed can then trust the boundary.
 */
function ShiftCard({
  shift,
  onStart,
  onEnd,
}: {
  shift: ReturnType<typeof useShift>;
  onStart: () => void;
  onEnd: () => void;
}) {
  if (shift.loading) {
    return (
      <Card style={styles.shiftCard}>
        <Skeleton width="50%" height={18} />
      </Card>
    );
  }

  const active = shift.active;
  return (
    <Card style={styles.shiftCard}>
      <View style={styles.shiftTop}>
        <View style={styles.shiftLeft}>
          <View style={[styles.shiftDot, active ? styles.shiftDotOn : styles.shiftDotOff]} />
          <Text style={styles.shiftTitle}>{active ? 'On shift' : 'Off shift'}</Text>
        </View>
        {active !== null && (
          <Text style={styles.shiftTime}>{formatDuration(active.minutesOnShift)}</Text>
        )}
      </View>

      <Text style={styles.shiftDetail}>
        {active !== null
          ? 'Jobs assigned since you started this shift appear below. Ending the shift does not discard anything you have queued.'
          : 'Start a shift and the jobs listed below become the ones from this shift only — a rider on a shared device is never handed yesterday’s work.'}
      </Text>

      <Button
        label={active !== null ? 'End shift' : 'Start shift'}
        icon={active !== null ? 'stop' : 'play'}
        onPress={active !== null ? onEnd : onStart}
        tone={active !== null ? 'ghost' : 'primary'}
        size="sm"
      />
    </Card>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon,
  tone = 'default',
  loading,
}: {
  label: string;
  value: string;
  detail: string;
  icon: 'bicycle' | 'wallet';
  tone?: 'default' | 'warning';
  loading?: boolean;
}) {
  return (
    <Card style={styles.statCard}>
      <View style={styles.statHead}>
        <Icon name={icon} size="sm" color={colors.brand} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      {loading === true ? (
        <Skeleton width={64} height={26} />
      ) : (
        <Text
          style={[styles.statValue, tone === 'warning' && styles.statValueWarn]}
          numberOfLines={1}
        >
          {value}
        </Text>
      )}
      <Text style={styles.statDetail}>{detail}</Text>
    </Card>
  );
}

function JobPreview({ job, onPress }: { job: JobRow; onPress: () => void }) {
  const tone = job.status === 'DELIVERED' ? 'success' : job.kind === 'pickup' ? 'info' : 'brand';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${job.kind === 'pickup' ? 'Pickup' : 'Delivery'}: ${job.title}, ${job.status}`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={styles.jobCard}>
        <View style={styles.jobTop}>
          <Text style={styles.jobTitle} numberOfLines={1}>
            {job.title}
          </Text>
          <Badge label={job.status.replace(/_/g, ' ')} tone={tone} dot />
        </View>
        <Text style={styles.jobDetail} numberOfLines={1}>
          {job.detail}
        </Text>
      </Card>
    </Pressable>
  );
}

/**
 * Project the query into rows.
 *
 * `createdAt` is when the server assigned the job, not when the rider looked at it — the
 * distinction the shift rule is built on.
 */
function toRows(data: RiderJobs): JobRow[] {
  const pickups: JobRow[] = (data.pickups ?? []).map((p) => ({
    key: `pickup-${p.id}`,
    kind: 'pickup',
    id: p.id,
    shipmentId: p.shipmentIds?.[0] ?? null,
    title: `Pickup ${p.shipmentIds?.length ?? 0} parcel${(p.shipmentIds?.length ?? 0) === 1 ? '' : 's'}`,
    status: p.status,
    detail: `${(p.totalWeightGrams ?? 0) / 1000} kg`,
    createdAt: p.createdAt,
  }));
  const deliveries: JobRow[] = (data.deliveries ?? []).map((d) => ({
    key: `delivery-${d.id}`,
    kind: 'delivery',
    id: d.id,
    shipmentId: d.shipmentId,
    title: `Delivery ${d.shipmentId?.slice(0, 8) ?? ''}`,
    status: d.status,
    detail: d.attemptsMade > 0 ? `Attempt ${d.attemptsMade}` : 'Not yet attempted',
    createdAt: d.createdAt,
  }));

  return [...pickups, ...deliveries].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  separator: { height: space.md },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },

  header: { gap: space.md, paddingBottom: space.md },
  shiftCard: { gap: space.sm, paddingVertical: space.md },
  shiftTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shiftLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shiftDot: { width: 10, height: 10, borderRadius: 5 },
  shiftDotOn: { backgroundColor: colors.success },
  shiftDotOff: { backgroundColor: colors.textFaint },
  shiftTitle: { ...typography.heading },
  shiftTime: { ...typography.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  shiftDetail: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },

  statRow: { flexDirection: 'row', gap: space.md },
  statCard: { flex: 1, gap: space.xxs, paddingVertical: space.md },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  statLabel: { ...typography.overline, color: colors.textFaint },
  statValue: { fontSize: 24, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  statValueWarn: { color: colors.warning },
  statDetail: { ...typography.caption, color: colors.textMuted },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.warningBg,
    borderColor: colors.warningBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
  },
  bannerBlock: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  bannerText: { ...typography.caption, color: colors.warning, flex: 1, fontWeight: '600' },
  bannerTextBlock: { color: colors.danger },

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
    alignSelf: 'flex-start',
  },
  offlineLabel: { ...typography.caption, fontWeight: '700', color: colors.warning },

  sectionLabel: { ...typography.overline, color: colors.textFaint, paddingTop: space.xs },

  jobCard: { paddingVertical: space.md },
  jobTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  jobTitle: { ...typography.bodyStrong, flex: 1 },
  jobDetail: { ...typography.caption, color: colors.textMuted, marginTop: space.xxs },

  skeletons: { gap: space.md },
  skeletonCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
});
