/**
 * POST /v1/settlements — thin by design: validate, call one use case, return.
 *
 * No Idempotency-Key here, deliberately — and for the opposite reason to the other endpoints.
 * A settlement freeze reads whatever is unsettled *right now*, so two identical requests made a
 * minute apart legitimately produce different settlements. Dedupe would be wrong: it would return
 * a stale freeze as if nothing had changed. The freeze is idempotent by content (same unsettled
 * set, same snapshot), not by key.
 *
 * Guarded by settlements:read: seeing what is owed is read access. Approving is separate.
 */

import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { CreateSettlementService, type CreatedSettlement } from './create-settlement.service.ts';

export class CreateSettlementDto {
  @IsUUID('4')
  merchantId!: string;
}

@ApiTags('settlements')
@Controller('v1/settlements')
@UseGuards(ApiKeyGuard)
export class CreateSettlementController {
  constructor(
    @Inject(CreateSettlementService) private readonly createSettlement: CreateSettlementService,
  ) {}

  @Post()
  @UseGuards(new ScopeGuard('settlements:read'))
  @ApiOperation({ summary: 'Freeze unsettled entries into a settlement' })
  async create(
    @Body() body: CreateSettlementDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CreatedSettlement> {
    void request;
    return this.createSettlement.execute({ merchantId: body.merchantId, actorId: null });
  }
}
