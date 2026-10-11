/**
 * GET /v1/coverage?zone=... — serviceability for one zone, before a shipment is created.
 *
 * Thin by design: no writes, no idempotency header. Absence of a coverage row is
 * `serviceable: false`, never a default-allow.
 */

import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { CoverageCheckDto, ServiceableZonesDto } from './network-response.dto.ts';
import { NetworkService } from './network.service.ts';

export class CoverageQuery {
  /** The zone code to ask about, e.g. `dhaka-metro`. Unknown codes are answered `false`, not 404. */
  @IsString()
  zone!: string;
}

@ApiTags('coverage')
@Controller('v1')
@UseGuards(ApiKeyGuard)
export class CoverageController {
  constructor(@Inject(NetworkService) private readonly network: NetworkService) {}

  @Get('coverage')
  @ApiOperation({ summary: 'Serviceability check for one zone' })
  @ApiOkResponse({
    type: CoverageCheckDto,
    description:
      'Whether this zone can be shipped to, and how: `serviceable` false with a human `reason` when it ' +
      'cannot, plus the estimated days and whether pickup, delivery and COD are available when it can. ' +
      'A zone with no coverage row answers false — absence is never a default allow.',
  })
  @ApiErrors()
  async coverage(@Query() query: CoverageQuery): Promise<CoverageCheckDto> {
    return this.network.checkZone(query.zone);
  }

  @Get('zones')
  @ApiOperation({ summary: 'Every zone you can ship to' })
  @ApiOkResponse({
    type: ServiceableZonesDto,
    description:
      'Every serviceable zone the network is currently configured with, sorted, for a picker. Read ' +
      'this list rather than hardcoding one: a retired or newly added zone is configuration here.',
  })
  @ApiErrors()
  async zones(): Promise<ServiceableZonesDto> {
    return { zones: await this.network.listServiceableZones() };
  }
}
