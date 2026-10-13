/**
 * Response DTOs for the network module — coverage and manifests.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * Hand-declared `interface`s in services do not generate OpenAPI schemas because TypeScript
 * erases them. See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';
import type { ManifestStatus } from './rules/manifest.ts';

/**
 * One manifest as the hub console lists it.
 *
 * `tripId` is the movement this cargo travels on; `code` is the hub-facing label a human
 * dictates to a driver. Status is one of the five validated states — it only moves through
 * `ManifestService.transition`, never a direct write.
 */
export class ManifestViewDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({
    example: 'MNF-4F2A9C1B7D',
    description: 'Human-readable code, spoken on the dock.',
  })
  code!: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  tripId!: string;

  @ApiProperty({
    example: 'SEALED',
    enum: ['DRAFT', 'SEALED', 'DISPATCHED', 'RECEIVED', 'RECONCILED'],
    description: 'Current state. Moves only through the validated transitions.',
  })
  status!: ManifestStatus;
}

/** One cargo item on a manifest, with its arrival resolved for the console. */
export class ManifestItemDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  shipmentId!: string;

  @ApiProperty({
    example: false,
    description:
      'True once the destination hub has scanned the parcel in. Always false before RECEIVED — ' +
      'nobody has looked yet, which is not the same as nothing missing.',
  })
  arrived!: boolean;
}

/** The manifest screen's shape: the manifest plus its cargo list and the exception badge. */
export class ManifestDetailDto extends ManifestViewDto {
  @ApiProperty({ example: 3, description: 'How many cargo items are on the manifest.' })
  itemCount!: number;

  @ApiProperty({
    type: ManifestItemDto,
    isArray: true,
    description: 'Ordered as loaded, not by arrival.',
  })
  items!: readonly ManifestItemDto[];

  @ApiProperty({
    example: 0,
    description:
      'How many items have not arrived. Zero before RECEIVED because nobody has looked yet — ' +
      '"not checked" and "nothing missing" must not render as the same number.',
  })
  missingCount!: number;
}

/** The manifest work list. Not cursor-paginated — the newest-first tail is the working set. */
export class ManifestListDto {
  @ApiProperty({ type: ManifestViewDto, isArray: true })
  data!: ManifestViewDto[];
}

/** The two ids a hub console needs after scheduling one run of a seeded route. */
export class ScheduledTripDto {
  @ApiProperty({
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    description: 'The scheduled trip. One actual movement of the route.',
  })
  tripId!: string;

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'The seeded route.',
  })
  routeId!: string;
}

/** Serviceability for one zone, answered before a shipment is created. */
export class CoverageCheckDto {
  @ApiProperty({ example: 'dhaka-metro' })
  zone!: string;

  @ApiProperty({
    example: true,
    description: 'False when no coverage row exists — absence is never a default-allow.',
  })
  serviceable!: boolean;

  @ApiProperty({
    example: 'Zone "chittagong-hills" is not serviceable.',
    nullable: true,
    description: 'Null when serviceable; a sentence for a human when not.',
  })
  reason!: string | null;

  @ApiProperty({
    example: 2,
    nullable: true,
    description: 'Estimated delivery days, when the zone is serviceable.',
  })
  estimatedDays!: number | null;

  @ApiProperty({ example: true, description: 'Whether a rider can be dispatched to collect.' })
  pickupAvailable!: boolean;

  @ApiProperty({ example: true })
  deliveryAvailable!: boolean;

  @ApiProperty({ example: true, description: 'Whether cash-on-delivery is accepted on this zone.' })
  codAvailable!: boolean;
}

/** Every zone a merchant can ship to, for a picker. Network configuration, never hardcoded. */
export class ServiceableZonesDto {
  @ApiProperty({ example: ['chattogram-metro', 'dhaka-metro'] })
  zones!: string[];
}
