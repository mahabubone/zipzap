import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { Badge, Button, Card, Muted, Title } from '../components/ui.tsx';
import { colors, space } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';
import type { AutoSync } from '../hooks/useAutoSync.ts';

/**
 * Who the server thinks this device is. `getMe` is the check against a
 * stale session: if the token was revoked the query fails and the rider
 * signs in again, rather than queueing a day of work under a dead
 * principal that the server will reject on sync.
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

  return (
    <View style={styles.screen}>
      <Title>Profile</Title>
      <View style={styles.gap} />
      <Card>
        <Text style={styles.label}>Rider</Text>
        <Text style={styles.value}>{riderClient.riderId}</Text>
        <View style={styles.gap} />
        {me.isLoading ? (
          <Muted>Checking session…</Muted>
        ) : me.isError ? (
          <>
            <Badge label="SESSION INVALID" tone="danger" />
            <View style={styles.gap} />
            <Muted>
              The server does not recognise this session. Sign out and sign in again before queueing
              more work.
            </Muted>
          </>
        ) : me.data ? (
          <>
            <Badge label="SESSION ACTIVE" tone="success" />
            <View style={styles.gap} />
            <Muted>{`Principal ${me.data.subjectId} · ${me.data.scopes.length} scope${me.data.scopes.length === 1 ? '' : 's'}`}</Muted>
          </>
        ) : (
          <Muted>Session response was empty — sign in again.</Muted>
        )}
      </Card>
      <Card>
        <Text style={styles.label}>Device queue</Text>
        <QueueSummary riderClient={riderClient} />
      </Card>
      <Button label="Sign out" onPress={onSignOut} tone="ghost" />
    </View>
  );
}

function QueueSummary({ riderClient }: { riderClient: RiderClient }) {
  const summary = useQuery({
    queryKey: ['queue-summary'],
    queryFn: async () => ({
      pending: (await riderClient.queue.pending()).length,
      settled: (await riderClient.queue.settled()).length,
    }),
  });

  if (summary.isLoading) return <Muted>Reading queue…</Muted>;
  if (summary.isError || !summary.data) return <Muted>Could not read the queue.</Muted>;
  return (
    <Muted>
      {`${summary.data.pending} pending · ${summary.data.settled} settled. Pending work stays on this device until it syncs.`}
    </Muted>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  gap: { height: space.sm },
  label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 2 },
  value: { fontSize: 17, fontWeight: '600', color: colors.text },
});
