/**
 * ZipZap Rider app palette. Slate-first, matching the merchant console so the
 * two surfaces read as one product. Nothing here is a dependency — a plain
 * object keeps the shell free of a theme package.
 */
export const colors = {
  bg: '#f8fafc',
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
