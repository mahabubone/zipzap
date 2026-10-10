import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type QueueStorage } from './src/offline/command-queue.ts';
import { RiderClient, type RiderSession } from './src/rider-client.ts';
import { TabBar, type Tab } from './src/components/TabBar.tsx';
import { AuthScreen } from './src/screens/AuthScreen.tsx';
import { JobsScreen, type JobRow } from './src/screens/JobsScreen.tsx';
import { JobDetailScreen } from './src/screens/JobDetailScreen.tsx';
import { ProofScreen } from './src/screens/ProofScreen.tsx';
import { SyncScreen } from './src/screens/SyncScreen.tsx';
import { ProfileScreen } from './src/screens/ProfileScreen.tsx';
import { colors } from './src/theme.ts';

/**
 * The device's key-value store. In a production build this is AsyncStorage:
 *
 *   import AsyncStorage from '@react-native-async-storage/async-storage';
 *
 * The OfflineQueue takes a `QueueStorage`-shaped port (see
 * src/offline/command-queue.ts), so the same queue runs here, in the
 * `verify-queue.mjs` proof, and in any future persistence layer. Swapping the
 * implementation is a one-line change at the composition root below.
 */
class MemoryStorage implements QueueStorage {
  private readonly store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

const storage = new MemoryStorage();

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 1000 * 60 * 5 },
        },
      }),
  );
  const [booted, setBooted] = useState(false);
  const [client, setClient] = useState<RiderClient | null>(null);
  const [tab, setTab] = useState<Tab>('jobs');
  const [openJob, setOpenJob] = useState<JobRow | null>(null);
  const [provingJob, setProvingJob] = useState<JobRow | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    // A real build reads the saved session from SecureStore. Until then there is
    // no session, so the app always boots to the auth screen.
    setBooted(true);
  }, []);

  if (!booted) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const signIn = (session: RiderSession) => {
    const next = new RiderClient(
      storage,
      session,
      process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
    );
    setClient(next);
    setTab('jobs');
    setOpenJob(null);
    setProvingJob(null);
    next.queue.pending().then((rows) => setPending(rows.length));
  };

  const signOut = () => {
    setClient(null);
    setTab('jobs');
    setOpenJob(null);
    setProvingJob(null);
    setPending(0);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <SafeAreaView style={styles.container}>
        {!client ? (
          <AuthScreen onSignIn={signIn} />
        ) : (
          <View style={styles.shell}>
            <View style={styles.body}>
              {tab === 'jobs' ? (
                provingJob ? (
                  <ProofScreen
                    riderClient={client}
                    job={provingJob}
                    onBack={() => setProvingJob(null)}
                    onQueued={setPending}
                  />
                ) : openJob ? (
                  <JobDetailScreen
                    riderClient={client}
                    job={openJob}
                    onBack={() => setOpenJob(null)}
                    onQueued={setPending}
                    onCaptureProof={() => setProvingJob(openJob)}
                  />
                ) : (
                  <JobsScreen riderClient={client} onOpenJob={setOpenJob} />
                )
              ) : tab === 'sync' ? (
                <SyncScreen riderClient={client} onSynced={setPending} />
              ) : (
                <ProfileScreen riderClient={client} onSignOut={signOut} />
              )}
            </View>
            <TabBar
              tab={tab}
              pending={pending}
              onTab={(next) => {
                setTab(next);
                if (next !== 'jobs') {
                  setOpenJob(null);
                  setProvingJob(null);
                }
              }}
            />
          </View>
        )}
      </SafeAreaView>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  boot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  shell: { flex: 1 },
  body: { flex: 1 },
});
