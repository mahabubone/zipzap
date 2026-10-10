/**
 * The rider app's navigation graph.
 *
 * This used to be a `useState` tab flag plus two more `useState` fields for which job was open, and
 * the consequences were not cosmetic: no back gesture, no hardware back on Android, no deep links, no
 * route-level state restoration, and a screen stack a developer had to reason about by hand. A shim
 * `useFocusEffect` existed to paper over the fact that React Navigation was not there.
 *
 * Two navigators, because there are two kinds of screen:
 *
 * - **Bottom tabs** for the persistent surface: Jobs, Sync, Profile.
 * - **A native stack on top** for the drill-downs: a job, then a proof. These push and pop, so the
 *   hardware back button pops them rather than leaving the app.
 *
 * Params are ids only. `JobRow` is *not* passed as a param: a navigation param is a serialisation
 * boundary, and the jobs query is the single source of truth. Passing the object would copy that
 * truth into navigation state, where it goes stale silently — the exact bug the comment on
 * `JobsScreen` ("no manual cache mutation anywhere, the server is the only source of truth") is
 * defending against. A job screen re-reads the query and finds its row: one lookup, no second source
 * of truth, and deep links work for free because a link carries the id.
 */

import type { LinkingOptions } from '@react-navigation/native';
import {
  NavigationContainer,
  DefaultTheme,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { RiderClient } from './rider-client.ts';
import { colors, typography, space } from './theme.ts';
import type { AutoSync } from './hooks/useAutoSync.ts';
import { RiderTabBar } from './components/RiderTabBar.tsx';
import { JobsScreen, toJobRows, type JobRow, type RiderJobs } from './screens/JobsScreen.tsx';
import { JobDetailScreen } from './screens/JobDetailScreen.tsx';
import { ProofScreen } from './screens/ProofScreen.tsx';
import { SyncScreen } from './screens/SyncScreen.tsx';
import { ProfileScreen } from './screens/ProfileScreen.tsx';

/** The three tabs. */
export type TabParams = {
  Jobs: undefined;
  Sync: undefined;
  Profile: undefined;
};

/** What a drill-down is opened with: ids, never objects. */
export type JobsStackParams = {
  Jobs: undefined;
  Job: { jobId: string; kind: 'pickup' | 'delivery' };
  Proof: { jobId: string };
};

const Tabs = createBottomTabNavigator<TabParams>();
const JobsStack = createNativeStackNavigator<JobsStackParams>();

/**
 * The key the jobs query is cached under.
 *
 * Exported because the job screens re-read the same query to resolve a route param — that shared key
 * is what makes the query the single source of truth rather than two overlapping ones.
 */
export const JOBS_QUERY_KEY = 'rider-jobs';

/**
 * Deep links, so a notification tap can open the exact job rather than the app.
 *
 * `zipzap-rider://job/<id>` and the matching https form, which is what a push notification carries
 * once those exist. An app with no URL scheme makes every notification a launch-and-hunt.
 */
const linking: LinkingOptions<Record<string, never>> = {
  prefixes: ['zipzap-rider://', 'https://r.zipzap.example'],
  config: {
    screens: {
      Jobs: { screens: { Jobs: '', Job: 'job/:jobId', Proof: 'job/:jobId/proof' } },
      Sync: 'sync',
      Profile: 'profile',
    },
  },
};

/** React Navigation's palette, replaced with the app's tokens rather than the reverse. */
const riderTheme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.card,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
};

/** What every screen under the graph needs, built once in the composition root. */
export interface ScreenProps {
  readonly riderClient: RiderClient;
  /** Keeps the Sync tab's badge honest after any action, from the queue itself. */
  readonly onPendingChange: (pending: number) => void;
  readonly pending: number;
  /** Clears the session client-side. The server-side revoke happens in `logout()`. */
  readonly onSignOut: () => void | Promise<void>;
  readonly autoSync: AutoSync;
}

export function RiderNavigator(props: ScreenProps) {
  const { riderClient, onPendingChange, pending, onSignOut, autoSync } = props;

  return (
    <NavigationContainer linking={linking} theme={riderTheme}>
      <Tabs.Navigator
        tabBar={(tabProps) => <RiderTabBar {...tabProps} pending={pending} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="Jobs">{() => <JobsStackNavigator props={props} />}</Tabs.Screen>
        <Tabs.Screen name="Sync">
          {() => (
            <SyncScreen riderClient={riderClient} onSynced={onPendingChange} autoSync={autoSync} />
          )}
        </Tabs.Screen>
        <Tabs.Screen name="Profile">
          {() => (
            <ProfileScreen riderClient={riderClient} onSignOut={onSignOut} autoSync={autoSync} />
          )}
        </Tabs.Screen>
      </Tabs.Navigator>
    </NavigationContainer>
  );
}

function JobsStackNavigator({ props }: { props: ScreenProps }) {
  const openJob = useOpenJob();
  const captureProof = useCaptureProof();

  return (
    <JobsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { ...typography.title, fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <JobsStack.Screen name="Jobs" options={{ headerShown: false }}>
        {() => <JobsScreen riderClient={props.riderClient} onOpenJob={openJob} />}
      </JobsStack.Screen>
      <JobsStack.Screen name="Job" options={{ title: 'Job' }}>
        {() => (
          <JobDetailScreen
            riderClient={props.riderClient}
            job={useJobFromRoute()}
            onQueued={props.onPendingChange}
            onCaptureProof={captureProof}
          />
        )}
      </JobsStack.Screen>
      <JobsStack.Screen name="Proof" options={{ title: 'Proof of delivery' }}>
        {() => (
          <ProofScreen
            riderClient={props.riderClient}
            job={useJobFromRoute()}
            onQueued={props.onPendingChange}
          />
        )}
      </JobsStack.Screen>
    </JobsStack.Navigator>
  );
}

/**
 * Resolves the route's `{ jobId }` into the row the screens already take.
 *
 * Returns null when the row is gone, which is meaningful rather than an error to swallow: the job was
 * cancelled server-side while the rider was offline, or a deep link named a job that is not theirs.
 * Both must show "this job is no longer available", not an empty form.
 */
function useJobFromRoute(): JobRow | null {
  const route = useRoute<RouteProp<JobsStackParams, 'Job'> | RouteProp<JobsStackParams, 'Proof'>>();
  const { data } = useQuery<RiderJobs>({ queryKey: [JOBS_QUERY_KEY] });
  if (!data) return null;
  const jobId = 'jobId' in route.params ? route.params.jobId : null;
  return toJobRows(data).find((row) => row.id === jobId) ?? null;
}

/** Pushes the job screen. A screen never navigates by setting parent state. */
function useOpenJob(): (job: JobRow) => void {
  const navigation = useNavigation<NativeStackNavigationProp<JobsStackParams>>();
  return (job) => navigation.navigate('Job', { jobId: job.id, kind: job.kind });
}

/** Pushes the proof screen for the job currently open. */
function useCaptureProof(): () => void {
  const navigation = useNavigation<NativeStackNavigationProp<JobsStackParams>>();
  const route = useRoute<RouteProp<JobsStackParams, 'Job'>>();
  return () => navigation.navigate('Proof', { jobId: route.params.jobId });
}

/**
 * Shown when a job route resolves to nothing.
 *
 * Deliberately not an error state: "this job is gone" is a normal outcome of offline work, and a
 * rider must be able to move on from it rather than retry.
 */
export function JobMissing() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
      <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center' }}>
        This job is no longer available. It may have been cancelled while you were offline.
      </Text>
    </View>
  );
}
