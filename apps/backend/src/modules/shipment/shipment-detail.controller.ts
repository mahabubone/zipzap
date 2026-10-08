/**
 * GET /v1/shipments/:id + POST /v1/shipments/:id/cancel — one parcel, own merchant only.
 *
 * Both read through the same tenant gate: a stranger's id 404s (a 403 would confirm
 * the shipment exists — an enumeration oracle). Cancel follows the
 * AdvanceDeliveryService shape: lock, assert, save, emit — and the machine rejects
 * cancelling a DELIVERED parcel, because that is a return, not a cancel.
 *
 * The GET response carries four contact fields, so the read is audited. The audit happens inside
 * GetShipmentService rather than here: a controller that logs what it read is a controller that
 * can forget to.
 */

import { Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { CancelShipmentService, type CancelledShipment } from './cancel-shipment.service.ts';
import { GetShipmentService, type ShipmentDetail } from './get-shipment.service.ts';

@ApiTags('shipments')
@Controller('v1/shipments')
@UseGuards(ApiKeyGuard)
export class ShipmentDetailController {
  constructor(
    @Inject(GetShipmentService) private readonly get: GetShipmentService,
    @Inject(CancelShipmentService) private readonly cancel: CancelShipmentService,
  ) {}

  @Get(':id')
  @UseGuards(new ScopeGuard('shipments:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'Get one of your shipments' })
  async detail(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest & { requestId?: string },
  ): Promise<ShipmentDetail> {
    const principal = req.principal!;
    return this.get.execute(principal.merchantId!, id, {
      actorType: principal.kind,
      actorId: principal.credentialId,
      ip: req.ip ?? null,
      requestId: req.requestId ?? null,
    });
  }

  @Post(':id/cancel')
  @UseGuards(new ScopeGuard('shipments:write'), new RateLimitGuard('merchant', true))
  @ApiOperation({ summary: 'Cancel a shipment that has not shipped yet' })
  async cancelShipment(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CancelledShipment> {
    return this.cancel.execute(request.principal!.merchantId!, id);
  }
}
