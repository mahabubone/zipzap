/**
 * Response DTOs for the rider module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';
import { MoneyMinor } from '../../common/dto/money.ts';
import type { RiderStatus } from './rules/rider.ts';
import type { PickupStatus } from '../pickup/rules/pickup.ts';
import type { DeliveryStatus } from '../delivery/rules/delivery.ts';

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

  @ApiProperty({ type: Object, example: { note: 'device-supplied' } })
  payload!: Readonly<object>;

  @ApiProperty({ type: Object, example: null, nullable: true })
  expectedState!: Readonly<object> | null;

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

/**
 * The verdict on one acknowledged command, mirroring `AckOutcome` in offline-sync.service.ts.
 *
 * A fresh ack resolves to delivered or rejected; the already_* variants are a replayed
 * Idempotency-Key handing back what the first ack recorded, so the device reconciles rather than
 * retries. `replayed` tracks the kind: false on a fresh decision, true on a replay.
 */
export class AckOutcomeDto {
  @ApiProperty({
    example: 'delivered',
    enum: ['delivered', 'rejected', 'already_delivered', 'already_rejected'],
    description:
      'A fresh ack is delivered or rejected; the already_* variants return what a prior ' +
      'Idempotency-Key recorded.',
  })
  kind!: 'delivered' | 'rejected' | 'already_delivered' | 'already_rejected';

  @ApiProperty({ example: false })
  replayed!: boolean;
}

export class AckResultDto {
  @ApiProperty({ type: AckOutcomeDto, description: 'Outcome of command acknowledgement' })
  outcome!: AckOutcomeDto;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

export class RiderPickupJobDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'b1c2d3e4-f6a7-8901-bcde-f12345678901' })
  merchantId!: string;

  @ApiProperty({ type: [String], example: ['shp-1', 'shp-2'] })
  shipmentIds!: string[];

  @ApiProperty({ example: 'r-123', nullable: true })
  riderId!: string | null;

  @ApiProperty({ example: 'ASSIGNED' })
  status!: PickupStatus;

  @ApiProperty({ example: null, nullable: true })
  failureReason!: string | null;

  @ApiProperty({ example: 12000, description: 'Total batch weight, integer grams' })
  totalWeightGrams!: number;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-10-10T06:05:00.000Z' })
  updatedAt!: Date;
}

/** What the rider needs to know about the parcel, read from the shipment that owns it. */
export class ShipmentHandoffDto {
  @ApiProperty({ example: 'shp-1', description: 'Shipment id this handoff describes.' })
  shipmentId!: string;

  /**
   * `MoneyMinor`, not a bare `@ApiProperty`. The CLI plugin derives `type` from the
   * class-validator decorator, and a plain `@IsInt`-less numeric field would claim
   * double precision for a `bigint` column — AGENTS.md rule 4, broken by the spec.
   */
  @MoneyMinor({
    example: 125050,
    description:
      'Cash to collect, in integer minor units (poisha). Zero means prepaid: nothing to take.',
  })
  codAmountMinor!: number;

  @ApiProperty({ example: 'BDT', description: 'Currency of the cash to collect.' })
  codCurrency!: string;
}

/** Who and where, for the rider at the door. Absence is possible but never invented. */
export class RecipientDto {
  @ApiProperty({ example: '+8801711223344', nullable: true })
  phone!: string | null;

  @ApiProperty({ example: 'Ayesha Rahman', nullable: true })
  name!: string | null;

  @ApiProperty({ example: 'House 12, Road 7, Dhanmondi, Dhaka 1205', nullable: true })
  address!: string | null;
}

export class RiderDeliveryJobDto {
  @ApiProperty({ example: 'a1b2c3d4-e6f7-4890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'shp-123' })
  shipmentId!: string;

  @ApiProperty({ example: 'r-123' })
  riderId!: string;

  @ApiProperty({ example: 'ACCEPTED' })
  status!: DeliveryStatus;

  @ApiProperty({ example: 0 })
  attemptsMade!: number;

  @ApiProperty({ example: null, nullable: true })
  lastFailureReason!: string | null;

  /**
   * `getSchemaRef` rather than `type:`, so the spec references the DTO instead of inlining it.
   *
   * With `type: ShipmentHandoffDto` the plugin emits an inline nested object that then contains
   * **no properties at all** — a shape that looks described and describes nothing, and that the
   * `$ref` is checked for by the contract test. `getSchemaRef` is what makes the nested DTO
   * resolvable.
   */
  @ApiProperty({
    type: () => ShipmentHandoffDto,
    nullable: true,
    description:
      'What to collect and in which currency, read from the shipment that owns the parcel. ' +
      'Without it a rider is asked for cash without being told how much.',
  })
  shipment!: ShipmentHandoffDto | null;

  @ApiProperty({
    type: () => RecipientDto,
    nullable: true,
    description:
      'Who to call and where to go. `phone` is null only when the shipment carries no number; ' +
      'the rider app says so rather than offering a call that cannot connect.',
  })
  recipient!: RecipientDto | null;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-10-10T06:05:00.000Z' })
  updatedAt!: Date;
}

/** A rider's home feed: the two ordered lists the rider app merges, each newest first. */
export class RiderJobsDto {
  @ApiProperty({
    type: RiderPickupJobDto,
    isArray: true,
    description: 'Pickup batches assigned to this rider, newest first',
  })
  pickups!: RiderPickupJobDto[];

  @ApiProperty({
    type: RiderDeliveryJobDto,
    isArray: true,
    description:
      'Delivery jobs assigned to this rider, newest first, each carrying what to collect and ' +
      'who to call — read through `SHIPMENT_HANDOFF_LOOKUP` because the parcel lives in ' +
      'shipment\u2019s schema and a module may not join across it',
  })
  deliveries!: RiderDeliveryJobDto[];
}
