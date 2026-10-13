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
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { CancelShipmentService } from './cancel-shipment.service.ts';
import { GetShipmentService } from './get-shipment.service.ts';
import { CancelledShipmentDto, ShipmentDetailDto } from './shipment-response.dto.ts';

@ApiTags('shipments')
@Controller('v1/shipments')
@UseGuards(ApiKeyGuard)
export class ShipmentDetailController {
  constructor(
    @Inject(GetShipmentService) private readonly get: GetShipmentService,
    @Inject(CancelShipmentService) private readonly cancel: CancelShipmentService,
  ) {}

  @ApiErrors()
  @Get(':id')
  @UseGuards(new ScopeGuard('shipments:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'Get one of your shipments' })
  @ApiParam({
    name: 'id',
    description:
      "The shipment id. It must be one of yours — a stranger's id 404s rather than 403s, so the " +
      '404 never confirms the parcel exists.',
  })
  @ApiOkResponse({
    type: ShipmentDetailDto,
    description:
      'The whole parcel record: both contacts, the parcel, the COD amount, and the tracking timeline ' +
      'oldest first. This is the only read that returns personal data, so it leaves an audit trail — ' +
      'the read is recorded whether or not the caller ever sees that row.',
  })
  async detail(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest & { requestId?: string },
  ): Promise<ShipmentDetailDto> {
    const principal = req.principal!;
    return this.get.execute(principal.merchantId!, id, {
      actorType: principal.kind,
      actorId: principal.credentialId,
      ip: req.ip ?? null,
      requestId: req.requestId ?? null,
    });
  }

  @ApiErrors()
  @Post(':id/cancel')
  @UseGuards(new ScopeGuard('shipments:write'), new RateLimitGuard('merchant', true))
  @ApiOperation({ summary: 'Cancel a shipment that has not shipped yet' })
  @ApiParam({
    name: 'id',
    description:
      "The shipment id. It must be one of yours — a stranger's id 404s rather than 403s, so the " +
      '404 never confirms the parcel exists.',
  })
  @ApiOkResponse({
    type: CancelledShipmentDto,
    description:
      'Confirms the parcel is CANCELLED. Only states that may still stop can be cancelled: a delivered ' +
      'parcel is a return, not a cancel, and the state machine refuses the edge with 409. A retried ' +
      'cancel hits the same 409 rather than applying twice.',
  })
  async cancelShipment(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CancelledShipmentDto> {
    return this.cancel.execute(request.principal!.merchantId!, id);
  }
}
