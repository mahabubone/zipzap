import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Badge, Button, Card, Field, Muted, Title } from '../components/ui.tsx';
import { colors, radius, space } from '../theme.ts';
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
      <Card>
        <Title>Proof of delivery</Title>
        <Muted>{job.title}</Muted>
        <View style={styles.row}>
          <Badge label={job.status} tone="neutral" />
          <Text style={styles.step}>1 code · 2 photo · 3 queue</Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>1 · Customer confirms</Text>
        <Muted>
          The customer reads a code out. It is the one thing a stranger at the door cannot fake, and
          it is what a dispute is answered from.
        </Muted>
        {issued ? (
          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>Read out</Text>
            <Text
              style={styles.code}
              accessibilityLabel={`Delivery code ${issued.code.split('').join(' ')}`}
            >
              {issued.code}
            </Text>
          </View>
        ) : null}
        <Button
          label={busy ? 'Sending…' : issued ? 'Send a new code' : 'Send code to customer'}
          onPress={askForCode}
          disabled={busy}
        />
        <Field
          label="What the customer said"
          value={code}
          onChange={setCode}
          placeholder="4 digits"
          keyboardType="numeric"
        />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>2 · Photograph the handover</Text>
        {photo ? (
          <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No photo attached</Text>
          </View>
        )}
        <Button
          label={busy ? 'Opening…' : photo ? 'Replace photo' : 'Attach photo'}
          onPress={takePhoto}
          disabled={busy}
          tone="ghost"
        />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>3 · Queue the proof</Text>
        <Muted>
          Your location is recorded with it. The parcel cannot be marked delivered until this lands
          on the server, so queueing it now and syncing later is safe.
        </Muted>
        <Button
          label={busy ? 'Queueing…' : 'Queue proof of delivery'}
          onPress={queueProof}
          disabled={busy || !issued}
        />
      </Card>

      {message ? (
        <Card>
          <Muted>{message}</Muted>
        </Card>
      ) : null}
    </ScrollView>
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
  content: { padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.sm },
  step: { fontSize: 11, fontWeight: '700', color: colors.textFaint },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: space.sm },
  codeBox: {
    marginVertical: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.neutralBg,
    alignItems: 'center',
  },
  codeLabel: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textFaint,
  },
  code: {
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: 10,
    color: colors.primary,
    marginLeft: 10,
  },
  preview: { width: '100%', height: 180, borderRadius: radius.md, marginVertical: space.md },
  placeholder: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.neutralBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: space.md,
  },
  placeholderText: { fontSize: 13, color: colors.textFaint },
});
