/**
 * POST /v1/deliveries/:id/accept + /dispatch + /complete — the rider-workflow edges.
 *
 * Accept and dispatch take no body and no idempotency key: each edge is idempotent by
 * construction because the machine rejects repeating it (ACCEPTED -> ACCEPTED is illegal).
 *
 * Complete DOES take an Idempotency-Key, because it drives a money-moving operation one module
 * over (COD collect). A retried confirmation must replay the delivery confirmation, never
 * produce a second collection.
 */

import { Body, Controller, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { AdvanceDeliveryService } from './advance-delivery.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { DeliveryStatusDto } from './delivery-response.dto.ts';

export class CompleteDeliveryDto {
  /** Integer minor units collected at the door. A decimal here is a bug, not a convenience. */
  @IsInt()
  @Min(0)
  collectedMinor!: number;
}

@ApiTags('deliveries')
@Controller('v1/deliveries')
@UseGuards(ApiKeyGuard)
export class AdvanceDeliveryController {
  constructor(@Inject(AdvanceDeliveryService) private readonly advance: AdvanceDeliveryService) {}

  @ApiErrors()
  @Post(':id/accept')
  @UseGuards(new ScopeGuard('delivery:complete'))
  @ApiOperation({ summary: 'Rider accepts a delivery job' })
  @ApiOkResponse({ type: DeliveryStatusDto })
  async accept(@Param('id') id: string): Promise<DeliveryStatusDto> {
    const status = await this.advance.accept(id);
    return { id, status };
  }

  @ApiErrors()
  @Post(':id/dispatch')
  @UseGuards(new ScopeGuard('delivery:complete'))
  @ApiOperation({ summary: 'Rider heads out for delivery' })
  @ApiOkResponse({ type: DeliveryStatusDto })
  async dispatch(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<DeliveryStatusDto> {
    const status = await this.advance.dispatch(id, request.principal?.subjectId ?? null);
    return { id, status };
  }

  @ApiErrors()
  @Post(':id/complete')
  @UseGuards(new ScopeGuard('delivery:complete'))
  @ApiOperation({ summary: 'Confirm delivery and collect COD' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: DeliveryStatusDto })
  async complete(
    @Param('id') id: string,
    @Body() body: CompleteDeliveryDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<DeliveryStatusDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      // A rider confirming from a flaky connection twice must not produce two deliveries,
      // two proofs, or two COD collections.
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }
    const status = await this.advance.complete(id, {
      collectedMinor: body.collectedMinor,
      idempotencyKey: idempotencyKey.trim(),
      actorId: request.principal?.subjectId ?? null,
    });
    return { id, status };
  }
}
