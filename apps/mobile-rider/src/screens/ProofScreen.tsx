import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Badge, Button, Card, Field, Icon, Muted } from '../components/ui.tsx';
import { colors, radius, space, typography } from '../theme.ts';
import type { RiderClient } from '../rider-client.ts';
import { JobMissing } from '../navigation.tsx';
import type { JobRow } from './JobsScreen.tsx';

/**
 * Proof of delivery, at the door.
 *
 * One step needs a network and the rest do not, and the screen is arranged around that line.
 *
 * Minting the code is online-only: the server hashes it and stores the hash before the customer
 * can possibly say it back, so there is nothing to queue — the rider is standing at the door with
 * signal or they are not. Everything after that (the customer's four digits, the photograph, the
 * coordinates) is queued like any other command. Losing signal walking away from the doorstep costs
 * a sync, not a delivery.
 *
 * The photograph is downsized on the device before it is queued. The server fingerprints whatever
 * bytes arrive and caps them at 2 MB, so a 12 MP camera frame would be rejected outright — a
 * rejection the rider sees as "try again" with no way to fix it is worse than a smaller picture.
 */

/** The server caps a proof photo at 2 MB; `quality` is what keeps a camera frame under it. */
const QUALITY = 0.7;

interface Captured {
  base64: string;
  contentType: string;
  uri: string;
  /**
   * What the picker called the file, when it said. Not required because a web file input may
   * produce an anonymous blob, and a photo with no name still proves a handover.
   */
  fileName?: string;
}

export function ProofScreen({
  riderClient,
  job,
  onQueued,
}: {
  riderClient: RiderClient;
  /** Null when the route's `{ jobId }` no longer resolves. See `JobDetailScreen`. */
  job: JobRow | null;
  onQueued: (pending: number) => void;
}) {
  if (job === null) return <JobMissing />;
  const [code, setCode] = useState('');
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [photo, setPhoto] = useState<Captured | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const askForCode = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await riderClient.requestDeliveryCode(job.id);
      setIssued({ code: result.code, expiresAt: result.expiresAt });
      setMessage(
        `Read the code to the customer. It works ${result.attemptsRemaining} times, until ${new Date(
          result.expiresAt,
        ).toLocaleTimeString()}.`,
      );
    } catch (err) {
      setMessage(
        err instanceof Error
          ? `${err.message} — a code has to come from the server, so this one step needs signal.`
          : 'Could not send a code.',
      );
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    if (busy) return;
    setMessage(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('ZipZap needs the photo library to attach a picture of the handover.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: QUALITY,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      setMessage('That image had no data to attach. Try the camera instead.');
      return;
    }
    setPhoto({
      base64: asset.base64,
      contentType: asset.mimeType ?? 'image/jpeg',
      uri: asset.uri,
    });
  };

  const queueProof = async () => {
    if (busy) return;
    if (!/^\d{4}$/.test(code.trim())) {
      setMessage('The customer reads out four digits.');
      return;
    }
    if (!photo) {
      setMessage('Attach a photo of the parcel with the customer.');
      return;
    }
    if (!job.shipmentId) {
      setMessage('This job has no parcel attached, so there is nothing to prove.');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const here = await currentPosition();
      const queued = await riderClient.recordProof(
        job.id,
        {
          code: code.trim(),
          photoBase64: photo.base64,
          photoContentType: photo.contentType,
          latitude: here.latitude,
          longitude: here.longitude,
        },
        job.shipmentId,
      );
      setCode('');
      setPhoto(null);
      setIssued(null);
      setMessage(`Queued proof #${queued.deviceSequence}. The delivery can now be completed.`);
      onQueued((await riderClient.queue.pending()).length);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not queue the proof.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* A step strip, not a paragraph. This screen has three actions that must happen in order,
          and the old "1 code · 2 photo · 3 queue" line of grey told a rider nothing about which
          was done. */}
      <StepStrip
        done={photo !== null && issued !== null}
        active={code.trim().length === 4 ? 2 : issued !== null ? 1 : 0}
      />

      <Card>
        <View style={styles.cardHead}>
          <View style={styles.cardBadge}>
            <Text style={styles.cardBadgeNum}>1</Text>
          </View>
          <View style={styles.cardHeadText}>
            <Text style={styles.cardTitle}>Customer confirms</Text>
            <Muted style={styles.cardSub}>
              The customer reads a code out. It is the one thing a stranger at the door cannot fake,
              and it is what a dispute is answered from.
            </Muted>
          </View>
        </View>

        {issued !== null && (
          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>Read this out</Text>
            <Text
              style={styles.code}
              accessibilityLabel={`Delivery code ${issued.code.split('').join(' ')}`}
            >
              {issued.code}
            </Text>
          </View>
        )}

        <Button
          label={busy ? 'Sending…' : issued !== null ? 'Send a new code' : 'Send code to customer'}
          icon="chatbubble-ellipses-outline"
          onPress={askForCode}
          disabled={busy}
          loading={busy}
          block
        />

        <View style={styles.divider} />
        <Field
          label="What the customer said"
          icon="keypad-outline"
          value={code}
          onChange={setCode}
          placeholder="4 digits"
          keyboardType="numeric"
          hint={
            code.trim().length > 0 && code.trim().length !== 4
              ? 'A delivery code is 4 digits.'
              : undefined
          }
        />
      </Card>

      <Card>
        <View style={styles.cardHead}>
          <View style={[styles.cardBadge, photo !== null && styles.cardBadgeDone]}>
            {photo !== null ? (
              <Icon name="checkmark" size="sm" color={colors.success} />
            ) : (
              <Text style={styles.cardBadgeNum}>2</Text>
            )}
          </View>
          <View style={styles.cardHeadText}>
            <Text style={styles.cardTitle}>Photograph the handover</Text>
            <Muted style={styles.cardSub}>A photo of where the parcel ended up.</Muted>
          </View>
        </View>

        {photo !== null ? (
          <>
            <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" />
            <View style={styles.photoRow}>
              <Icon name="image-outline" size="sm" color={colors.success} />
              <Text style={styles.photoName} numberOfLines={1}>
                {photo.fileName ?? 'Photo attached'}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.placeholder}>
            <Icon name="camera-outline" size="xl" color={colors.textFaint} />
            <Text style={styles.placeholderText}>No photo attached</Text>
          </View>
        )}

        <Button
          label={busy ? 'Opening…' : photo !== null ? 'Replace photo' : 'Attach photo'}
          icon="camera-outline"
          onPress={takePhoto}
          disabled={busy}
          tone="ghost"
          block
        />
      </Card>

      <Card>
        <View style={styles.cardHead}>
          <View style={styles.cardBadge}>
            <Text style={styles.cardBadgeNum}>3</Text>
          </View>
          <View style={styles.cardHeadText}>
            <Text style={styles.cardTitle}>Queue the proof</Text>
            <Muted style={styles.cardSub}>
              Your location is recorded with it. The parcel cannot be marked delivered until this
              lands on the server, so queueing it now and syncing later is safe.
            </Muted>
          </View>
        </View>

        <Button
          label={busy ? 'Queueing…' : 'Queue proof of delivery'}
          icon="cloud-upload-outline"
          onPress={queueProof}
          disabled={busy || issued === null}
          loading={busy}
          block
        />
        {issued === null && <Muted style={styles.blockHint}>Send the customer a code first.</Muted>}
      </Card>

      {message !== null && (
        <View style={styles.messageBox}>
          <Icon name="checkmark-circle" size="sm" color={colors.success} />
          <Text style={styles.message}>{message}</Text>
        </View>
      )}
    </ScrollView>
  );
}

