/**
 * GET /v1/cod/exceptions — the reconciliation work queue. Thin by design.
 *
 * Scoped `cod:read`, the same scope as the record list: seeing that a collection is disputed is not
 * more sensitive than seeing that it was collected. Merchant scope comes from the credential, never
 * from a query param, so a stranger's cursor only repositions within their own queue.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ListCodExceptionsService, type CodExceptionPage } from './list-cod-exceptions.service.ts';

export class ListCodExceptionsQuery {
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
export class ListCodExceptionsController {
  constructor(
    @Inject(ListCodExceptionsService) private readonly exceptions: ListCodExceptionsService,
  ) {}

  @Get('exceptions')
  @UseGuards(new ScopeGuard('cod:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'Unreviewed COD reconciliation exceptions, newest first' })
  async list(
    @Query() query: ListCodExceptionsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<CodExceptionPage> {
    return this.exceptions.execute(request.principal!.merchantId!, query.limit, query.cursor);
  }
}
