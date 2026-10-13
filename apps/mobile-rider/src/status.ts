import { STATUS_STATES, statusLabel, statusState, type StatusState } from '@zipzap/lexicon';

/**
 * The rider app's palette for the product's vocabulary.
 *
 * ## The defect this replaces
 *
 * `OUT_FOR_DELIVERY` rendered **brand** on the home preview, **neutral** on the jobs list and **brand**
 * on the detail screen — three decisions about one enum, in one app, made by three pieces of code that
 * had never heard of each other. `theme.ts` also carried a fourth map, `STATUS_TONE`, that nothing
 * imported. A rider scrolling between two screens watched a delivery change colour without anything
 * about it having happened.
 *
 * ## Why this is an adapter and not a shared map
 *
 * `@zipzap/lexicon` decides what a state *means*; this decides what that means here. The rider's phone
 * needs `brand` and the web kit does not have it — because on a phone in one hand, "this is with you
 * now" is the most important thing a status can say, and on a merchant's table it is two rows.
 *
 * So the shared decision is six classes, and each kit paints them its own way. `TONE_BY_STATE` in
 * `packages/web-kit` is the other half of this, and both are asserted to cover every class, so adding a
 * seventh is a build failure in both rather than a grey badge somewhere.
 */

export type Tone = 'neutral' | 'brand' | 'success' | 'info' | 'warning' | 'danger';

/** Exported for the coverage test: a seventh class with no tone here must fail loudly. */
export const TONE_BY_STATE: Readonly<Record<StatusState, Tone>> = {
  final: 'success',
  failed: 'danger',
  attention: 'warning',
  // The one that earns the abstraction. A rider holding the phone *is* the next step for these, and
  // that is why the jobs list and the detail screen agreed once this existed.
  actionable: 'brand',
  moving: 'info',
  neutral: 'neutral',
};

/** One function, for every screen. */
export function jobTone(status: string): Tone {
  return TONE_BY_STATE[statusState(status)];
}

export { STATUS_STATES, statusLabel, statusState, type StatusState };
