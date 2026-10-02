/**
 * Postgres type handling.
 *
 * `pg` returns `int8` (bigint) as a string. Money is stored as bigint (ADR-0009), so every
 * amount must be parsed explicitly — never left as a string that quietly becomes NaN, and
 * never coerced with Number() where precision is silently lost.
 *
 * `ponytail:` the `getTypeParser` override receives (oid, format) and must return a parser
 * for every type. Returning our parser unconditionally replaces *all* parsers, which breaks
 * even a `SELECT version()` text column. Only int8 is overridden; everything else falls
 * through to pg's own registry.
 */

import { types as pgTypes } from 'pg';

/** int8. The only OID we override. */
const INT8_OID = 20;

export function parseBigInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    // Money beyond 2^53 minor units is not representable. Fail loudly rather than round.
    throw new RangeError(
      `bigint ${value} exceeds Number.MAX_SAFE_INTEGER. ` +
        'Money must stay inside the safe-integer range — see docs/ADR/0009.',
    );
  }
  return parsed;
}

export function pgTypesConfig(): {
  getTypeParser: (oid: string | number, format?: unknown) => (value: string) => unknown;
} {
  return {
    getTypeParser(oid, format) {
      if (Number(oid) === INT8_OID) return parseBigInt;
      return pgTypes.getTypeParser(Number(oid), format as never);
    },
  };
}
