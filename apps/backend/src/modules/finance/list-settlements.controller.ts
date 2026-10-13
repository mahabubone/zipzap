/**
 * GET /v1/settlements — the merchant's own settlements, cursor-paginated.
 *
 * Guarded by settlements:read, the same scope as the balance read. Merchant
 * scope comes from the credential, never from a query param — a stranger's
 * cursor only repositions within your own list. Thin by design: parse query,
 * call one use case, return.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ListSettlementsService } from './list-settlements.service.ts';
import { SettlementPageDto } from './finance-response.dto.ts';

export class ListSettlementsQuery {
  /** Page size. Defaults to 50, capped at 200. */
  @IsOptional()
  @IsString()
  limit?: string;

  /** Opaque cursor from the previous page's `pagination.nextCursor`. Deliberately unsigned: every list is merchant-scoped, so a forged cursor only repositions within its owner's own settlements. */
  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('settlements')
@Controller('v1/settlements')
@UseGuards(ApiKeyGuard)
export class ListSettlementsController {
  constructor(@Inject(ListSettlementsService) private readonly list: ListSettlementsService) {}

  @ApiErrors()
  @Get()
  @UseGuards(new ScopeGuard('settlements:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'List your settlements, newest first' })
  @ApiOkResponse({
    type: SettlementPageDto,
    description:
      'One page of your own settlements, newest first, with `frozenNetMinor` — the integer-poisha ' +
      'net each one pays — frozen at creation and never recalculated afterwards. Cursor-paginated ' +
      "and scoped to your credential, so a stranger's cursor only repositions within their own " +
      'list.',
  })
  async listSettlements(
    @Query() query: ListSettlementsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<SettlementPageDto> {
    return this.list.execute(request.principal!.merchantId!, query.limit, query.cursor);
  }
}
