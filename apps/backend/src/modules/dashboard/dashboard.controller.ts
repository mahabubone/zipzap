/**
 * GET /v1/control-tower/live-counts — the control tower's live snapshot: every number is a
 * single-schema read from one domain module, aggregated inside a transaction so the snapshot
 * describes one instant. Read-only, API-key guarded.
 */

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { DashboardService, type LiveCounts } from './dashboard.service.ts';

@ApiTags('control-tower')
@Controller('v1/control-tower')
@UseGuards(ApiKeyGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('live-counts')
  @ApiOperation({ summary: 'Live network counts, one snapshot in time' })
  async getLiveCounts(): Promise<LiveCounts> {
    return this.dashboard.getLiveCounts();
  }
}
