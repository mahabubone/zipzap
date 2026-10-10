/**
 * POST /v1/deliveries — thin by design: validate, call one use case, return.
 */

import { Body, Controller, Headers, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiCreatedResponse, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: CreatedDeliveryJobDto })
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
