/**
 * Response DTOs for the delivery module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * See ADR-0004.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { DeliveryStatus } from './rules/delivery.ts';

export class CreatedDeliveryJobDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'shp-123' })
  shipmentId!: string;

  @ApiPropertyOptional({ example: 'r-123', nullable: true })
  riderId!: string | null;

  @ApiProperty({ example: 'CREATED' })
  status!: DeliveryStatus;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

export class DeliveryStatusDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'ACCEPTED' })
  status!: DeliveryStatus;
}

export class RecordedAttemptDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  jobId!: string;

  @ApiProperty({ example: 1 })
  sequence!: number;

  @ApiProperty({ example: 'OUT_FOR_DELIVERY' })
  status!: DeliveryStatus;

  @ApiProperty({ example: true })
  retryScheduled!: boolean;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

export class IssuedDeliveryCodeDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  jobId!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: 'PENDING';

  @ApiProperty({ example: '2026-10-10T06:10:00.000Z' })
  expiresAt!: string;

  @ApiProperty({ example: 5 })
  attemptsRemaining!: number;

  @ApiProperty({ example: '123456', description: 'Plaintext OTP returned once and never stored' })
  code!: string;
}

export class SubmittedDeliveryProofDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  jobId!: string;

  @ApiProperty({ example: 'prf-123' })
  proofId!: string;

  @ApiProperty({ example: 'VERIFIED' })
  status!: 'VERIFIED';

  @ApiProperty({ example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' })
  photoSha256!: string;

  @ApiProperty({ example: 254321 })
  photoByteLength!: number;

  @ApiProperty({ example: '2026-10-10T06:05:00.000Z' })
  otpVerifiedAt!: string;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}
