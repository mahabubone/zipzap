/**
 * GET /v1/shipments — the merchant's own list, cursor-paginated and filterable.
 *
 * Guarded by shipments:read. Merchant scope comes from the credential, never
 * from a query param — a stranger's cursor only repositions within your own
 * list, and a stranger's filter narrows it further rather than widening it.
 * Thin by design: parse query, call one use case, return.
 *
 * The filter fields are declared as bare strings on purpose. `status` is an
 * enum, `from`/`to` are Dhaka calendar days and `q` is free text, so
 * class-validator's type decorators would each assert something weaker than the
 * real rule; `parseShipmentFilters` is the single place that decides what is
 * valid and names what is not.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ListShipmentsService } from './list-shipments.service.ts';
import { ShipmentPageDto } from './shipment-response.dto.ts';

export class ListShipmentsQuery {
  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  /** A shipment status, or several — `?status=CREATED,IN_TRANSIT`. */
  @IsOptional()
  @IsString()
  status?: string;

  /** The zone a parcel was priced against, e.g. `dhaka-metro`. */
  @IsOptional()
  @IsString()
  zone?: string;

  /** Tracking code or phone, partial. */
  @IsOptional()
  @IsString()
  q?: string;

  /** `yyyy-mm-dd`, Asia/Dhaka, inclusive. */
  @IsOptional()
  @IsString()
  from?: string;

  /** `yyyy-mm-dd`, Asia/Dhaka, inclusive of the whole day. */
  @IsOptional()
  @IsString()
  to?: string;
}

@ApiTags('shipments')
@Controller('v1/shipments')
@UseGuards(ApiKeyGuard)
export class ListShipmentsController {
  constructor(@Inject(ListShipmentsService) private readonly list: ListShipmentsService) {}

  @Get()
  @UseGuards(new ScopeGuard('shipments:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'List your shipments, newest first' })
  @ApiOkResponse({ type: ShipmentPageDto })
  async listShipments(
    @Query() query: ListShipmentsQuery,
    @Req() request: AuthenticatedRequest,
  ): Promise<ShipmentPageDto> {
    return this.list.execute(request.principal!.merchantId!, query.limit, query.cursor, {
      status: query.status,
      zone: query.zone,
      q: query.q,
      from: query.from,
      to: query.to,
    });
  }
}
