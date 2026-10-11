/**
 * POST /v1/returns — thin by design: validate, call one use case, return.
 *
 * Guarded by returns:write. Request is idempotency-keyed per shipment; approve
 * and advance are machine edges, idempotent by construction (repeats 409).
 */

import { Body, Controller, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { ReturnService } from './return.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { RETURN_REASONS } from './rules/returns.ts';
import { RequestedReturnDto, ReturnStatusDto } from './returns-response.dto.ts';

export class RequestReturnDto {
  @IsUUID('4')
  shipmentId!: string;

  @IsIn([...RETURN_REASONS])
  reason!: (typeof RETURN_REASONS)[number];
}

export class DecideReturnDto {
  @IsUUID('4')
  approverId!: string;

  @IsString()
  @MinLength(10, { message: 'A decision without an explanation is a cover-up. Say what you saw.' })
  @MaxLength(2000)
  note!: string;
}

@ApiTags('returns')
@Controller('v1/returns')
@UseGuards(ApiKeyGuard)
export class ReturnController {
  constructor(@Inject(ReturnService) private readonly returns: ReturnService) {}

  private merchantId(request: AuthenticatedRequest): string {
    return request.principal!.merchantId!;
  }

  @Post()
  @UseGuards(new ScopeGuard('returns:write'))
  @ApiOperation({ summary: 'Request a return against the original shipment' })
  @ApiBody({
    type: RequestReturnDto,
    description:
      'The original shipment to return and the reason, drawn from the closed RETURN_REASONS ' +
      'vocabulary. Merchant scope comes from the credential, not the body.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Required retry guard. One return per shipment: replaying the key returns the original, and ' +
      'reuse with a different body is a 400.',
  })
  @ApiOkResponse({
    type: RequestedReturnDto,
    description:
      'The return as opened, in RETURN_REQUESTED — the decision has not been made yet. Exactly one ' +
      'return can ever exist per shipment, so a shipment that already has one is rejected, and ' +
      'replaying this Idempotency-Key returns the stored body with `replayed: true`.',
  })
  @ApiErrors()
  async request(
    @Body() body: RequestReturnDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<RequestedReturnDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }
    const { result, replayed } = await this.returns.request({
      shipmentId: body.shipmentId,
      merchantId: this.merchantId(request),
      reason: body.reason,
      idempotencyKey: idempotencyKey.trim(),
    });
    return { ...result, replayed };
  }

  @Post(':id/approve')
  @UseGuards(new ScopeGuard('returns:write'))
  @ApiOperation({ summary: 'Approve a return — the merchant decision' })
  @ApiParam({ name: 'id', description: 'The return aggregate id being decided.' })
  @ApiBody({
    type: DecideReturnDto,
    description:
      'Who decided (approverId) and a note of at least 10 characters explaining what they saw — ' +
      'a decision without an explanation is rejected, by design.',
  })
  @ApiOkResponse({
    type: ReturnStatusDto,
    description:
      "Records the merchant's approval: the return moves from RETURN_REQUESTED to RETURN_APPROVED, " +
      'with the reviewer and note stamped on it. Approving moves no money itself — it unblocks the ' +
      'return to travel toward RETURNED, where finance emits the compensating adjustment.',
  })
  @ApiErrors()
  async approve(@Param('id') id: string, @Body() body: DecideReturnDto): Promise<ReturnStatusDto> {
    return this.returns.decide({
      returnId: id,
      approverId: body.approverId,
      note: body.note,
      approve: true,
    });
  }

  @Post(':id/reject')
  @UseGuards(new ScopeGuard('returns:write'))
  @ApiOperation({ summary: 'Reject a return — the merchant decision' })
  @ApiParam({ name: 'id', description: 'The return aggregate id being decided.' })
  @ApiBody({
    type: DecideReturnDto,
    description:
      'Who decided (approverId) and a note of at least 10 characters explaining what they saw — ' +
      'a decision without an explanation is rejected, by design.',
  })
  @ApiOkResponse({
    type: ReturnStatusDto,
    description:
      "Records the merchant's rejection: the return moves to terminal RETURN_REJECTED, with the " +
      'reviewer and note stamped on it. Rejection ends this return and moves no money; the parcel ' +
      'stays with the customer, and a fresh request is filed rather than reopening this one.',
  })
  @ApiErrors()
  async reject(@Param('id') id: string, @Body() body: DecideReturnDto): Promise<ReturnStatusDto> {
    return this.returns.decide({
      returnId: id,
      approverId: body.approverId,
      note: body.note,
      approve: false,
    });
  }

  @Post(':id/advance')
  @UseGuards(new ScopeGuard('returns:write'))
  @ApiOperation({ summary: 'Walk one transit leg toward the merchant' })
  @ApiParam({ name: 'id', description: 'The return aggregate id being advanced.' })
  @ApiOkResponse({
    type: ReturnStatusDto,
    description:
      'Walks the return one transit leg — RETURN_APPROVED → INITIATED → IN_TRANSIT → AT_HUB → ' +
      'OUT_FOR_DELIVERY → RETURNED — and returns the new state. It only advances a return already ' +
      'approved or in transit (a pending or terminal return is a 404); on the RETURNED leg it emits ' +
      'ReturnCompleted carrying the COD amount finance reverses.',
  })
  @ApiErrors()
  async advance(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReturnStatusDto> {
    return this.returns.advance({ returnId: id, actorId: request.principal?.subjectId ?? null });
  }
}
