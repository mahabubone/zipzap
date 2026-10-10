import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ZipZapClient } from '@zipzap/api-client';
import { Button, Card, Field, Muted, Title } from '../components/ui.tsx';
import { colors, space } from '../theme.ts';
import type { RiderSession } from '../rider-client.ts';

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Rider sign-in. Email + password against /v1/auth/login, bearer token
 * into a RiderSession. The login response is merchant-scoped — the rider
 * picks which rider id they are on the device they hold, because the auth
 * token identifies the principal and `riderId` scopes the job feed and the
 * sync queue. No auto-login: an explicit sign-in keeps a shared device from
 * silently acting as the previous rider.
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
      const probe = new ZipZapClient({ baseUrl });
      const session = await probe.login(email.trim(), password);
      onSignIn({ riderId: riderId.trim(), token: session.token });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.appName}>ZipZap Rider</Text>
      <Text style={styles.tagline}>Offline-capable delivery</Text>
      <Card>
        <Title>Sign in</Title>
        <View style={styles.gap} />
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          placeholder="rider@example.com"
          keyboardType="email-address"
        />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          secureTextEntry
        />
        <Field
          label="Rider ID"
          value={riderId}
          onChange={setRiderId}
          placeholder="The rider you are working as"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label={busy ? 'Signing in…' : 'Sign in'}
          onPress={signIn}
          disabled={!canSubmit || busy}
        />
      </Card>
      <View style={styles.gap} />
      <Muted>
        Work queues offline on this device and syncs when signal returns. A scan performed twice on
        a flaky connection is still one scan.
      </Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space.xl, justifyContent: 'center', backgroundColor: colors.bg },
  appName: { fontSize: 32, fontWeight: '700', color: colors.text },
  tagline: { fontSize: 16, color: colors.textMuted, marginTop: 4, marginBottom: space.xl },
  gap: { height: space.md },
  error: { fontSize: 13, color: colors.danger, marginBottom: space.md },
});
