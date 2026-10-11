import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBody,
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
  /** Show only manifests in this state — one of the five the machine knows. Omit for every manifest; an unrecognised value matches nothing rather than everything, so a typo reads as an empty work list the operator notices. */
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
  @ApiOkResponse({
    type: ManifestListDto,
    description:
      'The manifest work list, newest first — `created_at` then `id` descending, because a ' +
      'timestamp alone is not unique and a console that skips a row loses cargo. Not ' +
      'cursor-paginated: the newest-first tail is the working set.',
  })
  @ApiErrors()
  list(@Query() query: ListManifestsQuery): Promise<ManifestListDto> {
    return this.manifests.list(query.status ?? null).then((data) => ({ data }));
  }

  @Get(':id')
  @UseGuards(new ScopeGuard('hub:read'))
  @ApiOperation({ summary: 'One manifest and the parcels on it' })
  @ApiParam({ name: 'id', description: 'The manifest to read, with its cargo list.' })
  @ApiOkResponse({
    type: ManifestDetailDto,
    description:
      'The manifest, its cargo list in load order, and per parcel whether the destination hub ' +
      'has scanned it in. `missingCount` is 0 before RECEIVED because nobody has looked yet — ' +
      '"not checked" and "nothing missing" must not render as the same number.',
  })
  @ApiErrors()
  async one(@Param('id') id: string): Promise<ManifestDetailDto> {
    return this.manifests.detail(id);
  }

  @Post()
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({ summary: 'Schedule a trip, or create a DRAFT manifest on an existing one' })
  @ApiCreatedResponse({
    type: ManifestViewDto,
    description:
      'The new DRAFT manifest, with its dock-facing code. It only ever moves through the ' +
      'validated transitions from here — nothing updates `status` directly.',
  })
  @ApiBody({
    type: CreateManifestDto,
    description:
      'The trip this cargo travels on and the shipment ids riding it. At least one shipment, ' +
      'none repeated, and a trip that exists.',
  })
  @ApiErrors()
  create(@Body() body: CreateManifestDto): Promise<ManifestViewDto> {
    return this.manifests.createManifest(body.tripId, body.shipmentIds);
  }

  @Post('trips')
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({ summary: 'Schedule one run of a seeded route' })
  @ApiCreatedResponse({
    type: ScheduledTripDto,
    description:
      'The scheduled trip and the route it runs — one actual movement, carrying the trip id a ' +
      'manifest is then created against. An unknown route code is a 404.',
  })
  @ApiBody({ description: 'The code of the seeded route to run once more.', type: TripDto })
  @ApiErrors()
  scheduleTrip(@Body() body: TripDto): Promise<ScheduledTripDto> {
    return this.manifests.scheduleTrip(body.routeCode);
  }

  @Post(':id/seal')
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({ summary: 'DRAFT → SEALED. A sealed manifest is evidence of what left.' })
  @ApiParam({ name: 'id', description: 'The DRAFT manifest to seal.' })
  @ApiCreatedResponse({
    type: ManifestViewDto,
    description:
      'The manifest in SEALED: the cargo list is now evidence of what left the dock. Only a ' +
      'DRAFT can be sealed — any other state is a 409 naming both.',
  })
  @ApiErrors()
  seal(@Param('id') id: string): Promise<ManifestViewDto> {
    return this.manifests.seal(id);
  }

  @Post(':id/dispatch')
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({ summary: 'SEALED → DISPATCHED' })
  @ApiParam({ name: 'id', description: 'The SEALED manifest to dispatch.' })
  @ApiCreatedResponse({
    type: ManifestViewDto,
    description:
      'The manifest in DISPATCHED. Only a SEALED manifest can be dispatched; any other state ' +
      'is a 409 naming both.',
  })
  @ApiErrors()
  dispatch(@Param('id') id: string): Promise<ManifestViewDto> {
    return this.manifests.dispatch(id);
  }

  @Post(':id/receive')
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({ summary: 'DISPATCHED → RECEIVED' })
  @ApiParam({ name: 'id', description: 'The DISPATCHED manifest to receive.' })
  @ApiCreatedResponse({
    type: ManifestViewDto,
    description:
      'The manifest in RECEIVED. Only a DISPATCHED manifest can be received; any other state ' +
      'is a 409 naming both.',
  })
  @ApiErrors()
  receive(@Param('id') id: string): Promise<ManifestViewDto> {
    return this.manifests.receive(id);
  }

  @Post(':id/reconcile')
  @UseGuards(new ScopeGuard('hub:scan'))
  @ApiOperation({
    summary: 'RECEIVED → RECONCILED, refused while any parcel has not arrived',
  })
  @ApiParam({ name: 'id', description: 'The RECEIVED manifest to reconcile.' })
  @ApiCreatedResponse({
    type: ManifestViewDto,
    description:
      'The manifest in RECONCILED — every cargo item confirmed arrived. If any shipment has ' +
      'not arrived the call fails with 422 MANIFEST_INCOMPLETE naming them and the manifest ' +
      'stays RECEIVED, visibly un-reconciled, until the parcel shows up.',
  })
  @ApiErrors()
  reconcile(@Param('id') id: string): Promise<ManifestViewDto> {
    return this.manifests.reconcile(id);
  }
}
