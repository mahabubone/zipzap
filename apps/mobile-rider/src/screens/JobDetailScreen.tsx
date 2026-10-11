import { useCallback, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Badge, Button, Card, Field, Icon, Muted } from '../components/ui.tsx';
import { JobMissing } from '../navigation.tsx';
import { actionsFor, isFinalAttempt, primaryAction, type JobAction } from '../rules/job-actions.ts';
import { contactHint, contactLabel, contactStateFor, telHref } from '../rules/contact.ts';
import { formatCash } from '../rules/cash.ts';
import { colors, radius, space, typography } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';
import type { JobRow, ShipmentHandoff } from './JobsScreen.tsx';

/** Statuses a rider cannot act on at all. */
const TERMINAL = new Set(['DELIVERED', 'COMPLETED', 'COLLECTED', 'CANCELLED', 'RETURNED']);

/** Failure reasons the server's closed vocabulary names. */
const FAILURE_REASONS = [
  'CUSTOMER_UNAVAILABLE',
  'CUSTOMER_REFUSED',
  'WRONG_ADDRESS',
  'PAYMENT_FAILED',
  'CASH_UNAVAILABLE',
  'PARCEL_DAMAGED',
  'AREA_UNREACHABLE',
  'NATURAL_CALAMITY',
  'OTHER',
] as const;

/**
 * The four a rider actually reaches for. The rest exist for the audit trail, not for the door, and
 * hiding them is why the primary path is fast rather than a nine-way choice.
 */
const LIKELY_REASONS = FAILURE_REASONS.slice(0, 4);

