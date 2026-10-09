/**
 * GET /v1/coverage?zone=... — serviceability for one zone, before a shipment is created.
 *
 * Thin by design: no writes, no idempotency header. Absence of a coverage row is
 * `serviceable: false`, never a default-allow.
 */

import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { NetworkService, type CoverageCheck } from './network.service.ts';

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
  async coverage(@Query() query: CoverageQuery): Promise<CoverageCheck> {
    return this.network.checkZone(query.zone);
  }

  @Get('zones')
  @ApiOperation({ summary: 'Every zone you can ship to' })
  async zones(): Promise<{ zones: string[] }> {
    return { zones: await this.network.listServiceableZones() };
  }
}
