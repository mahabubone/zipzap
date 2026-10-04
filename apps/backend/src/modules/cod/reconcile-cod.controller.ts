/**
 * POST /v1/cod/reconcile — thin by design: validate, call one use case, return.
 *
 * No Idempotency-Key here, deliberately: this is a human decision, not a retried network call.
 * The machine permits the transition exactly once (anything else 409s), so replaying it is a
 * no-op by construction rather than by dedupe. An operator hammering the button gets the same
 * answer twice, not two resolutions.
 */

import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiKeyGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { ReconcileCodService, type ReconciledCod } from './reconcile-cod.service.ts';

export class ReconcileCodDto {
  @IsUUID('4')
  shipmentId!: string;

  @IsString()
  @MinLength(10, { message: 'A review without an explanation is a cover-up. Say what you saw.' })
  @MaxLength(2000)
  note!: string;
}

@ApiTags('cod')
@Controller('v1/cod')
@UseGuards(ApiKeyGuard)
export class ReconcileCodController {
  constructor(@Inject(ReconcileCodService) private readonly reconcileCod: ReconcileCodService) {}

  @Post('reconcile')
  @ApiOperation({ summary: 'Resolve a COD mismatch after human review' })
  async reconcile(
    @Body() body: ReconcileCodDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReconciledCod> {
    return this.reconcileCod.execute({
      shipmentId: body.shipmentId,
      note: body.note,
      actorId: request.principal?.subjectId ?? null,
    });
  }
}
