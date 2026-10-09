/**
 * Per-parcel public tokens.
 *
 * ## Why this exists
 *
 * `GET /track/:trackingCode` on a code of the form `ZP-[0-9A-HJKMNP-TV-Z]{10}` is a lookup by
 * enumeration. The alphabet excludes I, O, U and L, which leaves 32 characters, so ten of them is
 * 32^10 ≈ 1.1e15 — a large space, but the *code* is printed on a label and travels in SMS, and the
 * public route is rate-limited per IP rather than per parcel. That is a guessing oracle: an attacker
 * walks the space at the public limit and harvests every parcel's recipient name-free status history
 * in the network.
 *
 * A token fixes the shape of the problem without fixing its arithmetic. 32 bytes from
 * `crypto.randomBytes` is 256 bits, which cannot be walked at any rate limit that exists; and unlike a
 * hash of the tracking code it is not derived from anything enumerable, so finding one tells an
 * attacker nothing about the others.
 *
 * ## Why the token lives in `tracking` and not `shipment`
 *
 * The public tracker reads `tracking.public_timeline` and must not reach into `shipment.*` (rule 2).
 * A token that lived on the shipment row would force the public route to open the shipment connection
 * to resolve it — the exact coupling the projection exists to avoid. So the token is minted by the
 * tracking consumer, stored here, and the public route resolves token → `shipment_id` inside its own
 * schema.
 *
 * ## What is deliberately NOT here
 *
 * No token revocation, and no second token. One live token per parcel is the whole feature; a merchant
 * who wants a link to stop working can rotate the shipment's tracking code, which is the only
 * identifier a customer would have quoted. Add revocation when a breach makes it necessary — the
 * column is already the right shape for it.
 */

/** Crockford-ish base32: no I, L, O or U. Humans read these aloud and retype them. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26 characters × 5 bits = 130 bits. Past guessing, short enough to paste into an SMS. */
export const PUBLIC_TOKEN_LENGTH = 26;

/**
 * A token from `crypto.randomBytes`, with rejection sampling.
 *
 * Rejection, not modulo. `byte % 32` is biased when 256 is not a multiple of the alphabet size — it
 * is here, 256 = 8 × 32, so this particular alphabet happens to be uniform. The loop is here anyway
 * because the bias is a property of the *next* alphabet someone picks, and a token generator that is
 * silently 6% weaker on a different alphabet is a trap, not a detail.
 */
export function generatePublicToken(randomBytes: (n: number) => Uint8Array): string {
  let token = '';
  while (token.length < PUBLIC_TOKEN_LENGTH) {
    for (const byte of randomBytes(PUBLIC_TOKEN_LENGTH)) {
      // 248 = 0xf8 is the largest multiple of 32 that fits in a byte. 249..255 are discarded.
      if (byte >= 248) continue;
      token += ALPHABET[byte % 32];
      if (token.length === PUBLIC_TOKEN_LENGTH) break;
    }
  }
  return token;
}

/** The entropy behind a token, for stating it honestly rather than approximately. */
export const PUBLIC_TOKEN_BITS = Math.log2(32) * PUBLIC_TOKEN_LENGTH;
