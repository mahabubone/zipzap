/**
 * POST /v1/shipments/:id/hold + /release — merchant pause/resume gestures.
 *
 * Same tenant gate as cancel/exception: a stranger's id 404s. Hold from a state
 * the machine refuses to park (e.g. IN_TRANSIT) is a 409 INVALID_TRANSITION,
 * not an error: the parcel is moving and hold does not exist for it.
 */

import { Body, Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { HoldReleaseService } from './hold-release.service.ts';
import { HeldShipmentDto } from './shipment-response.dto.ts';

export class HoldDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

@ApiTags('shipments')
@Controller('v1/shipments')
@UseGuards(ApiKeyGuard)
export class HoldReleaseController {
  constructor(
    @InjectDataSource('shipment') private readonly shipments: DataSource,
    @Inject(HoldReleaseService) private readonly holdRelease: HoldReleaseService,
  ) {}

  private async assertOwned(id: string, request: AuthenticatedRequest): Promise<void> {
    const merchantId = request.principal!.merchantId!;
    const rows = await this.shipments.query(
      `SELECT id FROM shipment.shipments WHERE id = $1 AND merchant_id = $2`,
      [id, merchantId],
    );
    if (!rows[0]) throw new ResourceNotFoundError('Shipment not found.');
  }

  @ApiErrors()
  @Post(':id/hold')
  @UseGuards(new ScopeGuard('shipments:write'), new RateLimitGuard('merchant', true))
  @ApiOperation({ summary: 'Put one of your shipments on hold (pauses movement)' })
  @ApiParam({
    name: 'id',
    description:
      "The shipment id. It must be one of yours — a stranger's id 404s rather than 403s, so the " +
      '404 never confirms the parcel exists.',
  })
  @ApiBody({
    type: HoldDto,
    description:
      'Optional one-sentence reason, recorded on the tracking event. A hold without one is still ' +
      'honoured, just unexplained.',
  })
  @ApiOkResponse({
    type: HeldShipmentDto,
    description:
      'The shipment is now ON_HOLD, and `status` says so. Only states that can be interrupted accept a ' +
      'hold — a parcel still in line-haul is physically moving and gets 409 INVALID_TRANSITION instead ' +
      'of a parkable state it does not have.',
  })
  async hold(
    @Param('id') id: string,
    @Body() body: HoldDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<HeldShipmentDto> {
    await this.assertOwned(id, request);
    return this.holdRelease.hold({
      shipmentId: id,
      reason: body.reason ?? null,
      actorId: request.principal?.subjectId ?? null,
    });
  }

  @ApiErrors()
  @Post(':id/release')
  @UseGuards(new ScopeGuard('shipments:write'), new RateLimitGuard('merchant', true))
  @ApiOperation({ summary: 'Release a held shipment back to its interrupted state' })
  @ApiParam({
    name: 'id',
    description:
      "The shipment id. It must be one of yours — a stranger's id 404s rather than 403s, so the " +
      '404 never confirms the parcel exists.',
  })
  @ApiOkResponse({
    type: HeldShipmentDto,
    description:
      'The shipment is moving again, and `status` is the state it was interrupted from — not ON_HOLD. ' +
      'Releasing a parcel that was never held is a 409, because there is no recorded state to resume.',
  })
  async release(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<HeldShipmentDto> {
    await this.assertOwned(id, request);
    return this.holdRelease.release({
      shipmentId: id,
      actorId: request.principal?.subjectId ?? null,
    });
  }
}
