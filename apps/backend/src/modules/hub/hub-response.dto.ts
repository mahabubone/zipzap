/**
 * Response DTOs for the hub module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';
import type { HubScanKind } from './rules/scan.ts';

export class HubScanResultDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  shipmentId!: string;

  @ApiProperty({
    example: 'INBOUND',
    description: 'The hub gesture that was recorded (INBOUND, SORT, OUTBOUND, DEPARTED, ARRIVED).',
  })
  scan!: HubScanKind;

  @ApiProperty({ example: 'AT_ORIGIN_HUB', description: 'The shipment status after the scan.' })
  status!: string;

  @ApiProperty({
    example: 'DHK-01',
    nullable: true,
    description: 'Hub code when the scan named one; null for a hubCode-less scan.',
  })
  hubCode!: string | null;
}

export class HubSummaryDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'DHK-01' })
  code!: string;

  @ApiProperty({ example: 'Dhaka Central Hub' })
  name!: string;

  @ApiProperty({ example: 'DISTRICT' })
  kind!: string;

  @ApiProperty({ example: 'dhaka-metro', nullable: true })
  networkZone!: string | null;

  @ApiProperty({ example: 90.4125, nullable: true })
  lng!: number | null;

  @ApiProperty({ example: 23.8103, nullable: true })
  lat!: number | null;

  @ApiProperty({ example: 42, description: 'Parcels currently waiting at this hub.' })
  countAtHub!: number;
}

export class ParcelPresenceDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  shipmentId!: string;

  @ApiProperty({ example: 'ZZ-2610-ABCD' })
  trackingCode!: string;

  @ApiProperty({ example: 'DHK-01' })
  hubCode!: string;

  @ApiProperty({
    example: 'INBOUND',
    description: 'The hub gesture most recently recorded for this parcel.',
  })
  lastScan!: string;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  scannedAt!: Date;

  @ApiProperty({
    example: 'SORT',
    nullable: true,
    description:
      'Next hub gesture this parcel needs, derived from the scan order. Null once arrived.',
  })
  nextScan!: string | null;
}

export class HubParcelsViewDto {
  @ApiProperty({ type: HubSummaryDto })
  hub!: HubSummaryDto;

  @ApiProperty({ type: ParcelPresenceDto, isArray: true })
  parcels!: ParcelPresenceDto[];
}
