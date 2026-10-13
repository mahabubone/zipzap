import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import {
  clearSession,
  queueStorage,
  readSession,
  writeSession,
  type StoredSession,
} from './src/storage.ts';
import { RiderClient, type RiderSession } from './src/rider-client.ts';
import { RiderNavigator } from './src/navigation.tsx';
import { AuthScreen } from './src/screens/AuthScreen.tsx';
import { useAutoSync } from './src/hooks/useAutoSync.ts';
import { colors, space, typography } from './src/theme.ts';

/**
 * The rider app's composition root.
 *
 * This file is wiring and nothing else: read the session, build the client, hand the graph its
 * pieces. It decides nothing, and that is the point — every decision it depends on lives in
 * `src/offline/command-queue.ts` or `src/hooks/useAutoSync.ts`, both of which are testable without a
 * phone.
 *
 * The queue's storage is AsyncStorage through the `QueueStorage` port, so the queue stays
 * framework-free and keeps running inside `verify-queue.mjs`. The session token is SecureStore, not
 * this file: the root wires two stores, it holds neither.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * TanStack Query's two managers, wired to React Native's own lifecycle events.
 *
 * Done once at boot rather than per-provider: `onlineManager` and `focusManager` are module-level
 * singletons, so setting them twice would replace the listener rather than add one, and the second
 * registration would silently win.
 */
function wireQueryToConnectivity(): void {
  // Without this the client considers itself online forever, so `JobsScreen` retries into a dead
  // basement and the rider gets a "could not load" that never clears.
  //
  // `setEventListener` returns void and replaces the previous listener, so this is wired once at
  // boot rather than per-provider — a second registration would not stack, it would win.
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected === true && state.isInternetReachable !== false);
    }),
  );

  // A screen that is not focused must not refetch on a reconnect: the rider is looking at one
  // screen, and three waking at once is battery the shift cannot spare.
  const onChange = (state: string) => focusManager.setFocused(state === 'active');
  AppState.addEventListener('change', onChange);
}

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 1000 * 60 * 5,
            // A refetch on reconnect is the point: the queue already holds the write safely, and
            // the rider wants the server's answer as soon as it is available.
            refetchOnReconnect: true,
          },
        },
      }),
  );
  /**
   * `undefined` = still reading storage, `null` = no stored session, otherwise there is one.
   *
   * Three states rather than two, because "still loading" and "not signed in" render different
   * things and collapsing them sends a signed-in rider to the login form for the first frame.
   */
  const [stored, setStored] = useState<StoredSession | null | undefined>(undefined);
  const [client, setClient] = useState<RiderClient | null>(null);
  const [pending, setPending] = useState(0);
  /** A storage failure is a rendering problem, not an auth one: the rider did nothing wrong. */
  const [bootError, setBootError] = useState<string | null>(null);

  // Once, at boot: the query managers are module-level singletons.
  useEffect(() => {
    wireQueryToConnectivity();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const session = await readSession();
        setStored(session);
        if (session !== null) setClient(await buildClient(session, setPending));
      } catch (error) {
        setBootError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  const signIn = useCallback(async (riderSession: RiderSession) => {
    const meta: StoredSession['meta'] = {
      riderId: riderSession.riderId,
      credentialKind: riderSession.apiKey === undefined ? 'bearer' : 'apikey',
      expiresAt: riderSession.expiresAt ?? null,
    };
    const session: StoredSession = {
      meta,
      token: riderSession.token ?? null,
      expired: false,
    };
    await writeSession(meta, session.token);
    setStored(session);
    setClient(await buildClient(session, setPending));
  }, []);

  const signOut = useCallback(async () => {
    // Clears the token first: a sign-out that fails part-way must not leave the rider holding a
    // credential the app believes is gone.
    await clearSession();
    setStored(null);
    setClient(null);
    setPending(0);
  }, []);

  // Auto-sync needs a signed session to sync for; before then there is nothing to flush.
  const autoSync = useAutoSync(client, setPending);

  if (stored === undefined) {
    return <Boot />;
  }

  if (bootError !== null) {
    // "Continue" rather than "Retry": storage does not become readable by trying again, and a rider
    // must be able to continue signed out instead of being trapped on a spinner.
    return (
      <Broken
        message={bootError}
        onContinue={() => {
          setBootError(null);
          setStored(null);
        }}
      />
    );
  }

  if (client === null) {
    return <AuthScreen onSignIn={signIn} />;
  }

  return (
    /* SafeAreaProvider must sit above the navigator, not inside a screen: the insets it publishes
       are what the tab bar and the stack header read to avoid drawing under the notch and the
       gesture bar. The old hand-rolled SafeAreaView wrapped the whole tree instead, which got the
       top inset right and the bottom one wrong. */
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <RiderNavigator
          riderClient={client}
          pending={pending}
          onPendingChange={setPending}
          onSignOut={signOut}
          autoSync={autoSync}
          offline={autoSync.offline}
        />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

async function buildClient(
  stored: StoredSession,
  onRestored: (pending: number) => void,
): Promise<RiderClient> {
  const session: RiderSession = {
    riderId: stored.meta.riderId,
    ...(stored.token !== null ? { token: stored.token } : {}),
  };
  const client = new RiderClient(queueStorage, session, API_URL);
  // Restore the badge before anything renders from it, so a rider who opens the app after a shift
  // sees the count they left rather than a zero that is only right until the next query.
  void client.queue
    .pending()
    .then((rows) => onRestored(rows.length))
    .catch(() => undefined);
  return client;
}

function Boot() {
  return (
    <View style={styles.boot}>
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}

function Broken({ message, onContinue }: { message: string; onContinue: () => void }) {
  // A TouchableOpacity rather than the app's Button, which lives in src/components and pulls the
  // palette in behind it — a boot-failure screen has no business being styled like a screen.
  return (
    <View style={styles.boot}>
      <Text style={[typography.body, styles.brokenText]}>{message}</Text>
      <TouchableOpacity onPress={onContinue} accessibilityRole="button">
        <Text style={typography.label}>Continue</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  brokenText: { color: colors.danger, textAlign: 'center', marginBottom: space.md },
});
