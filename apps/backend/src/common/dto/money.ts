/**
 * Property decorators for money, so the spec is right rather than merely plausible.
 *
 * AGENTS.md rule 4: money is integer minor units plus a currency, `bigint` columns, integer
 * arithmetic. The `@nestjs/swagger` CLI plugin derives `type` from the class-validator decorator,
 * and `@IsInt()` becomes `type: "number"` — so every amount field in the generated spec claims
 * double precision for a value the schema stores as `bigint`. A generated client then produces
 * `number`, which is exactly the shape rule 4 forbids and the kind of lie that only surfaces when
 * a total crosses 2^53 and loses its tail.
 *
 * Two helpers, because the wire format genuinely differs and the spec must say which is which:
 *
 * - `@MoneyMinor()` — a per-row amount. JSON number, `type: 'integer'`, described in poisha.
 * - `@MoneyMinorString()` — an aggregate. Decimal string, `type: 'string'`. `bigint` aggregates
 *   cannot survive `JSON.stringify` as a number, so they already cross the wire as strings
 *   (`sumOutstandingCODMinor`, the merchant day series); this makes that explicit instead of
 *   accidental.
 *
 * Every `*Minor` property in a response DTO must use one of these. `openapi-contract.test.ts`
 * asserts it, so a hand-written `@ApiProperty({ example: 125050 })` on a money field fails CI.
 */

import { ApiProperty, type ApiPropertyOptions } from '@nestjs/swagger';

const MINOR_UNIT_NOTE = 'Integer minor units (poisha). Never a decimal.';

/** A per-row amount of money: integer minor units on the wire, `type: 'integer'` in the spec. */
export function MoneyMinor(options: Omit<ApiPropertyOptions, 'type'> = {}): PropertyDecorator {
  // `required` is omitted rather than blanked: `ApiPropertyOptions` is a union whose array form is
  // for `isArray` responses, and letting it default is the correct shape here.
  return ApiProperty({
    ...options,
    type: 'integer',
    description: options.description ?? MINOR_UNIT_NOTE,
  } as ApiPropertyOptions);
}

/**
 * An aggregate or summary amount of money: a decimal string on the wire.
 *
 * Used where the value is a sum that may exceed 2^53 poisha (about 90 trillion taka), which a JSON
 * number cannot represent exactly. The alternative — a wrong number — is worse than a string.
 */
export function MoneyMinorString(
  options: Omit<ApiPropertyOptions, 'type'> = {},
): PropertyDecorator {
  return ApiProperty({
    ...options,
    type: 'string',
    description: `${MINOR_UNIT_NOTE} A string because an aggregate can exceed 2^53 poisha, which JSON numbers cannot represent exactly.`,
  } as ApiPropertyOptions);
}
