/**
 * ZipZap Rider app palette. Slate-first, matching the merchant console so the
 * two surfaces read as one product. Nothing here is a dependency — a plain
 * object keeps the shell free of a theme package.
 *
 * The names are what the app asks for: `card` for a raised surface, `textMuted` for secondary
 * copy. A screen should never name a hex value, and there should be exactly one grey for "the
 * thing under the heading" rather than one per screen.
 */
export const colors = {
  bg: '#f8fafc',
  /** A raised surface: cards, the tab bar, a stack header. */
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#64748b',
  textFaint: '#94a3b8',
  primary: '#0f172a',
  primaryText: '#ffffff',
  success: '#15803d',
  successBg: '#dcfce7',
  warning: '#b45309',
  warningBg: '#fef3c7',
  danger: '#b91c1c',
  dangerBg: '#fee2e2',
  neutralBg: '#f1f5f9',
} as const;

/** Space scale, in dp. A scale, not ad-hoc numbers, so screens line up. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

/**
 * Type scale, in dp, with the weight that goes with each role.
 *
 * Added because the screens each hand-rolled `fontSize: 17, fontWeight: '600'` for a heading and
 * drifted by a point across the app. A scale makes "this is a screen title" a decision made once.
 */
export const typography = {
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
} as const;
