/**
 * GET /v1/pickups — the merchant's own list, cursor-paginated.
 *
 * Guarded by pickup:read. Merchant scope comes from the credential, never
 * from a query param — a stranger's cursor only repositions within your own
 * list. Thin by design: parse query, call one use case, return.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ListPickupsService } from './list-pickups.service.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { PickupPageDto } from './pickup-response.dto.ts';

export class ListPickupsQuery {
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

@ApiTags('pickups')
@Controller('v1/pickups')
@UseGuards(ApiKeyGuard)
export class ListPickupsController {
  constructor(@Inject(ListPickupsService) private readonly list: ListPickupsService) {}

  @Get()
  @UseGuards(new ScopeGuard('pickup:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'List your pickups, newest first' })
  @ApiOkResponse({
    type: PickupPageDto,
    description:
      'One merchant-scoped page of your pickups, newest first — each row is the batch, its rider ' +
      '(null until assigned), and its status. `pagination.nextCursor` is opaque and repositions ' +
      'within your own list; `hasMore` says whether another page exists.',
  })
  @ApiErrors()
  async listPickups(
    @Query() query: ListPickupsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<PickupPageDto> {
    return this.list.execute(request.principal!.merchantId!, query.limit, query.cursor);
  }
}
