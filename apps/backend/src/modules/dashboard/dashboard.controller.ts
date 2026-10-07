/**
 * GET /v1/control-tower/live-counts — the control tower's live snapshot: every number is a
 * single-schema read from one domain module, aggregated inside a transaction so the snapshot
 * describes one instant. Read-only, API-key guarded.
 */

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { DashboardService, type LiveCounts } from './dashboard.service.ts';

/** Money crosses the wire as a decimal string, never a JSON number — a bigint
 *  poisha amount above 2^53 would silently lose precision as a float. */
type LiveCountsJson = Omit<LiveCounts, 'cod'> & {
  readonly cod: Omit<LiveCounts['cod'], 'outstandingAmountMinor'> & {
    readonly outstandingAmountMinor: string;
  };
};

@ApiTags('control-tower')
@Controller('v1/control-tower')
@UseGuards(ApiKeyGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('live-counts')
  @ApiOperation({ summary: 'Live network counts, one snapshot in time' })
  async getLiveCounts(): Promise<LiveCountsJson> {
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
