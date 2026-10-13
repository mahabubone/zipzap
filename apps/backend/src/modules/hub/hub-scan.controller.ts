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
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { HubScanService } from './hub-scan.service.ts';
import { HubScanResultDto } from './hub-response.dto.ts';
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
  @ApiCreatedResponse({
    type: HubScanResultDto,
    description:
      'The scan as recorded and the shipment status it moved to. The state machine, the tracking ' +
      'event and the outbox row ran in one transaction — a wrong-order scan is a 409 naming both ' +
      'states, an unknown scan kind a 400. DEPARTED deliberately writes no timeline event; ' +
      'DISPATCHED already told the customer.',
  })
  @ApiBody({
    type: HubScanDto,
    description:
      'The gesture and what it is about: the shipment, one of INBOUND, SORT, OUTBOUND, DEPARTED ' +
      'or ARRIVED, and optionally the hub performing it — a hub that is named must exist, and a ' +
      'scan with no hub leaves the parcel at no hub rather than inventing one.',
  })
  @ApiErrors()
  async scan(
    @Body() body: HubScanDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<HubScanResultDto> {
    return this.hubScan.execute({
      shipmentId: body.shipmentId,
      scan: body.scan,
      hubCode: body.hubCode ?? null,
      actorId: request.principal?.subjectId ?? null,
    });
  }
}