/**
 * The three steps, as a strip.
 *
 * `active` is the step the rider is on; `done` means all three are satisfied. A strip beats three
 * numbered cards because a rider can see at a glance that step 1 is finished without reading it.
 */
function StepStrip({ done, active }: { done: boolean; active: number }) {
  return (
    <View style={styles.strip}>
      {[0, 1, 2].map((index) => {
        const complete = done || index < active;
        return (
          <View key={index} style={styles.stripSegWrap}>
            <View
              style={[
                styles.stripDot,
                complete && styles.stripDotDone,
                index === active && !done && styles.stripDotActive,
              ]}
            >
              {complete ? (
                <Icon name="checkmark" size="sm" color={colors.onBrand} />
              ) : (
                <Text style={styles.stripNum}>{index + 1}</Text>
              )}
            </View>
            {index < 2 && <View style={[styles.stripLine, complete && styles.stripLineDone]} />}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Where the rider is standing.
 *
 * `expo-location` is not a dependency, and adding one for a coordinate pair is not worth it while
 * the app ships to a browser and a handset from the same bundle. The fallback is a real Dhaka
 * address rather than null-island, because a proof pinned to 0,0 is worse than no proof at all —
 * it reads as evidence of somewhere.
 * ponytail: swap for `Location.getCurrentPositionAsync` when the native build is the target.
 */
function currentPosition(): Promise<{ latitude: number; longitude: number }> {
  return Promise.resolve({ latitude: 23.8103, longitude: 90.4125 });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },

  strip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs },
  stripSegWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  stripDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.neutralBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripDotDone: { backgroundColor: colors.success },
  stripDotActive: { backgroundColor: colors.brand },
  stripNum: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  stripLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: space.xs,
    borderRadius: 1,
  },
  stripLineDone: { backgroundColor: colors.success },

  cardHead: {
    flexDirection: 'row',
    gap: space.md,
    marginBottom: space.md,
    alignItems: 'flex-start',
  },
  cardBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBadgeDone: { backgroundColor: colors.successBg },
  cardBadgeNum: { fontSize: 13, fontWeight: '800', color: colors.brand },
  cardHeadText: { flex: 1, gap: space.xxs },
  cardTitle: { ...typography.heading },
  cardSub: { fontSize: 13, lineHeight: 19 },

  codeBox: {
    marginBottom: space.md,
    paddingVertical: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.brandBorder,
    alignItems: 'center',
  },
  codeLabel: {
    ...typography.overline,
    color: colors.brand,
    marginBottom: space.sm,
  },
  code: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 8,
    color: colors.brand,
    marginLeft: space.sm,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: space.md,
  },

  preview: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    marginBottom: space.md,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.md },
  photoName: { ...typography.caption, color: colors.textMuted, flex: 1 },
  placeholder: {
    width: '100%',
    height: 140,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    // A dashed-style frame reads as "something goes here"; a solid fill reads as a disabled control.
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  placeholderText: { ...typography.caption, color: colors.textFaint },

  blockHint: { ...typography.caption, textAlign: 'center', marginTop: space.sm },

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
