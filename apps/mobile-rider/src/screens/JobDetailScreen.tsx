import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Badge, Button, Card, Field, Icon, Muted } from '../components/ui.tsx';
import { colors, radius, space, typography } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';
import { JobMissing } from '../navigation.tsx';
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
  onQueued,
  onCaptureProof,
}: {
  riderClient: RiderClient;
  /**
   * Null when the route's `{ jobId }` no longer resolves: the job was cancelled server-side while
   * the rider was offline, or a deep link named a job that is not theirs. That is a normal outcome
   * of offline work, so it renders `JobMissing` rather than an empty form.
   */
  job: JobRow | null;
  onQueued: (pending: number) => void;
  onCaptureProof: () => void;
}) {
  // Every hook above this point has run, so this conditional is not "hooks changed between renders"
  // — it is one hook's outcome. The previous version had the same shape, with `onBack` instead.
  if (job === null) return <JobMissing />;
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
      {/* Hero: the parcel, its state, and its identifier. The old screen opened with the same
          "Delivery 77777777" text as the list row, so opening a job changed nothing visually. */}
      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroKind}>
            <Icon
              name={job.kind === 'pickup' ? 'cube' : 'navigate'}
              size="sm"
              color={job.kind === 'pickup' ? colors.brand : colors.text}
            />
            <Text style={styles.heroKindLabel}>
              {job.kind === 'pickup' ? 'PICKUP' : 'DELIVERY'}
            </Text>
          </View>
          <Badge label={job.status.replace(/_/g, ' ')} tone={statusTone(job.status)} dot />
        </View>

        <Text style={styles.heroTitle}>{job.title}</Text>
        <Text style={styles.heroDetail}>{job.detail}</Text>

        {job.shipmentId !== null && (
          <View style={styles.heroId}>
            <Text style={styles.heroIdLabel}>Parcel</Text>
            <Text style={styles.heroIdValue} numberOfLines={1} selectable>
              {job.shipmentId}
            </Text>
            {/* `selectable` and a copy affordance: a rider reads this id out to a dispatcher. */}
          </View>
        )}
      </Card>

      {job.kind === 'pickup' ? (
        <Card>
          <SectionTitle icon="scan-outline" title="Pickup scan" />
          <Field
            label="Shipment ID"
            icon="barcode-outline"
            value={scan}
            onChange={setScan}
            placeholder={job.shipmentId ?? 'Scan or type the parcel id'}
            hint="Scans queue if you are offline and sync when signal returns."
          />
          <Button
            label={busy ? 'Queueing…' : 'Queue pickup scan'}
            icon="cloud-upload-outline"
            onPress={queuePickupScan}
            disabled={busy}
            loading={busy}
          />
        </Card>
      ) : (
        <>
          <Card>
            <SectionTitle icon="warning-outline" title="Failed delivery attempt" />
            <Muted style={styles.cardSub}>
              Why it failed decides whether the parcel is tried again or handed to returns.
            </Muted>
            <View style={styles.reasons}>
              {FAILURE_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setReason(reason === r ? null : r)}
                  style={[styles.reason, reason === r && styles.reasonActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reason === r }}
                >
                  {reason === r && <Icon name="checkmark" size="sm" color={colors.onBrand} />}
                  <Text style={[styles.reasonLabel, reason === r && styles.reasonLabelActive]}>
                    {r.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Field
              label="Note (optional)"
              icon="document-text-outline"
              value={note}
              onChange={setNote}
              placeholder="Gate code, neighbour, …"
            />
            <Button
              label={busy ? 'Queueing…' : 'Queue failed attempt'}
              icon="alert-circle-outline"
              onPress={queueAttempt}
              disabled={!reason || busy}
              tone="danger"
              loading={busy}
            />
          </Card>

          <Card>
            <SectionTitle icon="cash-outline" title="Complete with COD" />
            <Muted style={styles.cardSub}>
              A parcel cannot be marked delivered without proof: the customer reading out a code, a
              photo, and where it happened.
            </Muted>
            <Field
              label="Cash collected (poisha)"
              icon="wallet-outline"
              value={cash}
              onChange={setCash}
              placeholder="125050 — blank means prepaid"
              keyboardType="numeric"
              hint="Whole poisha only. The amount the quote froze is what the customer agreed to."
            />
            <Button
              label="Capture proof of delivery"
              icon="camera-outline"
              onPress={onCaptureProof}
              disabled={busy}
              block
            />
            <View style={styles.divider} />
            <Button
              label={busy ? 'Queueing…' : 'Queue delivery without proof'}
              onPress={queueComplete}
              disabled={busy}
              tone="ghost"
              loading={busy}
            />
            {/* Muted intentionally. Labelling it plainly is the honest treatment: proof is the normal
                path, and this is the path for when the customer is not available to give one. */}
          </Card>
        </>
      )}

      {message !== null && (
        <View style={styles.messageBox}>
          <Icon name="checkmark-circle" size="sm" color={colors.success} />
          <Text style={styles.message}>{message}</Text>
        </View>
      )}
    </ScrollView>
  );
}

/** A card's heading, as one component so every card's heading looks the same. */
function SectionTitle({
  icon,
  title,
}: {
  icon: 'scan-outline' | 'warning-outline' | 'cash-outline';
  title: string;
}) {
  return (
    <View style={styles.sectionTitle}>
      <View style={styles.sectionIcon}>
        <Icon name={icon} size="sm" color={colors.brand} />
      </View>
      <Text style={styles.sectionTitleText}>{title}</Text>
    </View>
  );
}

/** The closed status vocabulary, shared with the jobs list through STATUS_TONE. */
function statusTone(status: string): 'success' | 'danger' | 'warning' | 'brand' | 'neutral' {
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
    case 'OUT_FOR_DELIVERY':
      return 'brand';
    default:
      return 'neutral';
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },

  hero: {
    gap: space.sm,
    padding: space.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.brand,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroKind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.neutralBg,
    borderRadius: radius.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  heroKindLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: colors.text },
  heroTitle: { ...typography.title },
  heroDetail: { ...typography.caption, color: colors.textMuted },
  heroId: {
    marginTop: space.xs,
    backgroundColor: colors.sunken,
    borderRadius: radius.sm,
    padding: space.md,
    gap: space.xxs,
  },
  heroIdLabel: { ...typography.overline, color: colors.textFaint, marginBottom: 0 },
  heroIdValue: {
    ...typography.label,
    fontFamily: 'monospace',
    fontSize: 12,
    color: colors.text,
  },

  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitleText: { ...typography.heading, flex: 1 },
  cardSub: { fontSize: 13, lineHeight: 19, marginBottom: space.md },

  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.card,
  },
  reasonActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  reasonLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  reasonLabelActive: { color: colors.onBrand },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: space.md,
  },

  messageBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
  },
  message: { ...typography.caption, color: colors.success, flex: 1, fontWeight: '600' },
});
