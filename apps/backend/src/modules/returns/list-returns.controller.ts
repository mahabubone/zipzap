/**
 * GET /v1/returns — the merchant's own list, cursor-paginated.
 *
 * Guarded by returns:write (no returns:read scope exists — see common/scopes.ts).
 * Merchant scope comes from the credential, never from a query param. Thin by
 * design: parse query, call one use case, return.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ListReturnsService, type ReturnPage } from './list-returns.service.ts';

export class ListReturnsQuery {
  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('returns')
@Controller('v1/returns')
@UseGuards(ApiKeyGuard)
export class ListReturnsController {
  constructor(@Inject(ListReturnsService) private readonly list: ListReturnsService) {}

  @Get()
  @UseGuards(new ScopeGuard('returns:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'List your returns, newest first' })
  async listReturns(
    @Query() query: ListReturnsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReturnPage> {
    return this.list.execute(request.principal!.merchantId!, query.limit, query.cursor);
  }
}
