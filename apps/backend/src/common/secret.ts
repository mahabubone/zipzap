/**
 * Secret hashing. Framework-free, and used by `identity/` and `merchant/` alike.
 *
 * scrypt from node:crypto, not a native dependency. It is memory-hard, in the standard library,
 * and there is no reason to ship a compiled addon to compute a hash we compare once per request.
 *
 * `ponytail:` docs/domains/identity.md names argon2id. scrypt is the better engineering trade
 * here — zero dependencies, no prebuilt binaries, memory-hard — and is what node gives us. Move
 * to argon2 if we ever need Argon2's GPU resistance, which a login endpoint does not.
 *
 * The stored format is versioned (`scrypt$N$r$p$salt$hash`) so the parameters can be raised later
 * without invalidating existing credentials: verify against the parameters in the stored value.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 2 ** 15; // CPU/memory cost
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
// scrypt needs roughly 128 * N * r bytes; the default 32MB cap is too low at N=2^15.
const MAX_MEMORY = 128 * N * R * 2;

export function hashSecret(secret: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(secret.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEMORY,
  });
  return ['scrypt', N, R, P, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const expected = Buffer.from(hashRaw!, 'base64url');
  let derived: Buffer;
  try {
    derived = scryptSync(
      secret.normalize('NFKC'),
      Buffer.from(saltRaw!, 'base64url'),
      expected.length,
      {
        N: Number(nRaw),
        r: Number(rRaw),
        p: Number(pRaw),
        maxmem: MAX_MEMORY,
      },
    );
  } catch {
    // Malformed stored parameters must fail closed, not throw into a request handler.
    return false;
  }

  // Length check first: timingSafeEqual throws on a length mismatch.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** A non-guessable, prefixed token. Used for API key ids, not for secrets. */
export function generateKeyId(prefix = 'ak'): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}
