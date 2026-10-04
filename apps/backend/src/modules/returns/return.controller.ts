/**
 * POST /v1/returns — thin by design: validate, call one use case, return.
 *
 * Guarded by returns:write. Request is idempotency-keyed per shipment; approve
 * and advance are machine edges, idempotent by construction (repeats 409).
 */

import { Body, Controller, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { ReturnService } from './return.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { RETURN_REASONS } from './rules/returns.ts';
import type { ReturnStatus } from './rules/returns.ts';

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
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async request(
    @Body() body: RequestReturnDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; shipmentId: string; status: ReturnStatus; replayed: boolean }> {
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
  async approve(
    @Param('id') id: string,
    @Body() body: DecideReturnDto,
  ): Promise<{ id: string; status: ReturnStatus }> {
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
  async reject(
    @Param('id') id: string,
    @Body() body: DecideReturnDto,
  ): Promise<{ id: string; status: ReturnStatus }> {
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
  async advance(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: ReturnStatus }> {
    return this.returns.advance({ returnId: id, actorId: request.principal?.subjectId ?? null });
  }
}
