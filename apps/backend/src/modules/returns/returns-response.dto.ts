/**
 * Response DTOs for the returns module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * Hand-declared `interface`s in services do not generate OpenAPI schemas because TypeScript
 * erases them. See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';
import { CursorPaginationDto } from '../../common/dto/pagination.dto.ts';
export { CursorPaginationDto };
import type { ReturnStatus } from './rules/returns.ts';

/**
 * A return request as the merchant just made it.
 *
 * The id is the return's own aggregate id, distinct from `shipmentId` — a return
 * references the original parcel and is never a second parcel. `status` is always
 * RETURN_REQUESTED on the first call; a replay of the same Idempotency-Key returns
 * the stored body verbatim, which is why `replayed` is part of the contract.
 */
export class RequestedReturnDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  shipmentId!: string;

  @ApiProperty({
    example: 'RETURN_REQUESTED',
    description: 'Where the return sits in the decision-then-custody machine.',
  })
  status!: ReturnStatus;

  @ApiProperty({
    example: false,
    description: 'True when request was replayed via Idempotency-Key',
  })
  replayed!: boolean;
}

/**
 * The result of a return transition: approve, reject, or one custody leg.
 *
 * One shape for the three machine edges because they all answer the same question
 * the caller asks next — "where is this return now". `status` is the destination
 * state, so a terminal move (RETURN_REJECTED, RETURNED) is visible here and not
 * only in the list.
 */
export class ReturnStatusDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'RETURN_APPROVED' })
  status!: ReturnStatus;
}

/** One row of the merchant's return list — enough to recognise the parcel and its state. */
export class ReturnSummaryDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  shipmentId!: string;

  @ApiProperty({ example: 'RETURN_REQUESTED', description: 'One of RETURN_STATUSES.' })
  status!: string;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;
}

/** One cursor-paginated page of returns, newest first. Merchant scope comes from the credential. */
export class ReturnPageDto {
  @ApiProperty({ type: ReturnSummaryDto, isArray: true })
  data!: ReturnSummaryDto[];

  @ApiProperty({ type: CursorPaginationDto })
  pagination!: CursorPaginationDto;
}
