/**
 * POST /v1/hubs/scans — record a hub scan (INBOUND, SORT, OUTBOUND, DEPARTED, ARRIVED).
 *
 * Thin by design: validate → one service call → return. The service runs the real state
 * machine, appends the tracking event, and writes the outbox row in one transaction. Wrong
 * order is the machine's 409; unknown scan kind is a 400 from the service. No
 * Idempotency-Key: the machine's state ordering is the dedupe.
 *
 * Guarded on `hub:scan`, which this controller predicted and the hub console then justified.
 * It was on `shipments:write` before, with a note saying not to invent a scope until a dedicated
 * warehouse principal existed. That principal is a HUB_OPERATOR, so the scope exists — and the
 * scan now needs nothing a merchant does. `shipments:write` would have let a hub employee create
 * and cancel shipments, which is a merchant's power.
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
  @UseGuards(new ScopeGuard('hub:scan'), new RateLimitGuard('merchant', true))
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
