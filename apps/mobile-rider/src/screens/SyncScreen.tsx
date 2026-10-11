import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, Muted, ProgressBar, Title } from '../components/ui.tsx';
import { colors, radius, space, typography } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';
import type { AutoSync } from '../hooks/useAutoSync.ts';
import type { Settled } from '../offline/command-queue.ts';

/**
 * The connectivity screen: what is queued, what the server ruled, and the
 * one button that flushes. Pending rows show `expectedState.shipmentStatus`
 * because that is what the rider believed when they pressed — the ruling
 * beside it is what the server says now. A rejection is not an error to
 * hide; it is the answer to "why didn't my scan count", with the reason
 * the server recorded.
 */
export function SyncScreen({
  riderClient,
  onSynced,
  autoSync,
}: {
  riderClient: RiderClient;
  onSynced: (pending: number) => void;
  autoSync: AutoSync;
}) {
  const [pending, setPending] = useState<
    Array<{ deviceSequence: number; commandType: string; believed: string }>
  >([]);
  const [settled, setSettled] = useState<readonly Settled[]>([]);
  const [capWarning, setCapWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = await riderClient.queue.pending();
    setPending(
      rows.map((c) => ({
        deviceSequence: c.deviceSequence,
        commandType: c.commandType,
        believed: believedOf(c.expectedState),
      })),
    );
    setSettled(await riderClient.queue.settled());
    setCapWarning(await riderClient.queue.capWarning());
  }, [riderClient]);

  // React Navigation's own focus hook, not the app's shim. The shim existed because there was no
  // navigator to fire a focus event; now there is, and the shim's `useIsFocused` is the very thing
  // this wraps.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  /**
   * Sync now, bypassing the auto-sync's connectivity gate.
   *
   * Deliberately not `autoSync.syncNow()` alone: the rider pressing a button wants the queue state
   * as well as the flush, and a flush that succeeded without refreshing the list would show
   * "Pending (3)" with nothing pending.
   */
  const syncNow = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    // Captured before the flush: it is the count the rider pressed the button with, and reporting it
    // afterwards would say "synced 0" for a queue that was empty when they tapped.
    const before = pending.length;
    try {
      await autoSync.syncNow();
      setMessage(
        before === 0
          ? 'Nothing to sync — the queue is already empty.'
          : `Synced ${before} command${before === 1 ? '' : 's'}.`,
      );
      await refresh();
    } catch (err) {
      // The queue is untouched on a failure, so the rider can walk to where there is signal. Rule 3
      // of the queue: refusing is safe, losing a scan is not.
      setMessage(err instanceof Error ? err.message : 'Sync failed — the queue is untouched.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Title>Sync</Title>

      {/* Connectivity first: the rider's question on opening this screen is "will it sync", and
          answering it after the queue state means they look at a list they cannot act on. */}
      {/* The connectivity card, with the state as a coloured pill and a one-line rule rather
          than three paragraphs of grey. A rider glances at this; they do not read it. */}
      <Card style={styles.statusCard}>
        <View style={styles.statusHead}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: autoSync.offline
                  ? colors.warning
                  : autoSync.syncing
                    ? colors.brand
                    : colors.success,
              },
            ]}
          />
          <Text style={styles.statusLabel}>
            {autoSync.offline ? 'Offline' : autoSync.syncing ? 'Syncing' : 'Online'}
          </Text>
          {pending.length > 0 && <Text style={styles.statusCount}>{pending.length} waiting</Text>}
        </View>

        <Muted style={styles.statusBody}>
          {autoSync.offline
            ? 'Nothing leaves this device until signal returns. Every scan is queued and safe — it flushes itself when you are back online.'
            : autoSync.syncing
              ? 'Flushing the queue now.'
              : 'Connected. Scans flush themselves as soon as signal returns.'}
        </Muted>

        {/* Retry visibility, only once it is actually retrying: a rider does not need to know
            about attempt 1, but they do need to know when the app has given up and is waiting. */}
        {autoSync.attempts > 0 && (
          <View style={styles.attempts}>
            <ProgressBar
              value={autoSync.attempts / 8}
              tone={autoSync.attempts >= 8 ? 'danger' : 'warning'}
              height={4}
            />
            <Text style={styles.attemptsLabel}>
              {autoSync.attempts >= 8
                ? 'Tried 8 times and stopped. Tap Sync now when you have signal.'
                : `Retrying — attempt ${autoSync.attempts} of 8.`}
            </Text>
          </View>
        )}
      </Card>

      {capWarning ? (
        <Card>
          <Badge label="QUEUE NEARLY FULL" tone="warning" />
          <View style={styles.gap} />
          <Muted>
            Find signal and sync before the queue hits its cap — beyond it new scans are refused
            rather than silently dropped.
          </Muted>
        </Card>
      ) : null}
      <Card>
        <Text style={styles.cardTitle}>Pending ({pending.length})</Text>
        {pending.length === 0 ? (
          <Muted>Nothing waiting. Queue a scan and it lands here first.</Muted>
        ) : (
          pending.map((p) => (
            <View key={p.deviceSequence} style={styles.row}>
              <Text style={styles.seq}>#{p.deviceSequence}</Text>
              <View style={styles.rowBody}>
                <Text style={styles.command}>{p.commandType}</Text>
                <Muted>{`Believed: ${p.believed}`}</Muted>
              </View>
              <Badge label="QUEUED" tone="warning" />
            </View>
          ))
        )}
        <View style={styles.gap} />
        <Button
          label={busy ? 'Syncing…' : `Sync now (${pending.length})`}
          onPress={syncNow}
          disabled={pending.length === 0 || busy}
        />
      </Card>
      {message ? (
        <Card>
          <Muted>{message}</Muted>
        </Card>
      ) : null}
      <Card>
        <Text style={styles.cardTitle}>Settled ({settled.length})</Text>
        {settled.length === 0 ? (
          <Muted>No rulings yet — sync to get the server&apos;s answers.</Muted>
        ) : (
          settled.slice(-20).map((s) => (
            <View key={s.deviceSequence} style={styles.row}>
              <Text style={styles.seq}>#{s.deviceSequence}</Text>
              <View style={styles.rowBody}>
                <Text style={styles.command}>{settledLabel(s)}</Text>
              </View>
              <Badge
                label={s.kind.toUpperCase()}
                tone={
                  s.kind === 'applied' ? 'success' : s.kind === 'rejected' ? 'danger' : 'neutral'
                }
              />
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

function believedOf(expectedState: Readonly<Record<string, unknown>>): string {
  const status =
    (expectedState['shipmentStatus'] as string | undefined) ??
    (expectedState['status'] as string | undefined);
  return status ?? 'unknown';
}

function settledLabel(s: Settled): string {
  switch (s.kind) {
    case 'applied':
      return 'Applied';
    case 'rejected':
      return s.reason;
    case 'duplicate':
      return `Already counted (${s.serverSaid})`;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  gap: { height: space.sm },
  statusCard: { padding: space.lg, gap: space.sm },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { ...typography.heading, flex: 1 },
  statusCount: {
    ...typography.label,
    color: colors.warning,
    fontVariant: ['tabular-nums'],
  },
  statusBody: { fontSize: 13, lineHeight: 19 },
  attempts: { marginTop: space.xs, gap: space.xs },
  attemptsLabel: { ...typography.caption, color: colors.textMuted },

  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  seq: { fontSize: 13, fontWeight: '700', color: colors.textFaint, minWidth: 36 },
  rowBody: { flex: 1 },
  command: { fontSize: 13, color: colors.text, fontWeight: '600' },
});
