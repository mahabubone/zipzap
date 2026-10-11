/**
 * POST /v1/pickups — thin by design: validate, call one use case, return.
 *
 * Controllers never build an error response (the exception filter does that) and never touch a
 * repository (the use case owns the transaction). The only logic here is DTO validation, which is
 * a trust-boundary concern and belongs at the edge.
 */

import { Body, Controller, Headers, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsPositive, IsUUID } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RequestPickupService } from './request-pickup.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { MAX_BATCH_PARCELS } from './rules/pickup.ts';
import { RequestedPickupDto } from './pickup-response.dto.ts';

export class RequestPickupDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_PARCELS)
  @IsUUID('4', { each: true })
  shipmentIds!: string[];

  @IsInt()
  @IsPositive()
  totalWeightGrams!: number;
}

@ApiTags('pickups')
@Controller('v1/pickups')
@UseGuards(ApiKeyGuard)
export class RequestPickupController {
  constructor(@Inject(RequestPickupService) private readonly requestPickup: RequestPickupService) {}

  @Post()
  @UseGuards(new ScopeGuard('pickup:create'))
  @ApiOperation({ summary: 'Request a pickup' })
  @ApiBody({
    type: RequestPickupDto,
    description:
      'The batch of shipment ids to collect (1 to 50) and the declared batch weight in grams. ' +
      'The merchant is taken from the credential, never from the body.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required retry guard. Reuse with the same body replays this pickup; reuse with a different ' +
      'body is a 400, so a retried request never dispatches a second rider.',
  })
  @ApiCreatedResponse({
    type: RequestedPickupDto,
    description:
      'The pickup as born: its id, REQUESTED status, the full member-shipment batch, and createdAt. ' +
      'Every shipment is advanced to PICKUP_REQUESTED in the same transaction, but no rider is ' +
      'attached — that is the separate assign call.',
  })
  @ApiErrors()
  async create(
    @Body() body: RequestPickupDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequestedPickupDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      // Mandatory on this operation: a retried pickup request would dispatch a second rider.
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }

    const principal = request.principal!;
    const { result, replayed } = await this.requestPickup.execute({
      // merchantId comes from the credential, never from the body.
      merchantId: principal.merchantId!,
      idempotencyKey: idempotencyKey.trim(),
      actorId: null,
      shipmentIds: body.shipmentIds,
      totalWeightGrams: body.totalWeightGrams,
    });

    return { ...result, replayed };
  }
}
