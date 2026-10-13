/**
 * GET /v1/returns — the merchant's own list, cursor-paginated.
 *
 * Guarded by returns:write (no returns:read scope exists — see common/scopes.ts).
 * Merchant scope comes from the credential, never from a query param. Thin by
 * design: parse query, call one use case, return.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ListReturnsService } from './list-returns.service.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ReturnPageDto } from './returns-response.dto.ts';

export class ListReturnsQuery {
  @ApiPropertyOptional({
    description: 'Rows to return, clamped to at most 200; omit or send 0 for the default of 50.',
  })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({
    description:
      "Opaque position from a previous page's `pagination.nextCursor`. It is unsigned and only " +
      'repositions within your own list; a malformed value is a 400 with a named reason, never a ' +
      'SQL error.',
  })
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
  @ApiOkResponse({
    type: ReturnPageDto,
    description:
      'One merchant-scoped page of your returns, newest first — enough of each to recognise the ' +
      'parcel and read its state. `pagination.nextCursor` is opaque and repositions within your own ' +
      'list; `hasMore` says whether another page exists.',
  })
  @ApiErrors()
  async listReturns(
    @Query() query: ListReturnsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReturnPageDto> {
    return this.list.execute(request.principal!.merchantId!, query.limit, query.cursor);
  }
}
