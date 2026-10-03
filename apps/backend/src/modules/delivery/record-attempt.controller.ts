/**
 * POST /v1/deliveries/:id/attempts — thin by design: validate, call one use case, return.
 *
 * The reason vocabulary is closed at the DTO layer, not just in rules/: an unknown reason is
 * rejected before it can be recorded, because a free-text reason downstream is a string nobody
 * can act on.
 */

import { Body, Controller, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RecordAttemptService, type RecordedAttempt } from './record-attempt.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { FAILURE_REASONS } from './rules/delivery.ts';

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

  @Post(':id/attempts')
  @UseGuards(new ScopeGuard('delivery:complete'))
  @ApiOperation({ summary: 'Record a failed delivery attempt' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async record(
    @Param('id') id: string,
    @Body() body: RecordAttemptDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<RecordedAttempt & { replayed: boolean }> {
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
