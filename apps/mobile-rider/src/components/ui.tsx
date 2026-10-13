import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, elevation, radius, space, typography } from '../theme.ts';

/**
 * The rider app's primitives.
 *
 * The previous set was six flat components on a grey scale: a hairline card, a text button, a plain
 * field, a coloured-chip badge. Nothing pressed, nothing raised, nothing carried an icon, and there
 * was no accent colour anywhere in the app — so a phone held in one hand on a dock gave the rider no
 * signal about what was urgent or where to press next.
 *
 * What changed, and why each is not decoration:
 *  - **Elevation** replaces the hairline. A border says "box"; a shadow says "surface".
 *  - **Press states** on every pressable. An affordance that does not move when touched is not
 *    perceived as an affordance, especially with gloves on.
 *  - **Icons** beside labels. `Badge`/`Button`/`ListRow` all take one, because "Queue pickup scan"
 *    read slowly and the same words repeated four times on a screen.
 *  - **A `formatted` prop** on numbers. Tabular figures stop a column of amounts jittering as
 *    digits change, which matters when a rider is comparing what they collected against the quote.
 */

const ICON_SIZE = { sm: 14, md: 18, lg: 22, xl: 28 } as const;

export function Icon({
  name,
  size = 'md',
  color = colors.text,
}: {
  name: keyof typeof Ionicons.glyphMap;
  size?: keyof typeof ICON_SIZE;
  color?: string;
}) {
  return (
    <Ionicons
      name={name}
      size={ICON_SIZE[size]}
      color={color}
      // Icons are decorative next to a label; without this a screen reader reads every icon name
      // before the word it sits beside.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/* ------------------------------------------------------------------ surfaces */

export function Card({
  children,
  style,
  elevated = true,
}: {
  children: ReactNode;
  style?: object;
  /** `false` for a nested card, where a second shadow would double up. */
  elevated?: boolean;
}) {
  return <View style={[styles.card, elevated && elevation.card, style]}>{children}</View>;
}

/** A card the whole of which is tappable, with a press response. */
export function PressableCard({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, elevation.card, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------- actions */

export function Button({
  label,
  onPress,
  disabled,
  tone = 'primary',
  icon,
  loading,
  size = 'md',
  block,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'danger' | 'ghost' | 'subtle';
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Full width, for the one action on a screen. */
  block?: boolean;
}) {
  const isDisabled = disabled === true || loading === true;
  const height = size === 'sm' ? 36 : size === 'lg' ? 54 : 46;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading === true }}
      style={({ pressed }) => [
        styles.button,
        { height },
        tone === 'danger' && styles.buttonDanger,
        tone === 'ghost' && styles.buttonGhost,
        tone === 'subtle' && styles.buttonSubtle,
        block && styles.buttonBlock,
        pressed && styles.pressed,
        isDisabled && styles.buttonDisabled,
      ]}
    >
      {loading === true ? (
        <View style={styles.buttonSpinner} />
      ) : (
        <>
          {icon !== undefined && (
            <Icon
              name={icon}
              size={size === 'sm' ? 'sm' : 'md'}
              color={tone === 'ghost' || tone === 'subtle' ? colors.text : colors.onBrand}
            />
          )}
          <Text
            style={[
              styles.buttonLabel,
              size === 'sm' && typography.label,
              (tone === 'ghost' || tone === 'subtle') && styles.buttonLabelQuiet,
              isDisabled && styles.buttonLabelDisabled,
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** A compact square button for one icon, used for back/close in a header. */
export function IconButton({
  name,
  onPress,
  label,
  tone = 'quiet',
}: {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** What it does, for a screen reader. Never shown. */
  label: string;
  tone?: 'quiet' | 'brand';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconButton,
        tone === 'brand' && styles.iconButtonBrand,
        pressed && styles.pressed,
      ]}
    >
      <Icon name={name} size="lg" color={tone === 'brand' ? colors.onBrand : colors.text} />
    </Pressable>
  );
}

/* --------------------------------------------------------------------- text */

export function Title({
  children,
  level = 'title',
}: {
  children: string;
  level?: 'title' | 'heading';
}) {
  return <Text style={level === 'title' ? typography.title : typography.heading}>{children}</Text>;
}

export function Muted({ children, style }: { children: string; style?: object }) {
  return <Text style={[typography.body, styles.muted, style]}>{children}</Text>;
}

export function Caption({ children }: { children: string }) {
  return <Text style={typography.caption}>{children}</Text>;
}

/** An uppercase micro-label above a section, so a screen groups itself. */
export function Overline({ children }: { children: string }) {
  return <Text style={styles.overline}>{children}</Text>;
}

/** A number that must not jitter: tabular figures, so columns line up. */
export function Amount({
  children,
  tone = 'default',
  size = 'md',
}: {
  children: string;
  tone?: 'default' | 'success' | 'danger' | 'brand';
  size?: 'md' | 'lg';
}) {
  const color =
    tone === 'success'
      ? colors.success
      : tone === 'danger'
        ? colors.danger
        : tone === 'brand'
          ? colors.brand
          : colors.text;
  return (
    <Text
      style={[size === 'lg' ? typography.title : typography.bodyStrong, styles.amount, { color }]}
    >
      {children}
    </Text>
  );
}

/* -------------------------------------------------------------------- fields */

export function Field({
  label,
  value,
  onChange,
  placeholder,
  secureTextEntry,
  keyboardType,
  icon,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  icon?: keyof typeof Ionicons.glyphMap;
  error?: string;
  hint?: string;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {/* The icon is a hint about what goes in the box; the border colour is the state. An
          accessibilityLabel is still required, or a screen reader announces by value. */}
      <View style={[styles.fieldShell, error !== undefined && styles.fieldShellError]}>
        {icon !== undefined && (
          <Icon name={icon} color={error !== undefined ? colors.danger : colors.textFaint} />
        )}
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
          style={styles.fieldInput}
        />
      </View>
      {error !== undefined ? (
        <View style={styles.fieldMessage}>
          <Icon name="alert-circle" size="sm" color={colors.danger} />
          <Text style={styles.fieldError}>{error}</Text>
        </View>
      ) : hint !== undefined ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------- status */

/**
 * Closed status vocabulary shared by pickup, delivery, offline queue and COD states.
 *
 * The colour comes from the tone, and the tone comes from the status — a screen maps a status to a
 * tone once, at the row, and never picks a hex value. A new status is one row in STATUS_TONE.
 */
export function Badge({
  label,
  tone = 'neutral',
  dot,
}: {
  label: string;
  tone?: 'neutral' | 'brand' | 'success' | 'info' | 'warning' | 'danger';
  /** A leading dot, which is what makes a status readable at a glance. */
  dot?: boolean;
}) {
  const palette = {
    brand: { bg: colors.brandSoft, fg: colors.brand, border: colors.brandBorder },
    success: { bg: colors.successBg, fg: colors.success, border: colors.successBorder },
    info: { bg: colors.infoBg, fg: colors.info, border: colors.infoBorder },
    warning: { bg: colors.warningBg, fg: colors.warning, border: colors.warningBorder },
    danger: { bg: colors.dangerBg, fg: colors.danger, border: colors.dangerBorder },
    neutral: { bg: colors.neutralBg, fg: colors.textMuted, border: colors.neutralBorder },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      {dot === true && <View style={[styles.badgeDot, { backgroundColor: palette.fg }]} />}
      <Text style={[styles.badgeLabel, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------------- rows */

/** A settings-style row: icon, label, optional value, chevron. */
export function ListRow({
  icon,
  label,
  value,
  onPress,
  tone = 'default',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  tone?: 'default' | 'danger';
}) {
  const fg = tone === 'danger' ? colors.danger : colors.text;
  const body = (
    <>
      <View style={[styles.rowIcon, tone === 'danger' && styles.rowIconDanger]}>
        <Icon name={icon} color={tone === 'danger' ? colors.danger : colors.brand} />
      </View>
      <Text style={[styles.rowLabel, { color: fg }]}>{label}</Text>
      {value !== undefined && <Text style={styles.rowValue}>{value}</Text>}
      {onPress !== undefined && <Icon name="chevron-forward" size="sm" color={colors.textFaint} />}
    </>
  );

  if (onPress === undefined) {
    return <View style={styles.row}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

/* ------------------------------------------------------------------- feedback */

/**
 * An empty state, as a composition rather than a line of grey text.
 *
 * "No jobs yet" on its own reads as a failure. An icon, a heading, one line of what to do, and a
 * tinted chip is what tells a rider the app is working and there is simply nothing to do.
 */
export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail?: string;
  action?: { label: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap };
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size="xl" color={colors.brand} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail !== undefined && <Muted style={styles.emptyDetail}>{detail}</Muted>}
      {action !== undefined && (
        <Button
          label={action.label}
          icon={action.icon}
          onPress={action.onPress}
          tone="subtle"
          size="sm"
        />
      )}
    </View>
  );
}

/** An inline error, distinct from an empty state: something went wrong, not "nothing here". */
export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, styles.emptyIconDanger]}>
        <Icon name="cloud-offline" size="xl" color={colors.danger} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail !== undefined && <Muted style={styles.emptyDetail}>{detail}</Muted>}
      {onRetry !== undefined && <Button label="Try again" icon="refresh" onPress={onRetry} />}
    </View>
  );
}

/** A skeleton block, for the first paint before data arrives. */
export function Skeleton({
  width = '100%',
  height = 16,
  radius: r = radius.xs,
}: {
  /** A percentage of the container, or an absolute width in dp. */
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
}) {
  return <View style={[styles.skeleton, { width, height, borderRadius: r }]} />;
}

/** A determinate progress bar. `0..1`. */
export function ProgressBar({
  value,
  tone = 'brand',
  height = 6,
}: {
  value: number;
  tone?: 'brand' | 'success' | 'warning' | 'danger';
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const fill = {
    brand: colors.brand,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
  }[tone];
  return (
    <View
      style={[styles.progressTrack, { height, borderRadius: height }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View style={[styles.progressFill, { width: `${clamped * 100}%`, backgroundColor: fill }]} />
    </View>
  );
}

/** A circular initials avatar, so a signed-in rider sees who they are without a photo. */
export function Avatar({ initials, size = 44 }: { initials: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarLabel, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

/* --------------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
  },
  pressed: {
    // Scale as well as opacity: a press that only dims reads as a repaint, not a touch.
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  rowPressed: { backgroundColor: colors.sunken },

  button: {
    backgroundColor: colors.brand,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonDanger: { backgroundColor: colors.danger },
  buttonSubtle: { backgroundColor: colors.brandSoft },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  buttonBlock: { alignSelf: 'stretch' },
  buttonDisabled: { opacity: 0.45 },
  buttonLabel: { color: colors.onBrand, fontSize: 15, fontWeight: '600' },
  buttonLabelQuiet: { color: colors.brand },
  buttonLabelDisabled: { color: colors.textFaint },
  buttonSpinner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    borderTopColor: colors.onBrand,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  iconButtonBrand: { backgroundColor: colors.brand, borderColor: colors.brand },

  muted: { color: colors.textMuted },
  overline: {
    ...typography.overline,
    color: colors.textFaint,
    marginBottom: space.sm,
  },
  amount: { fontVariant: ['tabular-nums'] },

  fieldWrap: { marginBottom: space.md },
  fieldLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: space.xs,
  },
  fieldShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    height: 48,
  },
  fieldShellError: { borderColor: colors.danger },
  fieldInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    // RNW needs the background neutralised on the input itself; the shell draws the border.
    backgroundColor: 'transparent',
  },
  fieldMessage: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  fieldError: { ...typography.caption, color: colors.danger, flex: 1 },
  fieldHint: { ...typography.caption, color: colors.textFaint, marginTop: space.xs },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    alignSelf: 'flex-start',
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeLabel: { fontSize: 12, fontWeight: '700' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: colors.dangerBg },
  rowLabel: { flex: 1, fontSize: 15 },
  rowValue: { fontSize: 14, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  empty: {
    alignItems: 'center',
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  emptyIconDanger: { backgroundColor: colors.dangerBg },
  emptyTitle: { ...typography.heading, textAlign: 'center' },
  emptyDetail: { textAlign: 'center', maxWidth: 280 },

  skeleton: { backgroundColor: colors.neutralBg },

  progressTrack: { backgroundColor: colors.neutralBg, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radius.pill },

  avatar: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarLabel: { color: colors.onBrand, fontWeight: '700' },
});
