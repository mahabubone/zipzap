/**
 * POST /v1/settlements/:id/approve — thin by design: validate, call one use case, return.
 *
 * Guarded by settlements:approve, the one scope that moves real money. Idempotency-Key is
 * load-bearing here: a retried approval must return the recorded decision, never a second
 * approval. The service enforces it; this boundary enforces its presence.
 */

import { Body, Controller, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
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

  @ApiErrors()
  @Post(':id/approve')
  @UseGuards(new ScopeGuard('settlements:approve'))
  @ApiOperation({ summary: 'Approve a settlement — the point of no return' })
  @ApiParam({
    name: 'id',
    description: 'Settlement id, as returned by `POST /v1/settlements` or `GET /v1/settlements`.',
  })
  @ApiBody({
    type: ApproveSettlementDto,
    description:
      'Who is approving, as a subject id. The approval is audited against it — a payout nobody ' +
      'can attribute is the thing approvals exist to prevent.',
  })
  @ApiOkResponse({
    type: ApprovedSettlementDto,
    description:
      'The settlement moves `CREATED` → `APPROVED` and becomes immutable: the approver and the ' +
      'instant are recorded on the row and audited, and a late COD lands in the next settlement ' +
      'instead. A retry with the same `Idempotency-Key` returns this recorded decision with ' +
      '`replayed: true` — never a second approval.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Retry guard for the money-moving decision: a replay with the same key returns the ' +
      'recorded approval instead of approving twice.',
  })
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
