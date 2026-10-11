/**
 * GET /v1/cod — the merchant's own COD records, cursor-paginated.
 *
 * Guarded by delivery:read: there is no cod:* scope, and collection happens
 * at delivery, so the delivery read scope is the closest fit. Merchant scope
 * comes from the credential, never from a query param — a stranger's cursor
 * only repositions within your own list. Thin by design: parse query, call
 * one use case, return.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ListCodRecordsService } from './list-cod-records.service.ts';
import { CodRecordPageDto } from './cod-response.dto.ts';

export class ListCodRecordsQuery {
  /** Page size. Defaults to 50, capped at 200. */
  @IsOptional()
  @IsString()
  limit?: string;

  /** Opaque cursor from the previous page's `pagination.nextCursor`. Deliberately unsigned: every list is merchant-scoped, so a forged cursor only repositions within its owner's own records. */
  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('cod')
@Controller('v1/cod')
@UseGuards(ApiKeyGuard)
export class ListCodRecordsController {
  constructor(@Inject(ListCodRecordsService) private readonly list: ListCodRecordsService) {}

  @ApiErrors()
  @Get()
  @UseGuards(new ScopeGuard('cod:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'List your COD records, newest first' })
  @ApiOkResponse({
    type: CodRecordPageDto,
    description:
      "One page of your own COD records, newest first, each carrying the frozen quote's " +
      '`expectedMinor` beside whatever was collected, in integer poisha. Cursor-paginated and ' +
      "scoped to your credential, so a stranger's cursor only repositions within their own list.",
  })
  async listCodRecords(
    @Query() query: ListCodRecordsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<CodRecordPageDto> {
    return this.list.execute(request.principal!.merchantId!, query.limit, query.cursor);
  }
}
