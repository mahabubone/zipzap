/**
 * GET /v1/shipments/counts — your own shipments, one number per status.
 *
 * The console's landing screen needs four numbers and has no way to get them: the list endpoint is
 * paginated, so "count the page" is wrong the moment a merchant has more parcels than fit on it, and
 * the control tower's `live-counts` is `network:read` — deliberately, because it is every tenant's
 * picture at once. So that screen was answered 403 and fell back to an error box on the one page a
 * merchant opens first.
 *
 * This is the smallest thing that fixes it: one aggregate over one table, filtered to the caller's
 * own merchant, in the shipment module that owns the table. No cross-schema read, no new scope, no
 * projection to keep current — it is a `GROUP BY` on the same rows the list endpoint returns.
 */

import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { SHIPMENT_STATUSES } from './rules/state-machine.ts';

export class ShipmentCountsDto {
  @ApiProperty({
    description:
      'Your shipments per status. Every status in the machine is present, at zero when it has none, ' +
      'so a caller never has to know that an absent key means "none".',
    example: { CREATED: 2, IN_TRANSIT: 1, DELIVERED: 3 },
    additionalProperties: { type: 'number' },
  })
  readonly byStatus!: Record<string, number>;

  @ApiProperty({ description: 'Every shipment you own, in any status.', example: 6 })
  readonly total!: number;

  @ApiProperty({
    description:
      'Shipments you created today, Asia/Dhaka calendar day. Counted in the same statement ' +
      'as the rest, so the two cannot disagree.',
    example: 2,
  })
  readonly todayNew!: number;

  @ApiProperty({
    description: 'Snapshot instant, UTC ISO 8601.',
    example: '2026-10-13T04:20:00.000Z',
  })
  readonly timestamp!: string;
}

@ApiTags('shipments')
@Controller('v1/shipments/counts')
@UseGuards(ApiKeyGuard)
export class ShipmentCountsController {
  constructor(
    @InjectDataSource('shipment') private readonly shipmentDs: DataSource,
    @Inject(ShipmentRepository) private readonly shipments: ShipmentRepository,
  ) {}

  @ApiErrors()
  @Get()
  @UseGuards(new ScopeGuard('shipments:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'Count your shipments by status' })
  @ApiOkResponse({
    type: ShipmentCountsDto,
    description:
      'The status breakdown of your own shipments, complete — every status in the machine is ' +
      "present, at zero when you have none. This is the console landing screen's data source; it " +
      "exists because the paginated list cannot be counted and the control tower's live-counts is " +
      "the whole network's, not yours.",
  })
  async counts(@Req() request: AuthenticatedRequest): Promise<ShipmentCountsDto> {
    // The merchant id comes from the credential and nowhere else. A query param here would be a way
    // to count somebody else\'s parcels, which is the exact bug the list endpoint documents refusing
    // to allow.
    const { byStatus, total, todayNew } = await this.shipmentDs.transaction((manager) =>
      this.shipments.merchantCounts(manager, request.principal!.merchantId!),
    );

    const complete: Record<string, number> = {};
    for (const status of SHIPMENT_STATUSES) complete[status] = byStatus.get(status) ?? 0;

    return { byStatus: complete, total, todayNew, timestamp: new Date().toISOString() };
  }
}
