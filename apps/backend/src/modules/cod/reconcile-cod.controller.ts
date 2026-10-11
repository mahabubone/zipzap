/**
 * POST /v1/cod/reconcile — thin by design: validate, call one use case, return.
 *
 * No Idempotency-Key here, deliberately: this is a human decision, not a retried network call.
 * The machine permits the transition exactly once (anything else 409s), so replaying it is a
 * no-op by construction rather than by dedupe. An operator hammering the button gets the same
 * answer twice, not two resolutions.
 */

import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiKeyGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { ReconcileCodService } from './reconcile-cod.service.ts';
import { ReconciledCodDto } from './cod-response.dto.ts';

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

  @ApiErrors()
  @Post('reconcile')
  @ApiOperation({ summary: 'Resolve a COD mismatch after human review' })
  @ApiBody({
    type: ReconcileCodDto,
    description:
      'The shipment being reviewed and the note explaining what was seen — at least ten ' +
      'characters, because a resolution without a reason is indistinguishable from a cover-up. ' +
      'No amounts are accepted here: this records a human decision, it does not correct one.',
  })
  @ApiOkResponse({
    type: ReconciledCodDto,
    description:
      'The reviewed record moves to `COD_RECONCILED` with your note and identity attached, and ' +
      'no amount changes — a mismatch is resolved by decision, not by arithmetic. This is the ' +
      'only transition that clears an exception, which is what unblocks the next settlement ' +
      'freeze.',
  })
  async reconcile(
    @Body() body: ReconcileCodDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReconciledCodDto> {
    return this.reconcileCod.execute({
      shipmentId: body.shipmentId,
      note: body.note,
      actorId: request.principal?.subjectId ?? null,
    });
  }
}
