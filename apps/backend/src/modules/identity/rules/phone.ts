/**
 * Phone numbers as a login handle.
 *
 * Framework-free, like the rest of `rules/`: no Nest, no TypeORM, no decorators. The whole reason
 * this file exists is that a rule expressed once and tested once cannot be applied twice with two
 * different ideas of what "+880 1712-345678" means.
 *
 * ## Why a rider's handle is a phone number
 *
 * A rider in Dhaka is issued a SIM card at the depot. They are not issued a mailbox, and they are
 * not choosing a password they will remember at 6am with a hundred parcels in the bag. The number
 * is the thing they already carry and the thing a dispatcher can ring when a parcel is undeliverable.
 *
 * Asking for an email instead means one of two things, both bad: the rider invents an address they
 * will not remember, or they share the dispatcher's — and two people typing the same credentials is
 * indistinguishable from one person on two devices, so every scan in the queue is ambiguous.
 *
 * ## Why normalisation is not optional
 *
 * The same person types `01712345678`, `+8801712345678` and `880 1712 345678` across three months
 * and a year of trying to sign in. Stored raw, those are three accounts, and the second one fails
 * with a "phone already registered" error that tells them nothing about which of their own entries
 * to delete. `normalisePhone` collapses all of them to one string, so the unique index does the
 * work it is there to do.
 *
 * ## Bangladesh-first, deliberately narrow
 *
 * The country is inferred from the national prefix when one is present, which is the only inference
 * made here. `+8801712345678` and `01712345678` are the same number; `+12125550123` is left exactly
 * as written. A rider in New York using this app is not a case this codebase has to be right about
 * yet, and guessing a country from an ambiguous national number is how you make someone's account
 * unreachable in a country where it previously worked.
 *
 * Anything that cannot be read as a number is returned null rather than repaired. A handle that
 * silently becomes a *different* handle is worse than a handle that is refused: one locks you out
 * and is fixable, the other signs you in as somebody else.
 */

/** Bangladesh's country calling code, and the national trunk prefix it drops. */
const BD_CC = '880';
const BD_TRUNK = '0';

/**
 * Reduce a typed number to `+<digits>`, or return null if it is not a number.
 *
 * Separators are removed rather than validated. `+880 (0)1712-345678` has the trunk zero in
 * parentheses because that is how it is written on a printed manifest, and a rider should not have
 * to know the difference between that and `+8801712345678` to sign in to their shift.
 *
 * Returns null for input containing anything that is not a digit, a leading `+`, or a space, a
 * dash, a dot or a pair of parentheses. Letters are NOT stripped: `017ABC1234` is a typo, and
 * repairing it would let two people into one account.
 */
export function normalisePhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // A leading `+` is the only permitted non-numeric character besides the common separators.
  const explicitPlus = trimmed.startsWith('+');
  const rest = explicitPlus ? trimmed.slice(1) : trimmed;

  // Anything outside digits and the three separators a phone is ever written with.
  if (!/^[0-9\s\-().]+$/.test(rest)) return null;

  const digits = rest.replace(/[^\d]/g, '');
  if (digits.length === 0 || digits.length > 15) return null; // E.164 caps at 15

  if (explicitPlus) return `+${digits}`;

  // No `+`: this is a national number, so the country has to be inferred. Only Bangladesh is
  // inferred, because only Bangladesh is what this app is for.
  if (digits.startsWith(BD_CC)) return `+${digits}`;

  // A national BD number: a leading trunk zero is dropped before the country code is added.
  if (digits.startsWith(BD_TRUNK)) {
    const national = digits.slice(BD_TRUNK.length);
    // `0` alone, or `00…`, is not a number anyone can be reached on.
    if (national.length === 0 || national.startsWith(BD_TRUNK)) return null;
    return `+${BD_CC}${national}`;
  }

  // No trunk zero and no country code: a bare subscriber number is ambiguous, and guessing a
  // country for it would be the one failure mode worth avoiding entirely.
  return null;
}

/**
 * Whether a string is a handle this system can authenticate: an email, or a phone.
 *
 * The rider app asks for one field, not two, because a rider does not know or care which kind of
 * identifier their depot issued them. Deciding here rather than in the controller keeps the
 * controller thin and the decision testable.
 */
export function isLoginHandle(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  return normalisePhone(trimmed) !== null;
}
