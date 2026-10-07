/**
 * POST /v1/hubs/scans — record a hub scan (INBOUND, SORT, OUTBOUND, DEPARTED, ARRIVED).
 *
 * Thin by design: validate → one service call → return. The service runs the real state
 * machine, appends the tracking event, and writes the outbox row in one transaction. Wrong
 * order is the machine's 409; unknown scan kind is a 400 from the service. No
 * Idempotency-Key: the machine's state ordering is the dedupe.
 *
 * Scope reuse (ponytail): 'shipments:write' gates scans today because hub has no scope of
 * its own. Upgrade path: add a first-class 'hub:scan' scope when a dedicated warehouse
 * credential type exists — don't invent it until that principal does.
 */

import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { HubScanService, type HubScanResult } from './hub-scan.service.ts';
import { HUB_SCAN_ORDER } from './rules/scan.ts';

export class HubScanDto {
  @IsUUID('4')
  shipmentId!: string;

  @IsIn([...HUB_SCAN_ORDER])
  scan!: string;

  @IsOptional()
  @IsString()
  hubCode?: string | null;
}

@ApiTags('hubs')
@Controller('v1/hubs')
@UseGuards(ApiKeyGuard)
export class HubScanController {
  constructor(@Inject(HubScanService) private readonly hubScan: HubScanService) {}

  @Post('scans')
  @UseGuards(new ScopeGuard('shipments:write'), new RateLimitGuard('merchant', true))
  @ApiOperation({ summary: 'Record a hub scan for a shipment' })
  async scan(
    @Body() body: HubScanDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<HubScanResult> {
    return this.hubScan.execute({
      shipmentId: body.shipmentId,
      scan: body.scan,
      hubCode: body.hubCode ?? null,
      actorId: request.principal?.subjectId ?? null,
    });
  }
}
