/**
 * POST /v1/deliveries — thin by design: validate, call one use case, return.
 */

import { Body, Controller, Headers, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiBody, ApiCreatedResponse, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { CreateDeliveryService } from './create-delivery.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { CreatedDeliveryJobDto } from './delivery-response.dto.ts';

export class CreateDeliveryDto {
  @IsUUID('4')
  shipmentId!: string;

  @IsOptional()
  @IsUUID('4')
  riderId?: string;
}

@ApiTags('deliveries')
@Controller('v1/deliveries')
@UseGuards(ApiKeyGuard)
export class CreateDeliveryController {
  constructor(
    @Inject(CreateDeliveryService) private readonly createDelivery: CreateDeliveryService,
  ) {}

  @ApiErrors()
  @Post()
  @UseGuards(new ScopeGuard('delivery:create'))
  @ApiOperation({ summary: 'Open a delivery job' })
  @ApiBody({
    type: CreateDeliveryDto,
    description:
      'The shipment to deliver, optionally with the rider to attach now. Omit riderId to open the ' +
      'job as CREATED for assignment later.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required retry guard. Replaying the key returns the stored job rather than opening a second ' +
      'one; reuse with a different body is a 400.',
  })
  @ApiCreatedResponse({
    type: CreatedDeliveryJobDto,
    description:
      'Opens a delivery job for one shipment — born ASSIGNED when a rider is attached now, CREATED ' +
      'when it is not. The job covers exactly that shipment, and replaying this Idempotency-Key ' +
      'returns the stored job with `replayed: true` instead of opening a second.',
  })
  async create(
    @Body() body: CreateDeliveryDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<CreatedDeliveryJobDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }

    const { result, replayed } = await this.createDelivery.execute({
      shipmentId: body.shipmentId,
      riderId: body.riderId ?? null,
      idempotencyKey: idempotencyKey.trim(),
      actorId: null,
    });

    return { ...result, replayed };
  }
}
