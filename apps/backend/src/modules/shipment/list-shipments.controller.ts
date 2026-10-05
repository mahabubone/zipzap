/**
 * GET /v1/shipments — the merchant's own list, cursor-paginated.
 *
 * Guarded by shipments:read. Merchant scope comes from the credential, never
 * from a query param — a stranger's cursor only repositions within your own
 * list. Thin by design: parse query, call one use case, return.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { ListShipmentsService, type ShipmentPage } from './list-shipments.service.ts';

export class ListShipmentsQuery {
  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('shipments')
@Controller('v1/shipments')
@UseGuards(ApiKeyGuard)
export class ListShipmentsController {
  constructor(@Inject(ListShipmentsService) private readonly list: ListShipmentsService) {}

  @Get()
  @UseGuards(new ScopeGuard('shipments:read'))
  @ApiOperation({ summary: 'List your shipments, newest first' })
  async listShipments(
    @Query() query: ListShipmentsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<ShipmentPage> {
    return this.list.execute(request.principal!.merchantId!, query.limit, query.cursor);
  }
}
