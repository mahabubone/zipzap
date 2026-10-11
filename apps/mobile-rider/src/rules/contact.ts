/**
 * The customer contact action, and the state it is in until the payload carries a number.
 *
 * The single highest-value thing on the job screen, and the cheapest to build — a rider at a wrong
 * door who cannot call is stuck. It is also the clearest example of the difference between a feature
 * and a button: a `tel:` link pointing at nothing dials a rental car, loses the rider's money, and is
 * worse than no button at all.
 *
 * So the app models three states rather than one:
 *
 * - `ready`   — a number is present, and the action dials it.
 * - `loading` — unknown yet, so the action says so rather than guessing.
 * - `absent`  — the job simply has no number, and the action says *why*, because a "Call customer"
 *               that does nothing teaches a rider never to tap it again.
 *
 * The rule is deliberately small: a number is present exactly when the job carries one. Nothing here
 * invents, defaults, or half-remembers a contact.
 */

/** What the screen knows about the customer. Pure, so the copy is testable without a phone. */
export type ContactState =
  | { readonly kind: 'ready'; readonly phone: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'absent'; readonly reason: 'no-number-on-job' | 'not-a-delivery' };

/**
 * Derive the contact state from a job.
 *
 * A pickup has no customer: the shop handed the parcel over, not the other way round, and dialling
 * a merchant's recipient at 7am to ask where it is would be wrong. So a pickup is `absent` with its
 * own reason and the screen never offers the action for one.
 */
export function contactStateFor(
  job: { readonly kind: 'pickup' | 'delivery' } | null,
  phone: string | null | undefined,
  loading: boolean,
): ContactState {
  if (job === null || job.kind === 'pickup') return { kind: 'absent', reason: 'not-a-delivery' };
  if (loading) return { kind: 'loading' };
  if (typeof phone === 'string' && phone.trim() !== '') {
    return { kind: 'ready', phone: phone.trim() };
  }
  return { kind: 'absent', reason: 'no-number-on-job' };
}

/** What the action should say, given the state. */
export function contactLabel(state: ContactState): string {
  switch (state.kind) {
    case 'ready':
      return 'Call customer';
    case 'loading':
      return 'Looking up the number…';
    case 'absent':
      return 'Call customer';
  }
}

/** Why the action is unavailable, when it is. Shown under the label so it is never a mystery. */
export function contactHint(state: ContactState): string | null {
  switch (state.kind) {
    case 'ready':
      return 'Opens your phone app with the number filled in.';
    case 'loading':
      return 'Checking this job for a contact number.';
    case 'absent':
      return state.reason === 'not-a-delivery'
        ? 'Pickups are delivered to a shop, so there is no customer to call.'
        : 'This job does not carry a phone number yet, so there is nobody to dial. Your dispatcher can still be reached from Sync.';
  }
}

/** A `tel:` href for a number, or null when there is nothing worth dialling. */
export function telHref(state: ContactState): string | null {
  if (state.kind !== 'ready') return null;
  // Strip everything that is not part of a dialable number, keeping the leading plus, so a number
  // saved as "+880 1711-223344" dials instead of failing.
  const digits = state.phone.replace(/[^\d+]/g, '');
  return digits === '' ? null : `tel:${digits}`;
}
