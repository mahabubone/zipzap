/**
 * POST /v1/deliveries/:id/attempts — thin by design: validate, call one use case, return.
 *
 * The reason vocabulary is closed at the DTO layer, not just in rules/: an unknown reason is
 * rejected before it can be recorded, because a free-text reason downstream is a string nobody
 * can act on.
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
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RecordAttemptService } from './record-attempt.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { FAILURE_REASONS } from './rules/delivery.ts';
import { RecordedAttemptDto } from './delivery-response.dto.ts';

export class RecordAttemptDto {
  @IsIn([...FAILURE_REASONS])
  reason!: (typeof FAILURE_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

@ApiTags('deliveries')
@Controller('v1/deliveries')
@UseGuards(ApiKeyGuard)
export class RecordAttemptController {
  constructor(@Inject(RecordAttemptService) private readonly recordAttempt: RecordAttemptService) {}

  @ApiErrors()
  @Post(':id/attempts')
  @UseGuards(new ScopeGuard('delivery:complete'))
  @ApiOperation({ summary: 'Record a failed delivery attempt' })
  @ApiParam({ name: 'id', description: 'The delivery job whose failed attempt is being recorded.' })
  @ApiBody({
    type: RecordAttemptDto,
    description:
      'The failure reason from the closed vocabulary — an unknown reason is rejected here, not ' +
      'recorded — and an optional note up to 500 characters. Whether the reason retries the job or ' +
      'ends it into returns is decided server-side by policy, not by the caller.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required retry guard. A rider confirming twice from a flaky connection must not produce two ' +
      'attempts — replaying the key collapses them; reuse with a different body is a 400.',
  })
  @ApiOkResponse({
    type: RecordedAttemptDto,
    description:
      'Records the failed attempt and moves the job by the reason: a retryable reason ' +
      '(CUSTOMER_UNAVAILABLE, PHONE_UNREACHABLE, ADDRESS_INCOMPLETE, WEATHER, or ' +
      'OPERATIONAL_EXCEPTION) with attempts left returns it to OUT_FOR_DELIVERY with ' +
      '`retryScheduled: true`; a terminal reason, or a third failed attempt, ends it at FAILED and ' +
      'hands the parcel to returns. `status` is where the job sits after that decision.',
  })
  async record(
    @Param('id') id: string,
    @Body() body: RecordAttemptDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<RecordedAttemptDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      // A rider confirming from a flaky connection twice must not produce two attempts.
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }
    const { result, replayed } = await this.recordAttempt.execute({
      jobId: id,
      reason: body.reason,
      note: body.note,
      idempotencyKey: idempotencyKey.trim(),
      actorId: request.principal?.subjectId ?? null,
    });

    return { ...result, replayed };
  }
}
