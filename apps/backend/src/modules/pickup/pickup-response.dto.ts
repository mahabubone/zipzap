/**
 * Response DTOs for the pickup module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * Hand-declared `interface`s in services do not generate OpenAPI schemas because TypeScript
 * erases them. See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';
import { CursorPaginationDto } from '../../common/dto/pagination.dto.ts';
export { CursorPaginationDto };
import type { PickupStatus } from './rules/pickup.ts';

/**
 * A pickup as it was born: requested, not yet assigned.
 *
 * `shipmentIds` is the batch — one pickup covers up to 50 parcels, and membership is
 * owned by the pickup, so the batch is echoed back in full. `totalWeightGrams` is the
 * caller's declared batch weight. A replayed Idempotency-Key returns the stored body
 * verbatim, which is what `replayed` tells the caller.
 */
export class RequestedPickupDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'REQUESTED' })
  status!: PickupStatus;

  @ApiProperty({
    example: ['b2c3d4e5-f6a7-8901-bcde-f12345678901'],
    type: String,
    isArray: true,
    description: 'Member shipments, as identifiers — never foreign keys (ADR-0002).',
  })
  shipmentIds!: readonly string[];

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

/**
 * The rider assignment decision, as operations needs to read it.
 *
 * `score` is the deterministic rider-contract score — higher is better, and the same
 * candidates always produce the same number. `reasons` is the same decision in words,
 * which is what makes dispatch auditable after the fact instead of a black box.
 */
export class AssignedPickupDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'The pickup that was assigned.',
  })
  pickupId!: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  riderId!: string;

  @ApiProperty({
    example: 'ASSIGNED',
    description: 'Always ASSIGNED — the machine asserted the walk to it.',
  })
  status!: PickupStatus;

  @ApiProperty({ example: 120, description: 'Deterministic score; higher is better.' })
  score!: number;

  @ApiProperty({
    example: ['2km away', '20% spare capacity'],
    type: String,
    isArray: true,
    description: 'The scoring breakdown in words, for the audit trail.',
  })
  reasons!: readonly string[];

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

/** One row of the merchant's pickup list — the batch, its rider, and its terminal state. */
export class PickupSummaryDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'ASSIGNED' })
  status!: PickupStatus;

  @ApiProperty({
    example: ['b2c3d4e5-f6a7-8901-bcde-f12345678901'],
    type: String,
    isArray: true,
    description: 'Member shipments, as identifiers.',
  })
  shipmentIds!: readonly string[];

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', nullable: true })
  riderId!: string | null;

  @ApiProperty({
    example: 'Rider refused the batch',
    nullable: true,
    description: 'The state a FAILED pickup reschedules from; null once terminal.',
  })
  failureReason!: string | null;

  @ApiProperty({ example: 1000, description: 'Declared batch weight in grams.' })
  totalWeightGrams!: number;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-10-10T06:05:00.000Z' })
  updatedAt!: string;
}

/** One cursor-paginated page of pickups, newest first. Merchant scope comes from the credential. */
export class PickupPageDto {
  @ApiProperty({ type: PickupSummaryDto, isArray: true })
  data!: PickupSummaryDto[];

  @ApiProperty({ type: CursorPaginationDto })
  pagination!: CursorPaginationDto;
}
