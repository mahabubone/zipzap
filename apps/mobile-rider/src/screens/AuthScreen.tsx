import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ZipZapClient } from '@zipzap/api-client';
import { Button, Card, Field, Icon, Muted, Title } from '../components/ui.tsx';
import { colors, elevation, radius, space, typography } from '../theme.ts';
import type { RiderSession } from '../rider-client.ts';

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Rider sign-in.
 *
 * The screen a rider sees once per shift, so its job is to say three things quickly: this is ZipZap,
 * this is the rider app, and your work is safe even without signal. The old version was a white card
 * on grey with three unlabelled boxes, which said none of them.
 *
 * **The handle is a mobile number, not an email.** A rider in Dhaka is issued a SIM card at the
 * depot; they are not issued a mailbox, and they are not choosing a password they will remember at
 * 6am with a hundred parcels in the bag. Asking for an email meant one of two things, both bad:
 * the rider invents an address they will not remember, or they share the dispatcher's — and two
 * people typing the same credentials is indistinguishable from one person on two devices, so
 * every scan in the offline queue becomes ambiguous.
 *
 * The field says "Mobile number" and opens the numeric keypad, because a rider who is asked for an
 * email will try to type one, and the keyboard is the first thing that tells them what is expected.
 * The server normalises what arrives, so `01712345678`, `+8801712345678` and `+880 1712-345678` are
 * one account rather than three.
 *
 * Phone + password against `/v1/auth/token`, bearer token into a `RiderSession`. The rider still
 * picks which rider id they are on the device they hold, because the auth token identifies the
 * principal and `riderId` scopes the job feed and the sync queue. No auto-login: an explicit
 * sign-in keeps a shared device from silently acting as the previous rider.
 */
export function AuthScreen({ onSignIn }: { onSignIn: (s: RiderSession) => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [riderId, setRiderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A rider's number is 11 digits nationally and 13-14 in E.164, so a length floor is enough to
  // disable the button before they have finished typing. It is a floor and not a check: the server
  // is the only thing that can say whether a number is reachable, and a client-side rejection that
  // disagrees with the server is worse than an early submit that fails once.
  const canSubmit = phone.trim().length >= 10 && password.length > 0 && riderId.trim().length > 0;

  const signIn = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      // `/auth/token`, NOT `/auth/login`. A native app cannot hold a cookie, and `/auth/login` now
      // deliberately omits the token from its body because a browser console's script could read it
      // there. The token flow exists for exactly this caller.
      const probe = new ZipZapClient({ baseUrl });
      const session = await probe.loginToken(phone.trim(), password);
      onSignIn({
        riderId: riderId.trim(),
        token: session.token,
        expiresAt: session.expiresAt,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* A gradient masthead carrying the brand mark and the promise. `expo-linear-gradient` is
          pure JS + native views, so it works on the web export the shots use without a prebuild —
          which matters because the native bundle does not build here. */}
      <LinearGradient
        colors={[colors.brand, colors.brandPressed]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.masthead}
      >
        <View style={styles.mark}>
          <Icon name="flash" size="xl" color={colors.onBrand} />
        </View>
        <Text style={styles.appName}>ZipZap Rider</Text>
        <Text style={styles.tagline}>Offline-capable delivery</Text>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.formWrap}
      >
        <ScrollView
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Card style={styles.card}>
            <Title level="heading">Sign in</Title>
            <Muted style={styles.cardSub}>
              The number you were issued at the depot, and the rider id you work under.
            </Muted>

            <View style={styles.fields}>
              <Field
                label="Mobile number"
                icon="phone-portrait-outline"
                value={phone}
                onChange={setPhone}
                placeholder="01712345678"
                // The numeric keypad, not the default. A rider asked for an email will try to type
                // one; the keyboard is what tells them what is actually being asked for.
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
              />
              <Field
                label="Password"
                icon="lock-closed-outline"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                secureTextEntry
              />
              <Field
                label="Rider ID"
                icon="person-outline"
                value={riderId}
                onChange={setRiderId}
                placeholder="The rider you are working as"
                hint="The rider id your dispatcher assigned you, not your login."
              />
            </View>

            {error !== null && (
              <View style={styles.errorBox}>
                <Icon name="alert-circle" size="sm" color={colors.danger} />
                <Text style={styles.error}>{error}</Text>
              </View>
            )}

            <Button
              label={busy ? 'Signing in…' : 'Sign in'}
              icon="log-in-outline"
              onPress={signIn}
              disabled={!canSubmit || busy}
              loading={busy}
              size="lg"
              block
            />
          </Card>

          {/* The one thing a rider needs to believe before they will use this in a dead zone. */}
          <View style={styles.promise}>
            <View style={styles.promiseIcon}>
              <Icon name="cloud-offline-outline" size="sm" color={colors.brand} />
            </View>
            <View style={styles.promiseText}>
              <Text style={styles.promiseTitle}>Your work is safe offline</Text>
              <Muted style={styles.promiseBody}>
                Scans queue on this device and sync themselves when signal returns. A scan performed
                twice on a flaky connection is still one scan.
              </Muted>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  masthead: {
    paddingTop: space.xxl,
    paddingBottom: space.xl,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    gap: space.xs,
  },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  appName: { ...typography.display, color: colors.onBrand },
  tagline: { ...typography.body, color: 'rgba(255,255,255,0.82)' },

  formWrap: { flex: 1 },
  formContent: { padding: space.lg, paddingTop: space.xl, gap: space.lg },
  card: {
    padding: space.xl,
    gap: space.md,
    ...elevation.raised,
  },
  cardSub: { fontSize: 13, lineHeight: 19 },
  fields: { marginTop: space.sm, gap: 0 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
  },
  error: { ...typography.caption, color: colors.danger, flex: 1, fontWeight: '600' },

  promise: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    paddingHorizontal: space.sm,
  },
  promiseIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promiseText: { flex: 1, gap: space.xxs },
  promiseTitle: { ...typography.label },
  promiseBody: { ...typography.caption, lineHeight: 18 },
});
