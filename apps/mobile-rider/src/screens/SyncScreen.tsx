import { useCallback, useState } from 'react';
import { useFocusEffect } from '../hooks/useFocusEffect.ts';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, Muted, Title } from '../components/ui.tsx';
import { colors, space } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';
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
}: {
  riderClient: RiderClient;
  onSynced: (pending: number) => void;
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

  useFocusEffect(refresh);

  const syncNow = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await riderClient.sync();
      setMessage(
        result.sent === 0
          ? 'Nothing to sync — the queue is already empty.'
          : `Synced ${result.sent} command${result.sent === 1 ? '' : 's'}.`,
      );
      await refresh();
      onSynced(result.queueRemaining);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sync failed — the queue is untouched.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Title>Sync</Title>
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
