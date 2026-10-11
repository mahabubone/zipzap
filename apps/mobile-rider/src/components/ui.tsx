import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, radius, space } from '../theme.ts';

/**
 * The handful of primitives the screens share. Deliberately tiny — a
 * full component library is a dependency, and the rider app needs five
 * things: a card, a title, a button, a field, and a status badge.
 */

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: string }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  disabled,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'danger' | 'ghost';
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        tone === 'danger' && styles.buttonDanger,
        tone === 'ghost' && styles.buttonGhost,
        disabled && styles.buttonDisabled,
      ]}
      accessibilityRole="button"
    >
      <Text
        style={[
          styles.buttonLabel,
          tone === 'ghost' && styles.buttonLabelGhost,
          disabled && styles.buttonLabelDisabled,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  secureTextEntry,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {/* `accessibilityLabel` is not decoration. Without it a screen reader announces the field by
          its value — so a rider who is blind hears "rider at example dot com" rather than "Email,
          text field", and cannot tell one blank field from another. */}
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
  );
}

/** Closed status vocabulary shared by pickup, delivery and COD states. */
export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'info' | 'warning' | 'danger';
}) {
  // A badge's two colours as one table rather than two ternary chains, so a new tone is one row.
  // The old form had `bg` and `fg` decided separately, which is how a tone ends up with a
  // background and no matching text.
  const palette =
    tone === 'success'
      ? { bg: colors.successBg, fg: colors.success }
      : tone === 'info'
        ? { bg: colors.neutralBg, fg: colors.text }
        : tone === 'warning'
          ? { bg: colors.warningBg, fg: colors.warning }
          : tone === 'danger'
            ? { bg: colors.dangerBg, fg: colors.danger }
            : { bg: colors.neutralBg, fg: colors.textMuted };
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeLabel, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  muted: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDanger: { backgroundColor: colors.danger },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: colors.primaryText, fontSize: 15, fontWeight: '600' },
  buttonLabelGhost: { color: colors.text },
  buttonLabelDisabled: { color: colors.textFaint },
  fieldWrap: { marginBottom: space.md },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: space.xs,
  },
  fieldInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.card,
  },
  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badgeLabel: { fontSize: 12, fontWeight: '600' },
});
