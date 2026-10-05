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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ListCodRecordsService, type CodRecordPage } from './list-cod-records.service.ts';

export class ListCodRecordsQuery {
  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('cod')
@Controller('v1/cod')
@UseGuards(ApiKeyGuard)
export class ListCodRecordsController {
  constructor(@Inject(ListCodRecordsService) private readonly list: ListCodRecordsService) {}

  @Get()
  @UseGuards(new ScopeGuard('cod:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'List your COD records, newest first' })
  async listCodRecords(
    @Query() query: ListCodRecordsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<CodRecordPage> {
    return this.list.execute(request.principal!.merchantId!, query.limit, query.cursor);
  }
}
