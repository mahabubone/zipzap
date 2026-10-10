/**
 * POST /v1/settlements/:id/approve — thin by design: validate, call one use case, return.
 *
 * Guarded by settlements:approve, the one scope that moves real money. Idempotency-Key is
 * load-bearing here: a retried approval must return the recorded decision, never a second
 * approval. The service enforces it; this boundary enforces its presence.
 */

import { Body, Controller, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { ApproveSettlementService } from './approve-settlement.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { ApprovedSettlementDto } from './finance-response.dto.ts';

export class ApproveSettlementDto {
  @IsUUID('4')
  approverId!: string;
}

@ApiTags('settlements')
@Controller('v1/settlements')
@UseGuards(ApiKeyGuard)
export class ApproveSettlementController {
  constructor(
    @Inject(ApproveSettlementService) private readonly approveSettlement: ApproveSettlementService,
  ) {}

  @Post(':id/approve')
  @UseGuards(new ScopeGuard('settlements:approve'))
  @ApiOperation({ summary: 'Approve a settlement — the point of no return' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ApprovedSettlementDto })
  async approve(
    @Param('id') id: string,
    @Body() body: ApproveSettlementDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApprovedSettlementDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }
    void request;

    const { result, replayed } = await this.approveSettlement.execute({
      settlementId: id,
      approverId: body.approverId,
      idempotencyKey: idempotencyKey.trim(),
    });

    return { ...result, replayed };
  }
}
