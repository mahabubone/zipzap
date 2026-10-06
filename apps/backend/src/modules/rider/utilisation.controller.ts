/**
 * GET /v1/riders/:riderId/utilisation — load factor for one rider.
 * GET /v1/riders/pool-utilisation — pool-wide utilisation (Phase 5 rung 5).
 *
 * Read-only KPI surface. This is the contract the control tower (Phase 6) consumes; nothing
 * here mutates state or makes a dispatch decision.
 */

import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { UtilisationService } from './utilisation.service.ts';
import type { PoolUtilisation } from './utilisation.service.ts';

@ApiTags('riders')
@Controller('v1/riders')
@UseGuards(ApiKeyGuard)
export class UtilisationController {
  constructor(@Inject(UtilisationService) private readonly util: UtilisationService) {}

  @Get(':riderId/utilisation')
  @ApiOperation({ summary: "Rider's current load factor" })
  async riderUtilisation(@Param('riderId') riderId: string) {
    const load = await this.util.getRiderLoad(riderId);
    return load ?? null;
  }

  @Get('pool-utilisation')
  @ApiOperation({ summary: 'Pool-wide rider utilisation KPI' })
  async poolUtilisation(): Promise<PoolUtilisation> {
    return this.util.getPoolLoad();
  }
}
