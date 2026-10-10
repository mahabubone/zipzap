import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import {
  ManifestDetailDto,
  ManifestListDto,
  ManifestViewDto,
  ScheduledTripDto,
} from './network-response.dto.ts';
import { ManifestService } from './manifest.service.ts';

export class CreateManifestDto {
  @IsUUID('4')
  tripId!: string;

  @IsArray()
  shipmentIds!: string[];
}

export class ListManifestsQuery {
  @IsOptional()
  @IsString()
  status?: string;
}

export class TripDto {
  @IsString()
  routeCode!: string;
}

/**
 * The manifest lifecycle over HTTP.
 *
 * `ManifestService` has been complete and proven since Phase 5 — five validated transitions, an
 * outbox row per edge, and a reconciliation that refuses while a parcel is missing. It had no
 * controller at all, so a hub console could not seal a manifest and the service was reachable only
 * from tests and `simulate.ts`. This is the missing edge, not new behaviour.
 *
 * Four separate endpoints rather than one with a `status` in the body. The whole point of the
 * machine is that the current state decides what is legal, and a body that names the destination
 * state lets a caller express "reconcile" for a manifest they believe is ready — with the answer
 * coming back as a 409 naming both states. The URL states the intent; the service still validates.
 */
@ApiTags('manifests')
@Controller('v1/manifests')
@UseGuards(ApiKeyGuard)
export class ManifestController {
  constructor(@Inject(ManifestService) private readonly manifests: ManifestService) {}

  @Get()
  @UseGuards(new ScopeGuard('hub:read'))
  @ApiOperation({ summary: 'Manifests, newest first, optionally by status' })
  @ApiOkResponse({ type: ManifestListDto })
  @ApiErrors()
  list(@Query() query: ListManifestsQuery): Promise<ManifestListDto> {
    return this.manifests.list(query.status ?? null).then((data) => ({ data }));
  }

  @Get(':id')
  @UseGuards(new ScopeGuard('hub:read'))
  @ApiOperation({ summary: 'One manifest and the parcels on it' })
  @ApiParam({ name: 'id', description: 'Manifest id' })
  @ApiOkResponse({ type: ManifestDetailDto })
  @ApiErrors()
  async one(@Param('id') id: string): Promise<ManifestDetailDto> {
    return this.manifests.detail(id);
  }

  @Post()
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({ summary: 'Schedule a trip, or create a DRAFT manifest on an existing one' })
  @ApiCreatedResponse({ type: ManifestViewDto })
  @ApiErrors()
  create(@Body() body: CreateManifestDto): Promise<ManifestViewDto> {
    return this.manifests.createManifest(body.tripId, body.shipmentIds);
  }

  @Post('trips')
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({ summary: 'Schedule one run of a seeded route' })
  @ApiCreatedResponse({ type: ScheduledTripDto })
  @ApiErrors()
  scheduleTrip(@Body() body: TripDto): Promise<ScheduledTripDto> {
    return this.manifests.scheduleTrip(body.routeCode);
  }

  @Post(':id/seal')
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({ summary: 'DRAFT → SEALED. A sealed manifest is evidence of what left.' })
  @ApiParam({ name: 'id', description: 'Manifest id' })
  @ApiCreatedResponse({ type: ManifestViewDto })
  @ApiErrors()
  seal(@Param('id') id: string): Promise<ManifestViewDto> {
    return this.manifests.seal(id);
  }

  @Post(':id/dispatch')
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({ summary: 'SEALED → DISPATCHED' })
  @ApiParam({ name: 'id', description: 'Manifest id' })
  @ApiCreatedResponse({ type: ManifestViewDto })
  @ApiErrors()
  dispatch(@Param('id') id: string): Promise<ManifestViewDto> {
    return this.manifests.dispatch(id);
  }

  @Post(':id/receive')
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({ summary: 'DISPATCHED → RECEIVED' })
  @ApiParam({ name: 'id', description: 'Manifest id' })
  @ApiCreatedResponse({ type: ManifestViewDto })
  @ApiErrors()
  receive(@Param('id') id: string): Promise<ManifestViewDto> {
    return this.manifests.receive(id);
  }

  @Post(':id/reconcile')
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({
    summary: 'RECEIVED → RECONCILED, refused while any parcel has not arrived',
  })
  @ApiParam({ name: 'id', description: 'Manifest id' })
  @ApiCreatedResponse({ type: ManifestViewDto })
  @ApiErrors()
  reconcile(@Param('id') id: string): Promise<ManifestViewDto> {
    return this.manifests.reconcile(id);
  }
}
