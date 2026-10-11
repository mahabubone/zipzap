/**
 * POST /v1/shipments/:id/exception — report LOST or DAMAGED through the real state machine.
 *
 * Same tenant gate as cancel: a stranger's id 404s, never 403. Idempotent by the machine —
 * reporting LOST twice is a second transition the machine rejects with 409, not a silent
 * double write. No Idempotency-Key header: the transition itself is the dedupe.
 */

import { Body, Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import {
  EXCEPTION_REASONS,
  ReportExceptionService,
  type ExceptionReason,
} from './report-exception.service.ts';
import { ReportedExceptionDto } from './shipment-response.dto.ts';

export class ReportExceptionDto {
  @IsIn([...EXCEPTION_REASONS])
  reason!: ExceptionReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@ApiTags('shipments')
@Controller('v1/shipments')
@UseGuards(ApiKeyGuard)
export class ReportExceptionController {
  constructor(
    @InjectDataSource('shipment') private readonly shipments: DataSource,
    @Inject(ReportExceptionService) private readonly exceptions: ReportExceptionService,
  ) {}

  @ApiErrors()
  @Post(':id/exception')
  @UseGuards(new ScopeGuard('shipments:write'), new RateLimitGuard('merchant', true))
  @ApiOperation({ summary: 'Report a LOST or DAMAGED exception for one of your shipments' })
  @ApiParam({
    name: 'id',
    description:
      "The shipment id. It must be one of yours — a stranger's id 404s rather than 403s, so the " +
      '404 never confirms the parcel exists.',
  })
  @ApiBody({
    type: ReportExceptionDto,
    description:
      'Which exception, and an optional note for whoever investigates it. The reason doubles as the ' +
      'target status, so only what the shipment can legally become is accepted.',
  })
  @ApiOkResponse({
    type: ReportedExceptionDto,
    description:
      'The shipment is now in the reported state, entered through the real state machine — so a report ' +
      'from a state the edge does not leave is a 409, and reporting the same exception twice is a ' +
      'second transition, not a double write. No money moves here; finance reacts to the event.',
  })
  async report(
    @Param('id') id: string,
    @Body() body: ReportExceptionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReportedExceptionDto> {
    const merchantId = request.principal!.merchantId!;
    const rows = await this.shipments.query(
      `SELECT id FROM shipment.shipments WHERE id = $1 AND merchant_id = $2`,
      [id, merchantId],
    );
    if (!rows[0]) throw new ResourceNotFoundError('Shipment not found.');

    return this.exceptions.execute({
      shipmentId: id,
      reason: body.reason,
      note: body.note ?? null,
      actorId: request.principal?.subjectId ?? null,
    });
  }
}
