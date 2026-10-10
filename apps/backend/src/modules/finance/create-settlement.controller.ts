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

import { Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { CreateSettlementService } from './create-settlement.service.ts';
import { CreatedSettlementDto } from './finance-response.dto.ts';

/**
 * **No body at all.**
 *
 * The endpoint used to take `merchantId` in the request body and never checked it — so any valid
 * key could freeze *another* merchant's collections into a settlement. A permission without tenant
 * scope is a data breach waiting for a missing WHERE, and this was the write case of it. The id now
 * comes from the credential, where it cannot be tampered with, and there is nothing left to validate.
 *
 * The second argument to `execute` is the actor. It was hardcoded `null`, which meant every
 * settlement was frozen by nobody in particular; the principal's subject id is who it actually was.
 */
@ApiTags('settlements')
@Controller('v1/settlements')
@UseGuards(ApiKeyGuard)
export class CreateSettlementController {
  constructor(
    @Inject(CreateSettlementService) private readonly createSettlement: CreateSettlementService,
  ) {}

  @Post()
  @UseGuards(new ScopeGuard('settlements:read'))
  @ApiOperation({ summary: 'Freeze your unsettled entries into a settlement' })
  @ApiCreatedResponse({ type: CreatedSettlementDto })
  async create(@Req() request: AuthenticatedRequest): Promise<CreatedSettlementDto> {
    return this.createSettlement.execute({
      merchantId: request.principal!.merchantId!,
      actorId: request.principal!.subjectId,
    });
  }
}
