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
 * Email + password against `/v1/auth/token`, bearer token into a `RiderSession`. The rider picks
 * which rider id they are on the device they hold, because the auth token identifies the principal
 * and `riderId` scopes the job feed and the sync queue. No auto-login: an explicit sign-in keeps a
 * shared device from silently acting as the previous rider.
 */
export function AuthScreen({ onSignIn }: { onSignIn: (s: RiderSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [riderId, setRiderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && riderId.trim().length > 0;

  const signIn = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      // `/auth/token`, NOT `/auth/login`. A native app cannot hold a cookie, and `/auth/login` now
      // deliberately omits the token from its body because a browser console's script could read it
      // there. The token flow exists for exactly this caller.
      const probe = new ZipZapClient({ baseUrl });
      const session = await probe.loginToken(email.trim(), password);
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
              The account you were issued at the depot. Your rider id scopes the work you see.
            </Muted>

            <View style={styles.fields}>
              <Field
                label="Email"
                icon="mail-outline"
                value={email}
                onChange={setEmail}
                placeholder="rider@example.com"
                keyboardType="email-address"
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
