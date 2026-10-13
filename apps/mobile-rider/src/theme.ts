/**
 * The rider app's design tokens.
 *
 * The previous palette was slate and nothing else: `primary` was `#0f172a`, which is grey. A rider
 * on a loading dock in daylight, one-handed, with the sun on the screen, gets a grey form with no
 * colour in it — nothing tells them what is urgent, what is done, or where to press. That is the
 * single biggest reason the app read as a toy, and it is fixed here rather than in the screens.
 *
 * Four layers, in the order a screen needs them:
 *
 *  - **brand** — the one colour that means "ZipZap", used for the primary action and nothing else.
 *  - **semantic** — what a status means, so a rider reads a job's state from colour alone.
 *  - **surface** — what is raised, and how far. Elevation is a token, not a per-screen decision.
 *  - **type/space/radius** — the scales.
 *
 * Every screen names a token. No screen has a hex value in it, and the checker that enforces the
 * equivalent rule for rules/ files is the reason this comment exists.
 *
 * ## What is not here
 *
 * A `STATUS_TONE` map used to be, at the bottom of this file, and nothing imported it. It was also a
 * *fourth* answer to the same question — the jobs list, the detail screen and the home preview each had
 * their own, and `OUT_FOR_DELIVERY` came out brand, neutral and brand respectively.
 *
 * The status vocabulary is now `src/status.ts`, which maps the product's shared classes of state onto
 * this palette. This file is colour and nothing else.
 */

export const colors = {
  /* ---------------------------------------------------------------- brand */
  /**
   * The primary action colour. Indigo, matching the bolt in the brand mark.
   *
   * Not slate, which is what the merchant console uses: that console is read at a desk in
   * controlled light, and a phone is read in a doorway at 2pm in Dhaka. A brand colour that
   * survives glare is worth more than consistency between two surfaces used in different light.
   */
  brand: '#4f46e5',
  brandPressed: '#4338ca',
  /** The tint a brand surface casts, for icon chips and tinted headers. */
  brandSoft: '#eef2ff',
  brandBorder: '#c7d2fe',
  brandFg: '#ffffff',

  /* --------------------------------------------------------------- surface */
  bg: '#f6f7fb',
  /** A raised surface: cards, the tab bar, a stack header. */
  card: '#ffffff',
  /** A sunken surface: form fields, insets. The hierarchy card→field is what makes a form readable. */
  sunken: '#f8fafc',
  border: '#e6e8ef',
  borderStrong: '#d3d7e0',

  /* ------------------------------------------------------------- ink scale */
  text: '#0f172a',
  textMuted: '#5b6474',
  textFaint: '#98a1b3',
  /** On a brand-coloured surface. */
  onBrand: '#ffffff',

  /* -------------------------------------------------------------- semantic */
  success: '#15803d',
  successBg: '#dcfce7',
  successBorder: '#bbf7d0',
  info: '#0369a1',
  infoBg: '#e0f2fe',
  infoBorder: '#bae6fd',
  warning: '#b45309',
  warningBg: '#fef3c7',
  warningBorder: '#fde68a',
  danger: '#b91c1c',
  dangerBg: '#fee2e2',
  dangerBorder: '#fecaca',
  /** The default: no state, or a state that does not need a colour. */
  neutralBg: '#f1f5f9',
  neutralBorder: '#e2e8f0',
} as const;

/** Space scale, in dp. A scale, not ad-hoc numbers, so screens line up. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  /** A pill: full-round, for chips and badges. */
  pill: 999,
} as const;

/**
 * Elevation, as a shadow spec per level.
 *
 * A hairline border was the only depth cue before, which is why every card looked like a table
 * row. Three levels is enough: a card on a page, a card that is pressed, and something floating
 * (a sticky CTA, a toast). Named because "how raised is this" is a decision made once.
 */
export const elevation = {
  none: {},
  card: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  float: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
} as const;

/**
 * Type scale, in dp, with the weight that goes with each role.
 *
 * `tabular` variants carry `fontVariant: ['tabular-nums']` so a column of amounts does not jitter
 * as digits change — a rider comparing 125050 against 120400 must not watch the numbers move.
 */
export const typography = {
  /** Screen title, in a stack header or at the top of a screen. */
  display: { fontSize: 26, lineHeight: 32, fontWeight: '800' as const },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  /** Emphasised body copy inside a card. */
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  /** Uppercase micro-label above a section. */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  },
} as const;
