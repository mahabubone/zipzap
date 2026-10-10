import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, space } from '../theme.ts';

/**
 * The tab bar, with a badge for the offline queue.
 *
 * The badge is the rider's connectivity signal: non-zero means work is sitting on the device waiting
 * for a signal, and tapping Sync flushes it.
 *
 * React Navigation's own bar is not used, because it can only badge an icon and this app has no
 * icons. Labels rather than glyphs is not a shortcut either: a rider scanning in a pocket reads
 * "Sync" faster than they read an icon, and "Sync" carries the count.
 */

const TABS = [
  { name: 'Jobs', label: 'Jobs', badged: false },
  { name: 'Sync', label: 'Sync', badged: true },
  { name: 'Profile', label: 'Profile', badged: false },
] as const;

export function RiderTabBar({
  state,
  navigation,
  pending,
}: BottomTabBarProps & { pending: number }) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        // `indexOf` rather than the loop variable: React Navigation's state.index is the focused
        // route, and a route reordering would otherwise make the wrong tab look active.
        const routeIndex = state.routes.findIndex((route) => route.name === tab.name);
        const isActive = state.index === routeIndex;
        return (
          <TabButton
            key={tab.name}
            label={tab.label}
            active={isActive}
            badge={tab.badged ? pending : undefined}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: state.routes[routeIndex]!.key,
                canPreventDefault: true,
              });
              if (!isActive && !event.defaultPrevented) {
                navigation.navigate(tab.name);
              }
            }}
          />
        );
      })}
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
          {/* Announced, not just drawn: a screen reader user gets the count by ear. */}
          <Text style={styles.badgeLabel} accessibilityLiveRegion="polite">
            {badge > 99 ? '99+' : badge}
          </Text>
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
