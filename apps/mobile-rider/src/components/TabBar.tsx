import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, space } from '../theme.ts';

/**
 * A tab bar with a badge for the offline queue. The badge is the
 * rider's connectivity signal: non-zero means work is queued on the
 * device waiting for a signal, and tapping Sync flushes it.
 */
export type Tab = 'jobs' | 'sync' | 'profile';

export function TabBar({
  tab,
  onTab,
  pending,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  pending: number;
}) {
  return (
    <View style={styles.bar}>
      <TabButton
        label="Jobs"
        active={tab === 'jobs'}
        onPress={() => onTab('jobs')}
        badge={pending}
      />
      <TabButton
        label="Sync"
        active={tab === 'sync'}
        onPress={() => onTab('sync')}
        badge={pending}
      />
      <TabButton label="Profile" active={tab === 'profile'} onPress={() => onTab('profile')} />
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
  badge,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      {badge !== undefined && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingBottom: space.sm,
    paddingTop: space.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.xs,
  },
  tabActive: {},
  tabLabel: { fontSize: 13, color: colors.textFaint, fontWeight: '600' },
  tabLabelActive: { color: colors.text },
  badge: {
    backgroundColor: colors.warning,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeLabel: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
});
