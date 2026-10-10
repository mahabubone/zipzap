/**
 * GET /v1/riders/:riderId/utilisation — load factor for one rider.
 * GET /v1/riders/pool-utilisation — pool-wide utilisation (Phase 5 rung 5).
 *
 * Read-only KPI surface. This is the contract the control tower (Phase 6) consumes; nothing
 * here mutates state or makes a dispatch decision.
 */

import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { UtilisationService } from './utilisation.service.ts';
import { PoolUtilisationDto, RiderLoadDto } from './rider-response.dto.ts';

@ApiTags('riders')
@Controller('v1/riders')
@UseGuards(ApiKeyGuard)
export class UtilisationController {
  constructor(@Inject(UtilisationService) private readonly util: UtilisationService) {}

  @Get(':riderId/utilisation')
  @ApiOperation({ summary: "Rider's current load factor" })
  @ApiParam({ name: 'riderId', description: 'The rider whose current load factor is read.' })
  @ApiOkResponse({ type: RiderLoadDto, nullable: true })
  @ApiErrors()
  async riderUtilisation(@Param('riderId') riderId: string): Promise<RiderLoadDto | null> {
    const load = await this.util.getRiderLoad(riderId);
    return load ?? null;
  }

  @Get('pool-utilisation')
  @ApiOperation({ summary: 'Pool-wide rider utilisation KPI' })
  @ApiOkResponse({ type: PoolUtilisationDto })
  @ApiErrors()
  async poolUtilisation(): Promise<PoolUtilisationDto> {
    return this.util.getPoolLoad();
  }
}
