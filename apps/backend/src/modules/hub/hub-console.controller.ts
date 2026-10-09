import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { HubConsoleService } from './hub-console.service.ts';
import type { HubSummary, ParcelPresence } from './hub.repository.ts';

export class HubParcelsQuery {
  @IsOptional()
  @IsString()
  limit?: string;
}

@ApiTags('hubs')
@Controller('v1/hubs')
@UseGuards(ApiKeyGuard)
export class HubConsoleController {
  constructor(@Inject(HubConsoleService) private readonly console_: HubConsoleService) {}

  @Get()
  @UseGuards(new ScopeGuard('hub:read'))
  @ApiOperation({ summary: 'Every hub and how many parcels are waiting at it' })
  list(): Promise<HubSummary[]> {
    return this.console_.listHubs();
  }

  @Get(':hubCode/parcels')
  @UseGuards(new ScopeGuard('hub:read'))
  @ApiOperation({ summary: 'Parcels waiting at one hub, and the scan each needs next' })
  async parcels(
    @Param('hubCode') hubCode: string,
    @Query() query: HubParcelsQuery,
  ): Promise<{ hub: HubSummary; parcels: ParcelPresence[] }> {
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    return this.console_.parcelsAt(hubCode, Number.isFinite(limit) ? limit : undefined);
  }
}
