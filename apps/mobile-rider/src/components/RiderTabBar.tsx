import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, elevation, radius, space, typography } from '../theme.ts';
import { Icon } from './ui.tsx';

/**
 * The tab bar, with an icon per tab and a badge for the offline queue.
 *
 * The previous bar was three words and no icon. `Jobs`, `Sync`, `Profile` in bold grey, with the
 * active one picking up a font weight — a difference a rider on a dock cannot see. Now each tab has
 * an icon that switches between outline and filled, which is legible across a room.
 *
 * The badge is the rider's connectivity signal, so it is the one thing allowed to be coloured:
 * non-zero means work is sitting on the device waiting for signal.
 */

const TABS = [
  { name: 'Jobs', label: 'Jobs', icon: 'bicycle' },
  { name: 'Sync', label: 'Sync', icon: 'sync-circle' },
  { name: 'Profile', label: 'Profile', icon: 'person-circle' },
] as const;

/** The outlined/filled pair, so the active tab differs by shape and not only colour. */
const FILLED: Partial<Record<(typeof TABS)[number]['icon'], string>> = {
  bicycle: 'bicycle',
  'sync-circle': 'sync',
  'person-circle': 'person',
};

export function RiderTabBar({
  state,
  navigation,
  pending,
}: BottomTabBarProps & { pending: number }) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        // `findIndex` rather than the loop variable: React Navigation's `state.index` is the
        // focused route, and a reordering would otherwise light the wrong tab.
        const index = state.routes.findIndex((route) => route.name === tab.name);
        const isActive = state.index === index;
        return (
          <TabButton
            key={tab.name}
            label={tab.label}
            icon={isActive ? (FILLED[tab.icon] ?? tab.icon) : tab.icon}
            active={isActive}
            badge={tab.name === 'Sync' && pending > 0 ? pending : undefined}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: state.routes[index]!.key,
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
  icon,
  active,
  onPress,
  badge,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={badge === undefined ? label : `${label}, ${badge} waiting to sync`}
    >
      <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
        <Icon name={icon as 'bicycle'} size="lg" color={active ? colors.brand : colors.textFaint} />
        {badge !== undefined && (
          <View style={styles.badge}>
            {/* Announce the count, do not just draw it. */}
            <Text style={styles.badgeLabel} accessibilityLiveRegion="polite">
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.sm,
    paddingBottom: space.md,
    ...elevation.raised,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: space.xxs,
    paddingVertical: space.xs,
  },
  iconWrap: {
    paddingHorizontal: space.md,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
  },
  iconWrapActive: { backgroundColor: colors.brandSoft },
  label: { ...typography.label, color: colors.textFaint, fontSize: 11 },
  labelActive: { color: colors.brand },
  badge: {
    position: 'absolute',
    top: -2,
    right: space.sm,
    backgroundColor: colors.warning,
    borderRadius: radius.pill,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: colors.card,
  },
  badgeLabel: { color: '#ffffff', fontSize: 9, fontWeight: '800' },
});
