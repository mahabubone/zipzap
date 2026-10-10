import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Badge, Button, Card, Field, Muted, Title } from '../components/ui.tsx';
import { colors, space } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';
import type { JobRow } from './JobsScreen.tsx';

/**
 * One job, three write paths — scan, fail with a reason, succeed with cash.
 *
 * Every action appends to the OfflineQueue and returns immediately. The
 * rider sees "Queued" and can keep working with no signal; `sync()` replays
 * later, exactly once, and the Sync tab reports the server's ruling. An
 * action that waited for the network first would lose the rider's whole
 * screen to a spinner in exactly the dead zones this app exists for.
 *
 * "Queue delivery" is a doorway, not a button: the server will not mark a
 * parcel delivered without a proof behind it, so the tap opens the proof
 * screen instead of queueing something the sync would reject. Making the
 * rider discover that from a rejection on the Sync tab, ten minutes later,
 * on a bad connection, is the failure this routing exists to prevent.
 */

/** Closed failure vocabulary, matching the server's FAILURE_REASONS. */
const FAILURE_REASONS = [
  'CUSTOMER_UNAVAILABLE',
  'WRONG_ADDRESS',
  'PHONE_UNREACHABLE',
  'CUSTOMER_REFUSED',
  'ADDRESS_INCOMPLETE',
  'PAYMENT_ISSUE',
  'DAMAGED_PACKAGE',
  'WEATHER',
  'OPERATIONAL_EXCEPTION',
] as const;

export function JobDetailScreen({
  riderClient,
  job,
  onBack,
  onQueued,
  onCaptureProof,
}: {
  riderClient: RiderClient;
  job: JobRow;
  onBack: () => void;
  onQueued: (pending: number) => void;
  onCaptureProof: () => void;
}) {
  const [scan, setScan] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** Recompute the tab badge after an action, from the queue itself. */
  const refreshPending = async () => {
    onQueued((await riderClient.queue.pending()).length);
  };

  const queuePickupScan = async () => {
    const shipmentId = scan.trim() || job.shipmentId;
    if (!shipmentId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const queued = await riderClient.recordPickup(job.id, shipmentId);
      setScan('');
      setMessage(`Queued pickup scan #${queued.deviceSequence}.`);
      await refreshPending();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not queue the scan.');
    } finally {
      setBusy(false);
    }
  };

  const queueAttempt = async () => {
    if (!reason || !job.shipmentId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const queued = await riderClient.recordDeliveryAttempt(
        job.id,
        job.shipmentId,
        reason,
        note.trim() || undefined,
      );
      setReason(null);
      setNote('');
      setMessage(`Queued attempt #${queued.deviceSequence}: ${reason}.`);
      await refreshPending();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not queue the attempt.');
    } finally {
      setBusy(false);
    }
  };

  const queueComplete = async () => {
    if (!job.shipmentId || busy) return;
    const minor = cash.trim() === '' ? 0 : Number(cash.trim());
    if (!Number.isInteger(minor) || minor < 0) {
      setMessage('Cash collected must be a whole number of poisha (e.g. 125050).');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await riderClient.recordDelivery(job.shipmentId);
      if (minor > 0) await riderClient.recordCodCollection(job.shipmentId, minor);
      setCash('');
      setMessage(`Queued delivery${minor > 0 ? ` with ${minor} poisha COD` : ''}.`);
      await refreshPending();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not queue the delivery.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Button label="‹ All jobs" onPress={onBack} tone="ghost" />
      <View style={styles.gap} />
      <Card>
        <Title>{job.title}</Title>
        <View style={styles.row}>
          <Badge label={job.status} tone="neutral" />
          <Text style={styles.kind}>{job.kind === 'pickup' ? 'PICKUP' : 'DELIVERY'}</Text>
        </View>
        <Muted>{job.detail}</Muted>
        {job.shipmentId ? <Muted>{`Shipment ${job.shipmentId}`}</Muted> : null}
      </Card>

      {job.kind === 'pickup' ? (
        <Card>
          <Text style={styles.cardTitle}>Pickup scan</Text>
          <Field
            label="Shipment ID"
            value={scan}
            onChange={setScan}
            placeholder={job.shipmentId ?? 'Scan or type the parcel id'}
          />
          <Button
            label={busy ? 'Queueing…' : 'Queue pickup scan'}
            onPress={queuePickupScan}
            disabled={busy}
          />
        </Card>
      ) : (
        <>
          <Card>
            <Text style={styles.cardTitle}>Delivery attempt</Text>
            <View style={styles.reasons}>
              {FAILURE_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setReason(reason === r ? null : r)}
                  style={[styles.reason, reason === r && styles.reasonActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reason === r }}
                >
                  <Text style={[styles.reasonLabel, reason === r && styles.reasonLabelActive]}>
                    {r.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Field
              label="Note (optional)"
              value={note}
              onChange={setNote}
              placeholder="Gate code, neighbour, …"
            />
            <Button
              label={busy ? 'Queueing…' : 'Queue failed attempt'}
              onPress={queueAttempt}
              disabled={!reason || busy}
              tone="danger"
            />
          </Card>
          <Card>
            <Text style={styles.cardTitle}>Complete with COD</Text>
            <Muted>
              A parcel cannot be marked delivered without proof: the customer reading out a code, a
              photo, and where it happened.
            </Muted>
            <Field
              label="Cash collected (poisha)"
              value={cash}
              onChange={setCash}
              placeholder="125050 — blank means prepaid"
              keyboardType="numeric"
            />
            <Button label="Capture proof of delivery" onPress={onCaptureProof} disabled={busy} />
            <View style={styles.gap} />
            <Button
              label={busy ? 'Queueing…' : 'Queue delivery'}
              onPress={queueComplete}
              disabled={busy}
              tone="ghost"
            />
          </Card>
        </>
      )}

      {message ? (
        <Card>
          <Muted>{message}</Muted>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  gap: { height: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.sm },
  kind: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: space.md },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  reason: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.card,
  },
  reasonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  reasonLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  reasonLabelActive: { color: colors.primaryText },
});
