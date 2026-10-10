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
  @ApiOkResponse({ type: CoverageCheckDto })
  @ApiErrors()
  async coverage(@Query() query: CoverageQuery): Promise<CoverageCheckDto> {
    return this.network.checkZone(query.zone);
  }

  @Get('zones')
  @ApiOperation({ summary: 'Every zone you can ship to' })
  @ApiOkResponse({ type: ServiceableZonesDto })
  @ApiErrors()
  async zones(): Promise<ServiceableZonesDto> {
    return { zones: await this.network.listServiceableZones() };
  }
}
