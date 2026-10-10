/**
 * Response DTOs for the cod module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * Hand-declared `interface`s in services do not generate OpenAPI schemas because TypeScript
 * erases them. See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';
import { CursorPaginationDto } from '../../common/dto/pagination.dto.ts';
export { CursorPaginationDto };

export class CollectedCodDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  shipmentId!: string;

  @ApiProperty({ example: 125050, description: 'Expected COD amount in minor units (poisha)' })
  expectedMinor!: number;

  @ApiProperty({ example: 125050, description: 'Collected COD amount in minor units (poisha)' })
  collectedMinor!: number;

  @ApiProperty({
    example: 0,
    description: 'Shortfall: expected - collected, 0 when fully collected',
  })
  shortfallMinor!: number;

  @ApiProperty({ example: 'COLLECTED', description: 'COLLECTED | PARTIALLY_COLLECTED' })
  status!: string;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

export class ReconciledCodDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  shipmentId!: string;

  @ApiProperty({ example: 'RECONCILED' })
  status!: string;
}

export class CodRecordSummaryDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  shipmentId!: string;

  @ApiProperty({ example: 'COLLECTED' })
  status!: string;

  @ApiProperty({ example: 125050 })
  expectedMinor!: number;

  @ApiProperty({ example: 125050, nullable: true })
  collectedMinor!: number | null;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;
}

export class CodRecordPageDto {
  @ApiProperty({ type: CodRecordSummaryDto, isArray: true })
  data!: CodRecordSummaryDto[];

  @ApiProperty({ type: CursorPaginationDto })
  pagination!: CursorPaginationDto;
}

export class CodExceptionDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  shipmentId!: string;

  @ApiProperty({ example: 125050 })
  expectedMinor!: number;

  @ApiProperty({ example: 100000, nullable: true })
  collectedMinor!: number | null;

  @ApiProperty({ example: -25050, description: 'collected - expected; negative means shortfall' })
  differenceMinor!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({ example: null, nullable: true })
  reviewNote!: string | null;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;
}

export class CodExceptionPageDto {
  @ApiProperty({ type: CodExceptionDto, isArray: true })
  data!: readonly CodExceptionDto[];

  @ApiProperty({ type: CursorPaginationDto })
  pagination!: CursorPaginationDto;
}
