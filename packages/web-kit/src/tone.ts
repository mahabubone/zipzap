import { statusState, type StatusState } from '@zipzap/lexicon';

export type BadgeTone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

/** Exported so a test can assert the coverage is complete — see `tone.spec.ts`. */
export const TONE_BY_STATE: Readonly<Record<StatusState, BadgeTone>> = {
  final: 'success',
  failed: 'danger',
  attention: 'warning',
  // "With you now" and "in motion" are both blue here. They are not on a merchant's screen: the
  // distinction that matters to a rider is not the distinction that matters to someone reading a
  // table, and inventing a fifth colour for it would be decoration.
  actionable: 'info',
  moving: 'info',
  neutral: 'neutral',
};

/**
 * A status, as a colour on a web screen.
 *
 * A thin adapter, and that is all it is: `@zipzap/lexicon` decides *what a state means* and this
 * decides what that means in the web kit's palette. The rider app maps the same six classes to its own
 * six tones, including a `brand` this kit does not have — and both are correct, which is the reason the
 * shared decision is a class of state rather than a colour.
 *
 * The mapping is unchanged from the map it replaces, so no screen shifts colour by adopting it.
 */
export function statusTone(status: string): BadgeTone {
  return TONE_BY_STATE[statusState(status)];
}
