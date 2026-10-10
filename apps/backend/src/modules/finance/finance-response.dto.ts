/**
 * Response DTOs for the finance module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * Hand-declared `interface`s in services do not generate OpenAPI schemas because TypeScript
 * erases them. See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';
import { CursorPaginationDto } from '../../common/dto/pagination.dto.ts';
export { CursorPaginationDto };

export class BalanceLineDto {
  @ApiProperty({ example: 'DELIVERY_FEE' })
  type!: string;

  @ApiProperty({
    example: 1,
    description: '1 for credit (owed to merchant), -1 for debit (owed by merchant)',
  })
  direction!: number;

  @ApiProperty({ example: 125050, description: 'Sum of entries of this type in minor units' })
  amountMinor!: number;

  @ApiProperty({ example: 42, description: 'How many ledger rows made up this line' })
  entries!: number;
}

export class BalanceBlockDto {
  @ApiProperty({ example: 'RECONCILIATION_EXCEPTION' })
  status!: string;

  @ApiProperty({ example: 2 })
  count!: number;
}

export class NextSettlementSummaryDto {
  @ApiProperty({ example: 'SET-2610-0001' })
  reference!: string;

  @ApiProperty({ example: 250000 })
  netMinor!: number;
}

export class MerchantBalanceDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  merchantId!: string;

  @ApiProperty({
    example: -1250500,
    description: 'Signed minor units: negative means owed to merchant',
  })
  balanceMinor!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  asOf!: string;

  @ApiProperty({ type: BalanceLineDto, isArray: true })
  lines!: readonly BalanceLineDto[];

  @ApiProperty({ type: BalanceBlockDto, isArray: true })
  blocked!: readonly BalanceBlockDto[];

  @ApiProperty({ example: null, nullable: true })
  blockedReason!: string | null;

  @ApiProperty({ type: NextSettlementSummaryDto, nullable: true })
  nextSettlement!: NextSettlementSummaryDto | null;
}

export class SettlementItemDto {
  @ApiProperty({ example: 'entry-123' })
  entryId!: string;

  @ApiProperty({ example: 'COD_COLLECTED' })
  type!: string;

  @ApiProperty({ example: 1 })
  direction!: 1 | -1;

  @ApiProperty({ example: 125050 })
  amountMinor!: number;
}

export class CreatedSettlementDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'SET-2610-0001' })
  reference!: string;

  @ApiProperty({ example: 'm-1' })
  merchantId!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty({ type: SettlementItemDto, isArray: true })
  items!: readonly SettlementItemDto[];

  @ApiProperty({ example: 1250500 })
  netMinor!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;
}

export class SettlementSummaryDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'SET-2610-0001' })
  reference!: string;

  @ApiProperty({ example: 'SETTLED' })
  status!: string;

  @ApiProperty({ example: 1250500 })
  frozenNetMinor!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;
}

export class SettlementPageDto {
  @ApiProperty({ type: SettlementSummaryDto, isArray: true })
  data!: SettlementSummaryDto[];

  @ApiProperty({ type: CursorPaginationDto })
  pagination!: CursorPaginationDto;
}

export class StatementLineDto {
  @ApiProperty({ example: 'entry-123' })
  entryId!: string;

  @ApiProperty({ example: 'COD_COLLECTED' })
  type!: string;

  @ApiProperty({ example: 1 })
  direction!: 1 | -1;

  @ApiProperty({ example: 125050 })
  amountMinor!: number;

  @ApiProperty({ example: 'Delivery to Dhanmondi', nullable: true })
  memo!: string | null;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  occurredAt!: string;

  @ApiProperty({ example: 'shp-123', nullable: true })
  shipmentId!: string | null;
}

export class SettlementStatementDto {
  @ApiProperty({ example: 'SET-2610-0001' })
  reference!: string;

  @ApiProperty({ example: 'APPROVED' })
  status!: string;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: 1250500 })
  netMinor!: number;

  @ApiProperty({ type: StatementLineDto, isArray: true })
  lines!: readonly StatementLineDto[];
}

export class ApprovedSettlementDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'SET-2610-0001' })
  reference!: string;

  @ApiProperty({ example: 'APPROVED' })
  status!: string;

  @ApiProperty({ example: 1250500 })
  netMinor!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({ example: 'u-1' })
  approvedBy!: string;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  approvedAt!: string;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

export class InitiatedSettlementPaymentDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'SET-2610-0001' })
  reference!: string;

  @ApiProperty({ example: 'PROCESSING' })
  status!: string;

  @ApiProperty({ example: 'PAY-PROVIDER-123' })
  paymentReference!: string;

  @ApiProperty({ example: 1250500 })
  netMinor!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

export class ConfirmedSettlementPaymentDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'SET-2610-0001' })
  reference!: string;

  @ApiProperty({ example: 'SETTLED' })
  status!: string;

  @ApiProperty({ example: 'PAY-PROVIDER-123' })
  paymentReference!: string;

  @ApiProperty({ example: 'COMPLETED' })
  providerStatus!: string;

  @ApiProperty({ example: 1250500 })
  netMinor!: number;

  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}
