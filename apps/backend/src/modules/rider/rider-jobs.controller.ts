/**
 * GET /v1/riders/:riderId/jobs — one rider's pickups and delivery jobs.
 *
 * The rider app's home feed. Read-only aggregate, same shape as the dashboard's
 * live counts: each read is a single-schema query through the owning module's
 * DataSource; nothing joins across schemas. The rider app sorts and merges
 * client-side — this endpoint hands it the two ordered lists.
 */

import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { PickupRepository } from '../pickup/pickup.repository.ts';
import { DeliveryRepository } from '../delivery/delivery.repository.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

@ApiTags('riders')
@Controller('v1/riders')
@UseGuards(ApiKeyGuard)
export class RiderJobsController {
  constructor(
    @Inject(PickupRepository) private readonly pickups: PickupRepository,
    @Inject(DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @InjectDataSource('pickup') private readonly pickupDs: DataSource,
    @InjectDataSource('delivery') private readonly deliveryDs: DataSource,
  ) {}

  @Get(':riderId/jobs')
  @ApiOperation({ summary: "A rider's pickup and delivery jobs, newest first" })
  async jobs(@Param('riderId') riderId: string, @Query('limit') limit?: string) {
    const take = parseLimit(limit);
    const [pickups, deliveries] = await Promise.all([
      this.pickups.listByRider(this.pickupDs.manager, riderId, take),
      this.deliveries.listByRider(this.deliveryDs.manager, riderId, take),
    ]);
    return { pickups, deliveries };
  }
}
