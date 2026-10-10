/**
 * GET /v1/control-tower/live-counts — the control tower's live snapshot: every number is a
 * single-schema read from one domain module, aggregated inside a transaction so the snapshot
 * describes one instant. Read-only, API-key guarded.
 *
 * These numbers are the whole network's, so the endpoint also names a scope. `ApiKeyGuard`
 * authenticates and nothing more; without `network:read` a merchant key read every merchant's
 * counts and outstanding COD. A merchant reads their own from `/v1/analytics/merchant`.
 */

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { DashboardService } from './dashboard.service.ts';
import { LiveCountsDto } from './dashboard-response.dto.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';

@ApiTags('control-tower')
@Controller('v1/control-tower')
@UseGuards(ApiKeyGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('live-counts')
  @UseGuards(new ScopeGuard('network:read'))
  @ApiOperation({ summary: 'Live network counts, one snapshot in time' })
  @ApiOkResponse({ type: LiveCountsDto })
  @ApiErrors()
  async getLiveCounts(): Promise<LiveCountsDto> {
    const counts = await this.dashboard.getLiveCounts();
    return {
      ...counts,
      cod: {
        ...counts.cod,
        // bigint throws in JSON.stringify — serialise it here, once, at the edge.
        outstandingAmountMinor: counts.cod.outstandingAmountMinor.toString(),
      },
    };
  }
}
