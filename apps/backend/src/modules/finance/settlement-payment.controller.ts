/**
 * POST /v1/settlements/:id/initiate-payment + /confirm-payment — thin by design.
 *
 * Guarded by settlements:approve: moving money to a merchant is the same trust level
 * as approving the settlement. Both take Idempotency-Key — a retried initiation must
 * return the recorded payment, never a second one.
 */

import { Controller, Headers, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { ConfirmSettlementPaymentService } from './confirm-settlement-payment.service.ts';
import { InitiateSettlementPaymentService } from './initiate-settlement-payment.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import {
  ConfirmedSettlementPaymentDto,
  InitiatedSettlementPaymentDto,
} from './finance-response.dto.ts';

function requireKey(key: string | undefined): string {
  if (!key || key.trim().length === 0) {
    throw new DuplicateRequestError('Idempotency-Key header is required.');
  }
  return key.trim();
}

@ApiTags('settlements')
@Controller('v1/settlements')
@UseGuards(ApiKeyGuard)
export class SettlementPaymentController {
  constructor(
    @Inject(InitiateSettlementPaymentService)
    private readonly initiate: InitiateSettlementPaymentService,
    @Inject(ConfirmSettlementPaymentService)
    private readonly confirm: ConfirmSettlementPaymentService,
  ) {}

  @ApiErrors()
  @Post(':id/initiate-payment')
  @UseGuards(new ScopeGuard('settlements:approve'))
  @ApiOperation({ summary: 'Initiate the provider payout for an approved settlement' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: InitiatedSettlementPaymentDto })
  async initiatePayment(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<InitiatedSettlementPaymentDto> {
    const { result, replayed } = await this.initiate.execute({
      settlementId: id,
      idempotencyKey: requireKey(idempotencyKey),
    });
    return { ...result, replayed };
  }

  @ApiErrors()
  @Post(':id/confirm-payment')
  @UseGuards(new ScopeGuard('settlements:approve'))
  @ApiOperation({ summary: 'Confirm the provider payout and settle' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ConfirmedSettlementPaymentDto })
  async confirmPayment(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<ConfirmedSettlementPaymentDto> {
    const { result, replayed } = await this.confirm.execute({
      settlementId: id,
      idempotencyKey: requireKey(idempotencyKey),
    });
    return { ...result, replayed };
  }
}
