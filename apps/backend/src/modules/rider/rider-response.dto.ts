/**
 * Response DTOs for the rider module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';
import type { RiderStatus } from './rules/rider.ts';
import type { AckOutcome } from './offline-sync.service.ts';

export class RegisteredRiderDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'AVAILABLE' })
  status!: RiderStatus;
}

export class RiderPositionDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  riderId!: string;

  @ApiProperty({ example: 23.8103 })
  latitude!: number;

  @ApiProperty({ example: 90.4125 })
  longitude!: number;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  recordedAt!: string;

  @ApiProperty({ example: 3 })
  ageSeconds!: number;
}

export class RiderLoadDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  riderId!: string;

  @ApiProperty({ example: 20 })
  capacity!: number;

  @ApiProperty({ example: 1 })
  activeJobs!: number;

  @ApiProperty({ example: 0.05, description: '0..1 current load factor' })
  loadFactor!: number;
}

export class PoolUtilisationDto {
  @ApiProperty({ example: 500 })
  totalCapacity!: number;

  @ApiProperty({ example: 250 })
  inUseCapacity!: number;

  @ApiProperty({ example: 0.5 })
  loadFactor!: number;

  @ApiProperty({ example: 0.48 })
  meanLoadFactor!: number;

  @ApiProperty({ example: 1.0 })
  maxLoadFactor!: number;

  @ApiProperty({ example: 0.0 })
  minLoadFactor!: number;
}

export class PullCommandDto {
  @ApiProperty({ example: 'cmd-123' })
  id!: string;

  @ApiProperty({ example: 'zipzap.rider.command' })
  commandType!: string;

  @ApiProperty({ example: {} })
  payload!: Record<string, unknown>;

  @ApiProperty({ example: null, nullable: true })
  expectedState!: Record<string, unknown> | null;

  @ApiProperty({ example: 1 })
  deviceSequence!: number;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: Date;
}

export class PullResultDto {
  @ApiProperty({ type: PullCommandDto, isArray: true })
  commands!: readonly PullCommandDto[];

  @ApiProperty({ example: 5 })
  queueSize!: number;

  @ApiProperty({ example: false })
  capWarning!: boolean;
}

export class ReplayOutcomeDto {
  @ApiProperty({ example: 1 })
  deviceSequence!: number;

  @ApiProperty({ example: 'cmd-123' })
  commandId!: string;

  @ApiProperty({ example: 'applied', enum: ['applied', 'rejected', 'duplicate'] })
  kind!: 'applied' | 'rejected' | 'duplicate';

  @ApiProperty({ example: null, nullable: true })
  reason!: string | null;
}

export class ReplayResultDto {
  @ApiProperty({ type: ReplayOutcomeDto, isArray: true })
  results!: readonly ReplayOutcomeDto[];

  @ApiProperty({ example: 10 })
  queueSize!: number;

  @ApiProperty({ example: false })
  capWarning!: boolean;
}

export class AckResultDto {
  @ApiProperty({
    example: { kind: 'delivered', replayed: false },
    description: 'Outcome of command acknowledgement',
  })
  outcome!: AckOutcome;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

export class RiderJobsDto {
  @ApiProperty({ type: [Object], description: 'List of pickup jobs assigned to this rider' })
  pickups!: unknown[];

  @ApiProperty({ type: [Object], description: 'List of delivery jobs assigned to this rider' })
  deliveries!: unknown[];
}
