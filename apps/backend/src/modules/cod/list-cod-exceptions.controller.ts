/**
 * GET /v1/cod/exceptions — the reconciliation work queue. Thin by design.
 *
 * Scoped `cod:read`, the same scope as the record list: seeing that a collection is disputed is not
 * more sensitive than seeing that it was collected. Merchant scope comes from the credential, never
 * from a query param, so a stranger's cursor only repositions within their own queue.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ListCodExceptionsService } from './list-cod-exceptions.service.ts';
import { CodExceptionPageDto } from './cod-response.dto.ts';

export class ListCodExceptionsQuery {
  /** Page size. Defaults to 50, capped at 200. */
  @IsOptional()
  @IsString()
  limit?: string;

  /** Opaque cursor from the previous page's `pagination.nextCursor`. Deliberately unsigned: every queue is merchant-scoped, so a forged cursor only repositions within its owner's own queue. */
  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('cod')
@Controller('v1/cod')
@UseGuards(ApiKeyGuard)
export class ListCodExceptionsController {
  constructor(
    @Inject(ListCodExceptionsService) private readonly exceptions: ListCodExceptionsService,
  ) {}

  @ApiErrors()
  @Get('exceptions')
  @UseGuards(new ScopeGuard('cod:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'Unreviewed COD reconciliation exceptions, newest first' })
  @ApiOkResponse({
    type: CodExceptionPageDto,
    description:
      'The reconciliation work queue: COD records stuck in `RECONCILIATION_EXCEPTION`, newest ' +
      "first, each row carrying the two figures that disagree — the frozen quote's " +
      '`expectedMinor` beside what the rider actually took. A negative `differenceMinor` is a ' +
      'shortfall: the server records the gap rather than overwriting the promise, and clearing ' +
      'this queue is what lets a settlement freeze proceed.',
  })
  async list(
    @Query() query: ListCodExceptionsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<CodExceptionPageDto> {
    return this.exceptions.execute(request.principal!.merchantId!, query.limit, query.cursor);
  }
}
