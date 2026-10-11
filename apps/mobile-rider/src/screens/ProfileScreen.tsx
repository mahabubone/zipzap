import { useQuery } from '@tanstack/react-query';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  ListRow,
  Muted,
  Overline,
  Skeleton,
} from '../components/ui.tsx';
import { colors, radius, space, typography } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';
import type { AutoSync } from '../hooks/useAutoSync.ts';

/**
 * Who the server thinks this device is, and the state of the queue on it.
 *
 * `getMe` is the check against a stale session: if the token was revoked the query fails and the
 * rider signs in again, rather than queueing a day of work under a dead principal that the server
 * will reject on sync.
 *
 * The screen is a header card (who you are) followed by the two rows that matter (queue, device),
 * because a profile screen that reads as a form is a profile screen nobody opens.
 */
export function ProfileScreen({
  riderClient,
  onSignOut,
  autoSync,
}: {
  riderClient: RiderClient;
  onSignOut: () => void;
  autoSync: AutoSync;
}) {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => riderClient.client.getMe(),
  });

  // Up to two initials from the rider id, so the header has a face. A rider id is not a name, and
  // a letter is the honest thing to show from one.
  const initials = riderClient.riderId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-2)
    .toUpperCase();

  const sessionState = me.isLoading
    ? 'loading'
    : me.isError
      ? 'invalid'
      : me.data
        ? 'active'
        : 'empty';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <LinearGradient
        colors={[colors.brand, colors.brandPressed]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <Avatar initials={initials || 'R'} size={64} />
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{riderClient.riderId}</Text>
          <Text style={styles.headerSub}>ZipZap Rider</Text>
        </View>
        <View style={styles.sessionBadge}>
          {sessionState === 'active' ? (
            <Badge label="Signed in" tone="success" dot />
          ) : sessionState === 'invalid' ? (
            <Badge label="Session ended" tone="danger" dot />
          ) : (
            <Badge label="Checking…" tone="neutral" dot />
          )}
        </View>
      </LinearGradient>

      {/* The session line, which is the only thing on this screen that can cost the rider a day of
          work if it goes wrong. Everything else is presentational. */}
      {sessionState === 'invalid' && (
        <View style={styles.warnBox}>
          <Icon name="alert-circle" size="sm" color={colors.danger} />
          <Muted style={styles.warnText}>
            The server does not recognise this session. Sign out and sign in again before queueing
            more work.
          </Muted>
        </View>
      )}

      {sessionState === 'active' && me.data !== undefined && (
        <Card>
          <Overline>Session</Overline>
          <View style={styles.kv}>
            <Text style={styles.k}>Principal</Text>
            <Text style={styles.v} numberOfLines={1}>
              {me.data.subjectId}
            </Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.k}>Scopes</Text>
            <Text style={styles.v}>{me.data.scopes.length} granted</Text>
          </View>
        </Card>
      )}

      <Card style={styles.queueCard}>
        <Overline>Device queue</Overline>
        <QueueSummary riderClient={riderClient} autoSync={autoSync} />
      </Card>

      <Card style={styles.rowsCard}>
        <ListRow
          icon="sync-circle"
          label="Sync status"
          value={autoSync.offline ? 'Offline' : autoSync.syncing ? 'Syncing' : 'Online'}
        />
        <View style={styles.rowDivider} />
        <ListRow
          icon="server-outline"
          label="API"
          value={(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(
            /^https?:\/\//,
            '',
          )}
        />
      </Card>

      <Button label="Sign out" icon="log-out-outline" onPress={onSignOut} tone="ghost" block />
      <Muted style={styles.footNote}>
        Signing out does not discard the queue. Anything you have queued stays here until it syncs
        or you clear it from the device.
      </Muted>
    </ScrollView>
  );
}

function QueueSummary({ riderClient, autoSync }: { riderClient: RiderClient; autoSync: AutoSync }) {
  const summary = useQuery({
    queryKey: ['queue-summary'],
    queryFn: async () => ({
      pending: (await riderClient.queue.pending()).length,
      settled: (await riderClient.queue.settled()).length,
    }),
  });

  if (summary.isLoading) {
    return <Skeleton width="60%" height={14} />;
  }
  if (summary.isError || !summary.data) return <Muted>Could not read the queue.</Muted>;

  const { pending, settled } = summary.data;
  if (pending === 0 && settled === 0) {
    return <Muted>Nothing queued. Scans you take will appear here.</Muted>;
  }

  return (
    <View style={styles.queue}>
      <View style={[styles.queueStat, pending > 0 && styles.queueStatActive]}>
        <Text style={[styles.queueNum, pending > 0 && styles.queueNumActive]}>{pending}</Text>
        <Text style={styles.queueLabel}>waiting</Text>
      </View>
      <View style={styles.queueStat}>
        <Text style={styles.queueNum}>{settled}</Text>
        <Text style={styles.queueLabel}>done</Text>
      </View>
      <View style={styles.queueHint}>
        <Icon
          name={autoSync.offline ? 'cloud-offline' : 'cloud-done'}
          size="sm"
          color={autoSync.offline ? colors.warning : colors.success}
        />
        <Text style={styles.queueHintText}>
          {autoSync.offline ? 'Syncs when back online' : 'Flushes automatically'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },

  header: {
    borderRadius: radius.lg,
    padding: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  headerText: { flex: 1, gap: space.xxs },
  headerTitle: { ...typography.heading, color: colors.onBrand },
  headerSub: { ...typography.caption, color: 'rgba(255,255,255,0.8)' },
  sessionBadge: { alignSelf: 'flex-start' },

  warnBox: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
  },
  warnText: { flex: 1, ...typography.caption, color: colors.danger },

  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.xs,
  },
  k: { ...typography.caption, color: colors.textMuted },
  v: { ...typography.label, fontVariant: ['tabular-nums'], maxWidth: 200 },

  queueCard: { gap: space.sm },
  queue: { flexDirection: 'row', gap: space.md, alignItems: 'stretch' },
  queueStat: {
    flex: 1,
    backgroundColor: colors.sunken,
    borderRadius: radius.sm,
    padding: space.md,
    alignItems: 'center',
    gap: space.xxs,
  },
  queueStatActive: { backgroundColor: colors.warningBg },
  queueNum: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  queueNumActive: { color: colors.warning },
  queueLabel: { ...typography.caption, color: colors.textMuted },
  queueHint: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
  },
  queueHintText: { ...typography.caption, color: colors.textMuted, flex: 1 },

  rowsCard: { padding: 0, overflow: 'hidden' },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  footNote: { ...typography.caption, textAlign: 'center', paddingHorizontal: space.md },
});
