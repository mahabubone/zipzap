/**
 * POST /v1/deliveries/:id/accept + /dispatch — the two rider-workflow edges.
 *
 * No request body and no idempotency key: each edge is idempotent by construction because the
 * machine rejects repeating it (ACCEPTED -> ACCEPTED is illegal). A retried accept returns 409,
 * not a duplicate effect.
 */

import { Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { AdvanceDeliveryService } from './advance-delivery.service.ts';
import type { DeliveryStatus } from './rules/delivery.ts';

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
}
