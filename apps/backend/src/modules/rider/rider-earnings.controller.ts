/**
 * GET /v1/riders/:riderId/earnings — server-truthful earnings projection.
 *
 * Derived from completed delivery count × base fee. Never stored, rebuilt on every read
 * so the figure is always current. Labelled with `asOf` so the rider app can detect stale
 * device-side cached figures.
 */

import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { RiderEarningsDto } from './rider-response.dto.ts';

/** Base delivery fee for a completed delivery, in integer minor units (poisha). */
const BASE_DELIVERY_FEE_MINOR = 50000; // ৳500
const CURRENCY = 'BDT';

@ApiTags('riders')
@Controller('v1/riders')
@UseGuards(ApiKeyGuard)
export class RiderEarningsController {
  constructor(@InjectDataSource('delivery') private readonly deliveryDs: DataSource) {}

  @Get(':riderId/earnings')
  @ApiOperation({ summary: "A rider's server-truthful earnings projection" })
  @ApiParam({
    name: 'riderId',
    description: 'The rider whose earnings are requested.',
  })
  @ApiOkResponse({
    type: RiderEarningsDto,
    description:
      'The rider\u2019s total earnings summed from completed deliveries, ' +
      'labelled with an `asOf` timestamp so the rider app can detect stale cached figures.',
  })
  @ApiErrors()
  async earnings(@Param('riderId') riderId: string): Promise<RiderEarningsDto> {
    const result = await this.deliveryDs.query<{ count: string }[]>(
      `
        SELECT COUNT(*) as count
        FROM "delivery"."jobs"
        WHERE "riderId" = $1 AND "status" = 'DELIVERED'
      `,
      [riderId],
    );

    const row = result[0];
    const completedDeliveries = row ? Number(row.count) : 0;
    const totalEarningsMinor = completedDeliveries * BASE_DELIVERY_FEE_MINOR;

    return {
      totalEarningsMinor,
      currency: CURRENCY,
      completedDeliveries,
      asOf: new Date(),
    };
  }
}