/** Attempts made, from the job payload rather than parsed from display copy. */
function attemptsMadeOf(job: JobRow): number {
  if (job.kind !== 'delivery') return 0;
  const match = /^Attempt (\d+)$/.exec(job.detail);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * One job, as a decision.
 *
 * The old screen was three equal-weight forms and a choice of nine failure reasons: a rider at a
 * door had to work out which of them was the next thing to do. Now the screen computes the one legal
 * primary action and shows only that, with the supporting paths beneath it at a visibly lower weight
 * and reachable in a tap.
 *
 * What is deliberately unchanged: every action the old screen offered is still reachable.
 */
export function JobDetailScreen({
  riderClient,
  job,
  onQueued,
  onCaptureProof,
}: {
  riderClient: RiderClient;
  job: JobRow | null;
  onQueued: (pending: number) => void;
  onCaptureProof: () => void;
}) {
  const [parcelId, setParcelId] = useState('');
  const [note, setNote] = useState('');
  const [cash, setCash] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [moreReasons, setMoreReasons] = useState(false);
  const [expanded, setExpanded] = useState<'deliver' | 'fail' | 'scan' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshPending = useCallback(async () => {
    onQueued((await riderClient.queue.pending()).length);
  }, [riderClient, onQueued]);

  if (job === null) {
    return <JobMissing />;
  }

  const primary = primaryAction(job);
  const supporting = actionsFor(job).filter((action) => action.weight === 'secondary');
  const attempts = attemptsMadeOf(job);
  const handoff = job.shipment;
  const final = isFinalAttempt(attempts);

  const run = async (command: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await command();
      setMessage(success);
      await refreshPending();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not queue that.');
    } finally {
      setBusy(false);
    }
  };

  const queueScan = () =>
    run(async () => {
      const id = parcelId.trim() || job.shipmentId;
      if (!id) throw new Error('Type or scan a parcel id first.');
      const result = await riderClient.recordPickup(job.id, id);
      setParcelId('');
      return result;
    }, 'Pickup scan queued. It syncs when signal returns.');

  const queueAttempt = () => {
    if (!reason) {
      setMessage('Pick a reason so the dispatcher knows why.');
      return;
    }
    if (!job.shipmentId) {
      setMessage('This delivery has no parcel to record against.');
      return;
    }
    return run(
      async () =>
        riderClient.recordDeliveryAttempt(
          job.id,
          job.shipmentId!,
          reason,
          note.trim() || undefined,
        ),
      final
        ? 'Final failed attempt queued. The parcel goes to returns.'
        : 'Failed attempt queued. It syncs when signal returns.',
    );
  };

  const queueDelivery = () =>
    run(async () => {
      if (!job.shipmentId) throw new Error('This delivery has no parcel to complete.');
      const minor = cash.trim() === '' ? 0 : Number(cash.trim());
      if (!Number.isInteger(minor) || minor < 0) {
        throw new Error('Cash collected must be a whole number of poisha (e.g. 125050).');
      }
      await riderClient.recordDelivery(job.shipmentId);
      if (minor > 0) await riderClient.recordCodCollection(job.shipmentId, minor);
      setCash('');
      return undefined;
    }, 'Delivery queued. Capture proof of delivery for the photo and the code.');

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
          </View>
        )}

        {attempts > 0 && (
          <View style={styles.heroMeta}>
            <Icon
              name={final ? 'warning' : 'information-circle'}
              size="sm"
              color={final ? colors.warning : colors.textMuted}
            />
            <Text style={styles.heroMetaText}>
              {final
                ? `Attempt ${attempts} — after this one the parcel goes to returns.`
                : `Attempt ${attempts} so far.`}
            </Text>
          </View>
        )}

        {/* The one action a rider cannot do their job without. Present on every delivery,
            and now live: the job carries a phone number (revmap R6), so this dials. */}
        <ContactRow job={job} handoff={job.shipment} />
      </Card>

      {primary !== null && (
        <Card style={styles.primaryCard}>
          <ActionHeader action={primary} />
          <Muted style={styles.primaryDetail}>{primary.detail}</Muted>
          <View style={styles.primaryFields}>
            {primary.id === 'scan' && (
              <>
                <Field
                  label="Parcel id"
                  icon="barcode-outline"
                  value={parcelId}
                  onChange={setParcelId}
                  placeholder={job.shipmentId ?? 'Scan or type the parcel id'}
                  hint="Either type it or scan it. It queues offline either way."
                />
                <Button
                  label={busy ? 'Queueing…' : 'Queue pickup scan'}
                  icon="cloud-upload-outline"
                  onPress={queueScan}
                  disabled={busy}
                  loading={busy}
                  block
                  size="lg"
                />
              </>
            )}

            {primary.id === 'fail' && (
              <AttemptForm
                attempts={attempts}
                final={final}
                reason={reason}
                note={note}
                moreReasons={moreReasons}
                busy={busy}
                onReason={setReason}
                onNote={setNote}
                onMoreReasons={() => setMoreReasons(true)}
                onSubmit={queueAttempt}
              />
            )}

            {primary.id === 'deliver' && (
              <>
                <Field
                  label={
                    handoff && handoff.codAmountMinor > 0
                      ? `Cash collected — ${formatCash(handoff.codAmountMinor)} due`
                      : 'Cash collected (poisha)'
                  }
                  icon="wallet-outline"
                  value={cash}
                  onChange={setCash}
                  placeholder="125050 — blank means prepaid"
                  keyboardType="numeric"
                  hint={
                    handoff && handoff.codAmountMinor > 0
                      ? `This parcel is prepaid up to ${formatCash(handoff.codAmountMinor)}. Collecting less than that is fine; collecting more is not.`
                      : 'Blank means prepaid. Whole poisha only — a decimal is refused rather than rounded, because a rider hands over cash, not a float.'
                  }
                />
                <Button
                  label="Capture proof of delivery"
                  icon="camera-outline"
                  onPress={onCaptureProof}
                  block
                  size="lg"
                />
                <View style={styles.divider} />
                <Button
                  label="Queue delivery without proof"
                  onPress={queueDelivery}
                  disabled={busy}
                  tone="ghost"
                  loading={busy}
                />
                {/* Ghost on purpose. Proof is the normal path; this is the path for a customer who is
                    not there to give a code. Making it prominent teaches riders to skip proof. */}
              </>
            )}
          </View>
        </Card>
      )}

      {supporting.length > 0 && (
        <Card style={styles.supportCard}>
          <Text style={styles.supportLabel}>Or instead</Text>
          {supporting.map((action) => (
            <TouchableOpacity
              key={action.id}
              onPress={() => setExpanded(expanded === action.id ? null : action.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: expanded === action.id }}
              style={styles.supportRow}
            >
              <View style={styles.supportIcon}>
                <Icon name={action.icon} size="sm" color={colors.textMuted} />
              </View>
              <View style={styles.supportText}>
                <Text style={styles.supportTitle}>{action.label}</Text>
                <Text style={styles.supportDetail}>{action.detail}</Text>
              </View>
              <Icon
                name={expanded === action.id ? 'chevron-down' : 'chevron-forward'}
                size="sm"
                color={colors.textFaint}
              />
            </TouchableOpacity>
          ))}

          {/* The form for whichever supporting action was tapped, revealed in place rather than
              pushed. Only `fail` has a secondary form today; the rest describe what would happen
              without pretending to offer it. */}
          {expanded === 'fail' && (
            <AttemptForm
              attempts={attempts}
              final={final}
              reason={reason}
              note={note}
              moreReasons={moreReasons}
              busy={busy}
              onReason={setReason}
              onNote={setNote}
              onMoreReasons={() => setMoreReasons(true)}
              onSubmit={queueAttempt}
            />
          )}

          {expanded === 'scan' && (
            <View style={styles.supportForm}>
              <Muted style={styles.supportFormHint}>
                This parcel is picked up from the shop by scanning it there. The scan happens on the
                pickup job, not this one.
              </Muted>
            </View>
          )}

          {expanded === 'deliver' && (
            <View style={styles.supportForm}>
              <Muted style={styles.supportFormHint}>
                A delivery is completed from the primary action above, with proof of delivery.
              </Muted>
            </View>
          )}
        </Card>
      )}

      {primary === null && supporting.length === 0 && (
        <Card>
          <View style={styles.closedHead}>
            <Icon name="checkmark-circle" size="sm" color={colors.success} />
            <Text style={styles.closedTitle}>
              {TERMINAL.has(job.status) ? 'This job is done' : 'Nothing left to do here'}
            </Text>
          </View>
          <Muted style={styles.closedDetail}>
            {TERMINAL.has(job.status)
              ? `This job is ${job.status.toLowerCase().replace(/_/g, ' ')}.`
              : 'The server will not accept another action on this job right now. Pull to refresh if that looks wrong.'}
          </Muted>
        </Card>
      )}

      {primary === null && supporting.length > 0 && (
        <Card>
          <Text style={styles.supportOnly}>
            The main action is not available right now. Use one of the options above.
          </Text>
        </Card>
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

/** A supporting action's heading, sized for its weight rather than the primary one. */
function ActionHeader({ action }: { action: JobAction }) {
  return (
    <View style={styles.primaryHead}>
      <View style={styles.primaryIcon}>
        <Icon name={action.icon} size="sm" color={colors.brand} />
      </View>
      <Text style={styles.primaryLabel}>{action.label}</Text>
    </View>
  );
}

/** What `AttemptForm` needs to draw and drive the failure path. */
interface AttemptFormProps {
  readonly attempts: number;
  readonly final: boolean;
  readonly reason: string | null;
  readonly note: string;
  readonly moreReasons: boolean;
  readonly busy: boolean;
  readonly onReason: (reason: string | null) => void;
  readonly onNote: (note: string) => void;
  readonly onMoreReasons: () => void;
  readonly onSubmit: () => void;
}

/**
 * The failed-attempt form.
 *
 * Extracted because the screen now shows it in two places: as the primary action once a delivery
 * has been tried, and as a supporting action before that. Sharing one component is what keeps the
 * two from drifting into two different question sets — a reason offered in one context and not the
 * other is a rider who guesses.
 *
 * The likely reasons come first and the rest stay folded. Nine equal chips is a state machine in a
 * costume; four obvious ones is a decision.
 */
function AttemptForm({
  attempts,
  final,
  reason,
  note,
  moreReasons,
  busy,
  onReason,
  onNote,
  onMoreReasons,
  onSubmit,
}: AttemptFormProps) {
  return (
    <View style={styles.attemptForm}>
      <Text style={styles.reasonLabel}>
        {final
          ? 'Last attempt — after this the parcel goes to returns'
          : attempts > 0
            ? 'Why did this attempt fail?'
            : 'Why did the delivery fail?'}
      </Text>

      <View style={styles.reasons}>
        {(moreReasons ? FAILURE_REASONS : LIKELY_REASONS).map((r) => (
          <TouchableOpacity
            key={r}
            onPress={() => onReason(reason === r ? null : r)}
            style={[styles.reason, reason === r && styles.reasonActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: reason === r }}
          >
            {reason === r && <Icon name="checkmark" size="sm" color={colors.onBrand} />}
            <Text style={[styles.reasonText, reason === r && styles.reasonTextActive]}>
              {r.replace(/_/g, ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!moreReasons && (
        <Button
          label={`${FAILURE_REASONS.length - LIKELY_REASONS.length} more reasons`}
          icon="chevron-down"
          onPress={onMoreReasons}
          tone="ghost"
          size="sm"
        />
      )}

      <Field
        label="Note (optional)"
        icon="document-text-outline"
        value={note}
        onChange={onNote}
        placeholder="Gate code, neighbour, …"
      />

      <Button
        label={busy ? 'Queueing…' : 'Queue failed attempt'}
        icon="alert-circle-outline"
        onPress={onSubmit}
        disabled={!reason || busy}
        tone="danger"
        loading={busy}
        block
        size="lg"
      />
    </View>
  );
}

/**
 * The customer contact row.
 *
 * Now live: revmap R6 put a phone number on the delivery job, so `telHref` returns something and
 * the button dials. The three-state model survives because it is still the honest one — a pickup
 * has no customer, and a job whose parcel vanished has no number — but the common case is a working
 * call rather than an apology.
 */
function ContactRow({ job, handoff }: { job: JobRow; handoff: ShipmentHandoff | null }) {
  const state = contactStateFor(job, handoff?.recipientPhone ?? null, handoff === null);
  const href = telHref(state);

  return (
    <View style={styles.contactRow}>
      <View style={styles.contactText}>
        <Text style={styles.contactLabel}>{contactLabel(state)}</Text>
        <Text style={styles.contactHint}>
          {handoff?.recipientName !== null && handoff?.recipientName !== undefined
            ? `${handoff.recipientName} · ${state.kind === 'ready' ? handoff.recipientPhone : ''}`
            : contactHint(state)}
        </Text>
      </View>
      {href !== null ? (
        <TouchableOpacity
          onPress={() => void Linking.openURL(href)}
          accessibilityRole="button"
          accessibilityLabel={`Call customer on ${handoff?.recipientPhone ?? ''}`}
          style={styles.contactButton}
        >
          <Icon name="call" size="sm" color={colors.onBrand} />
          <Text style={styles.contactButtonLabel}>Call</Text>
        </TouchableOpacity>
      ) : (
        <Icon name="call-outline" size="sm" color={colors.textFaint} />
      )}
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
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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
  heroIdValue: { ...typography.label, fontFamily: 'monospace', fontSize: 12, color: colors.text },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  heroMetaText: { ...typography.caption, color: colors.textMuted, flex: 1 },

  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  contactText: { flex: 1, gap: space.xxs },
  contactLabel: { ...typography.label, fontSize: 14 },
  contactHint: { ...typography.caption, color: colors.textMuted, lineHeight: 17 },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  contactButtonLabel: { ...typography.label, fontSize: 13, color: colors.onBrand },

  primaryCard: { gap: space.sm, paddingVertical: space.lg },
  primaryHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  primaryIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { ...typography.heading, flex: 1 },
  primaryDetail: { fontSize: 13, lineHeight: 19 },
  primaryFields: { gap: space.md, marginTop: space.xs },

  supportCard: { paddingVertical: space.md },
  supportLabel: { ...typography.overline, color: colors.textFaint, marginBottom: space.xs },
  supportForm: { marginTop: space.sm },
  supportFormHint: { fontSize: 13, lineHeight: 19 },
  supportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  supportIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.neutralBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportText: { flex: 1, gap: space.xxs },
  supportTitle: { ...typography.label, fontSize: 14 },
  supportDetail: { ...typography.caption, color: colors.textMuted },

  closedHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  closedTitle: { ...typography.heading },
  closedDetail: { fontSize: 13, lineHeight: 19 },
  supportOnly: { ...typography.caption, color: colors.textMuted },

  reasonLabel: { ...typography.label, color: colors.textMuted },
  attemptForm: { gap: space.md, marginTop: space.md },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
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
  reasonText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  reasonTextActive: { color: colors.onBrand },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

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
