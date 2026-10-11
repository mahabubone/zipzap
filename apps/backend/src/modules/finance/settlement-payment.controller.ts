/**
 * POST /v1/settlements/:id/initiate-payment + /confirm-payment — thin by design.
 *
 * Guarded by settlements:approve: moving money to a merchant is the same trust level
 * as approving the settlement. Both take Idempotency-Key — a retried initiation must
 * return the recorded payment, never a second one.
 */

import { Controller, Headers, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
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
  @ApiParam({
    name: 'id',
    description:
      'Settlement id. It must be in `APPROVED` status — an unapproved freeze is not payable.',
  })
  @ApiOkResponse({
    type: InitiatedSettlementPaymentDto,
    description:
      'The payout is initiated for the frozen `netMinor` in integer poisha and the settlement ' +
      "moves to `PAYMENT_INITIATED`; `paymentReference` is the provider's handle on that payout. " +
      'A retry with the same `Idempotency-Key` returns the recorded payment rather than ' +
      'initiating a second one — the invoice number is derived from the reference, so the ' +
      'provider converges on one payout.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Retry guard for a money-moving call: a replay with the same key returns the recorded ' +
      'payment instead of initiating a second one.',
  })
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
  @ApiParam({
    name: 'id',
    description:
      'Settlement id. A payment must already be initiated against it, so it is in `PAYMENT_INITIATED` status.',
  })
  @ApiOkResponse({
    type: ConfirmedSettlementPaymentDto,
    description:
      "The provider's terminal answer for the initiated payout, and what the server did with " +
      'it: `providerStatus` `succeeded` posts the `SETTLEMENT_PAYOUT` ledger entry and moves the ' +
      'settlement to `SETTLED`; anything else leaves it in `PAYMENT_INITIATED` with no ledger ' +
      'entry, because money did not move. A retry returns the recorded outcome rather than ' +
      'confirming twice.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Retry guard for a money-moving call: a replay with the same key returns the recorded ' +
      'outcome instead of settling twice.',
  })
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
