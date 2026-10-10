/**
 * Response DTOs for the shipment module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * Hand-declared `interface`s in services do not generate OpenAPI schemas because TypeScript
 * erases them. See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';
import { CursorPaginationDto } from '../../common/dto/pagination.dto.ts';
export { CursorPaginationDto };

export class CodAmountDto {
  @ApiProperty({ example: 125050, description: 'Integer minor units (poisha)' })
  amountMinor!: number;

  @ApiProperty({ example: 'BDT', description: 'ISO currency code' })
  currency!: string;
}

export class CreatedShipmentDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'ZZ-2610-ABCD' })
  trackingCode!: string;

  @ApiProperty({ example: 'CREATED' })
  status!: string;

  @ApiProperty({ type: CodAmountDto })
  cod!: CodAmountDto;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

export class ShipmentSummaryDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'ZZ-2610-ABCD' })
  trackingCode!: string;

  @ApiProperty({ example: 'CREATED' })
  status!: string;

  @ApiProperty({ example: 'INV-1001', nullable: true })
  merchantReference!: string | null;

  @ApiProperty({ example: 125050 })
  codAmountMinor!: number;

  @ApiProperty({ example: 'BDT' })
  codCurrency!: string;

  @ApiProperty({ example: 'dhaka-metro', nullable: true })
  zone!: string | null;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;
}

export class ShipmentPageDto {
  @ApiProperty({ type: ShipmentSummaryDto, isArray: true })
  data!: ShipmentSummaryDto[];

  @ApiProperty({ type: CursorPaginationDto })
  pagination!: CursorPaginationDto;
}

export class TimelineEntryDto {
  @ApiProperty({ example: 'ShipmentCreated' })
  eventType!: string;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  occurredAt!: string;

  @ApiProperty({ example: 'human', description: 'human | system | rider' })
  actorType!: string;

  @ApiProperty({ type: Object, example: { hubCode: 'DHK-01' } })
  metadata!: Record<string, unknown>;

  @ApiProperty({ example: null, nullable: true })
  correctsEventId!: string | null;
}

export class ShipmentDetailDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'ZZ-2610-ABCD' })
  trackingCode!: string;

  @ApiProperty({ example: 'CREATED' })
  status!: string;

  @ApiProperty({ example: 'INV-1001', nullable: true })
  merchantReference!: string | null;

  @ApiProperty({ example: 'Rahim' })
  senderName!: string;

  @ApiProperty({ example: '+8801700000000' })
  senderPhone!: string;

  @ApiProperty({ example: 'House 1, Road 2, Dhanmondi, Dhaka' })
  senderAddress!: string;

  @ApiProperty({ example: 'Karim' })
  recipientName!: string;

  @ApiProperty({ example: '+8801800000000' })
  recipientPhone!: string;

  @ApiProperty({ example: 'Agrabad, Chattogram' })
  recipientAddress!: string;

  @ApiProperty({ example: 1000 })
  parcelWeightGrams!: number;

  @ApiProperty({ example: 'Books and stationery' })
  parcelDescription!: string;

  @ApiProperty({ example: 125050 })
  codAmountMinor!: number;

  @ApiProperty({ example: 'BDT' })
  codCurrency!: string;

  @ApiProperty({ example: 'dhaka-metro', nullable: true })
  zone!: string | null;

  @ApiProperty({ example: 1 })
  pricingVersion!: number;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ type: TimelineEntryDto, isArray: true })
  timeline!: readonly TimelineEntryDto[];
}

export class CancelledShipmentDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'CANCELLED' })
  status!: string;
}

export class HeldShipmentDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  shipmentId!: string;

  @ApiProperty({ example: 'HOLD' })
  status!: string;
}

export class ReportedExceptionDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  shipmentId!: string;

  @ApiProperty({ example: 'LOST', description: 'Target exception status (e.g. LOST, DAMAGED)' })
  status!: string;
}

export class BulkJobViewDto {
  @ApiProperty({ example: 'job-123' })
  id!: string;

  @ApiProperty({ example: 'merchant-456' })
  merchantId!: string;

  @ApiProperty({ example: 'shipments.csv' })
  filename!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty({ example: 100 })
  totalRows!: number;

  @ApiProperty({ example: 0 })
  processedRows!: number;

  @ApiProperty({ example: 0 })
  succeededRows!: number;

  @ApiProperty({ example: 0 })
  failedRows!: number;

  @ApiProperty({ example: 0 })
  skippedRows!: number;
}

export class BulkPreviewRowDto {
  @ApiProperty({ example: 2 })
  lineNumber!: number;

  @ApiProperty({ example: 'INV-1001' })
  invoice!: string;

  @ApiProperty({ example: 'VALID' })
  outcome!: string;

  @ApiProperty({ example: null, nullable: true })
  reason!: string | null;
}

export class BulkPreviewDto {
  @ApiProperty({ type: BulkJobViewDto })
  job!: BulkJobViewDto;

  @ApiProperty({ type: BulkPreviewRowDto, isArray: true })
  rows!: BulkPreviewRowDto[];
}
