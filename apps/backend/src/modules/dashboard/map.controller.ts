/**
 * GET /v1/control-tower/map — the network, with coordinates.
 *
 * Guarded on `hub:read`, the platform scope. A merchant is our client and does not get to watch the
 * whole network's rider positions; the merchant console reads its own shipments instead.
 *
 * One read, deliberately. An ops map that needs four round trips shows a map that is never internally
 * consistent — three hubs from one second and four riders from another, which reads as "true" and is
 * not. The response carries `generatedAt` so a client can label its own staleness rather than
 * pretending the snapshot is now.
 */

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { MapService } from './map.service.ts';
import { NetworkMapDto } from './dashboard-response.dto.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';

@ApiTags('control-tower')
@Controller('v1/control-tower')
@UseGuards(ApiKeyGuard)
export class MapController {
  constructor(@Inject(MapService) private readonly map: MapService) {}

  @Get('map')
  @UseGuards(new ScopeGuard('hub:read'))
  @ApiOperation({
    summary:
      'Hubs and rider positions for the live map. Rider positions never reach public tracking.',
  })
  @ApiOkResponse({
    type: NetworkMapDto,
    description:
      'Hubs and rider positions for the map, each rider carrying `staleSeconds` so a dot from ' +
      'twenty minutes ago can be rendered as stale rather than believed. Parcels are never ' +
      'plotted, and riders with no ping yet are counted in `ridersWithoutPosition` instead of ' +
      'placed at (0,0) in the ocean. `generatedAt` lets the client label its own staleness.',
  })
  @ApiErrors()
  getMap(): Promise<NetworkMapDto> {
    return this.map.getMap();
  }
}
