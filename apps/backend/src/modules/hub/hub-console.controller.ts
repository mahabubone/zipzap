import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { HubConsoleService } from './hub-console.service.ts';
import { HubParcelsViewDto, HubSummaryDto } from './hub-response.dto.ts';

export class HubParcelsQuery {
  /** Cap on the parcel list. Defaults to 100, newest scan first. */
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
  @ApiOkResponse({
    type: HubSummaryDto,
    isArray: true,
    description:
      'Every hub in the network, ordered by name, each with how many parcels are waiting there ' +
      'right now. An empty hub reads 0, not null — "nothing waiting" and "we could not find ' +
      'out" are different answers.',
  })
  @ApiErrors()
  list(): Promise<HubSummaryDto[]> {
    return this.console_.listHubs();
  }

  @Get(':hubCode/parcels')
  @UseGuards(new ScopeGuard('hub:read'))
  @ApiOperation({ summary: 'Parcels waiting at one hub, and the scan each needs next' })
  @ApiParam({
    name: 'hubCode',
    description: 'The code of the hub whose waiting parcels are listed.',
  })
  @ApiOkResponse({
    type: HubParcelsViewDto,
    description:
      'The hub, and the parcels waiting at it — most recently scanned first, each carrying the ' +
      'gesture it needs next, which is null once nothing further is required. An unknown hub ' +
      'code is a 404, not an empty list that reads as a quiet shift.',
  })
  @ApiErrors()
  async parcels(
    @Param('hubCode') hubCode: string,
    @Query() query: HubParcelsQuery,
  ): Promise<HubParcelsViewDto> {
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    return this.console_.parcelsAt(hubCode, Number.isFinite(limit) ? limit : undefined);
  }
}
