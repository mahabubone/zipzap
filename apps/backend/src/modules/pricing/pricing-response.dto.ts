/**
 * Response DTOs for the pricing module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * Hand-declared `interface`s in services do not generate OpenAPI schemas because TypeScript
 * erases them. See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';

/** Money: integer minor units plus a currency. Never a float, anywhere (ADR-0009). */
export class MoneyDto {
  @ApiProperty({
    example: 125050,
    description: 'Integer minor units (poisha). 125050 is ৳1,250.50 — never a decimal amount.',
  })
  amountMinor!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;
}

/** One itemised line on a quote. The `DISCOUNT` line is the only negative amount. */
export class QuoteLineDto {
  @ApiProperty({
    example: 'BASE',
    enum: ['BASE', 'WEIGHT', 'COD_FEE', 'REMOTE_AREA', 'HANDLING', 'PACKAGING', 'TAX', 'DISCOUNT'],
  })
  kind!: string;

  @ApiProperty({ example: 'Weight surcharge (2 kg)', description: 'A sentence for a human.' })
  label!: string;

  @ApiProperty({ type: MoneyDto })
  amount!: MoneyDto;
}

/** A priced shipment, itemised against exactly one frozen pricing version. */
export class QuoteResponseDto {
  @ApiProperty({
    example: 3,
    description: 'The frozen version this quote was computed against — the dispute evidence.',
  })
  version!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({
    type: QuoteLineDto,
    isArray: true,
    description: 'In the order the rules add them.',
  })
  lines!: readonly QuoteLineDto[];

  @ApiProperty({ type: MoneyDto, description: 'The sum of the lines, in the quoted currency.' })
  total!: MoneyDto;
}

/** One "for a 1 kg parcel inside Dhaka, you pay X" line on the rate card. */
export class RateCardExampleDto {
  @ApiProperty({ example: '1 kg parcel, inside Dhaka, no COD' })
  label!: string;

  @ApiProperty({ example: 95000, description: 'Integer minor units (poisha).' })
  totalMinor!: number;
}

/** The merchant's active rate card, with worked examples so it can be read without a parcel. */
export class RateCardResponseDto {
  @ApiProperty({
    example: 3,
    description: 'The frozen version the coefficients were read from.',
  })
  version!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({
    example: 'growth',
    description: 'The plan THIS merchant is on. Not a list of plans — theirs.',
  })
  plan!: string;

  @ApiProperty({
    example: 6000,
    description: 'Base delivery fee in integer minor units (poisha).',
  })
  baseFeeMinor!: number;

  @ApiProperty({
    example: 2000,
    description: 'Per billable kilogram, in integer minor units (poisha).',
  })
  perKgMinor!: number;

  @ApiProperty({ example: 180, description: 'COD fee in basis points: 180 is 1.8%.' })
  codFeeBps!: number;

  @ApiProperty({
    example: 4000,
    description: 'Remote-area surcharge in integer minor units (poisha).',
  })
  remoteAreaFeeMinor!: number;

  @ApiProperty({
    example: 1500,
    description: 'Fragile handling surcharge in integer minor units (poisha).',
  })
  fragileFeeMinor!: number;

  @ApiProperty({
    type: Object,
    example: { box_s: 800, box_m: 1500 },
    description: 'Packaging fee per kind, in integer minor units (poisha).',
  })
  packagingFeesMinor!: Record<string, number>;

  @ApiProperty({ example: 500, description: 'VAT in basis points: 500 is 5%.' })
  taxBps!: number;

  @ApiProperty({
    example: 500,
    description: "This merchant's plan discount in basis points. Zero is a real answer.",
  })
  planDiscountBps!: number;

  @ApiProperty({
    type: RateCardExampleDto,
    isArray: true,
    description:
      'Worked examples, run through the quote engine itself so they cannot drift from a real quote.',
  })
  examples!: readonly RateCardExampleDto[];
}
