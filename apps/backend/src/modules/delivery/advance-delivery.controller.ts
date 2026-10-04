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
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { AdvanceDeliveryService } from './advance-delivery.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import type { DeliveryStatus } from './rules/delivery.ts';

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

  @Post(':id/accept')
  @UseGuards(new ScopeGuard('delivery:complete'))
  @ApiOperation({ summary: 'Rider accepts a delivery job' })
  async accept(@Param('id') id: string): Promise<{ id: string; status: DeliveryStatus }> {
    const status = await this.advance.accept(id);
    return { id, status };
  }

  @Post(':id/dispatch')
  @UseGuards(new ScopeGuard('delivery:complete'))
  @ApiOperation({ summary: 'Rider heads out for delivery' })
  async dispatch(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: DeliveryStatus }> {
    const status = await this.advance.dispatch(id, request.principal?.subjectId ?? null);
    return { id, status };
  }

  @Post(':id/complete')
  @UseGuards(new ScopeGuard('delivery:complete'))
  @ApiOperation({ summary: 'Confirm delivery and collect COD' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async complete(
    @Param('id') id: string,
    @Body() body: CompleteDeliveryDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: DeliveryStatus }> {
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
