/**
 * GET /v1/settlements — the merchant's own settlements, cursor-paginated.
 *
 * Guarded by settlements:read, the same scope as the balance read. Merchant
 * scope comes from the credential, never from a query param — a stranger's
 * cursor only repositions within your own list. Thin by design: parse query,
 * call one use case, return.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ListSettlementsService, type SettlementPage } from './list-settlements.service.ts';

export class ListSettlementsQuery {
  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('settlements')
@Controller('v1/settlements')
@UseGuards(ApiKeyGuard)
export class ListSettlementsController {
  constructor(@Inject(ListSettlementsService) private readonly list: ListSettlementsService) {}

  @Get()
  @UseGuards(new ScopeGuard('settlements:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'List your settlements, newest first' })
  async listSettlements(
    @Query() query: ListSettlementsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<SettlementPage> {
    return this.list.execute(request.principal!.merchantId!, query.limit, query.cursor);
  }
}
