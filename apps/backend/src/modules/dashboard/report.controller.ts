/**
 * GET /v1/control-tower/report — the operational KPI report: projection sums
 * over an inclusive day range plus the live operations snapshot. Read-only,
 * API-key guarded, controller thin (validate → one service call → return).
 *
 * The projection sums are network-wide and unfiltered by merchant, so this endpoint names a scope
 * as well as authenticating one. Without it a merchant key read every merchant's COD money in
 * poisha. A merchant reads their own series from `/v1/analytics/merchant`.
 */

import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { ReportService, type OperationsReport } from './report.service.ts';

export class ControlTowerReportQuery {
  /** Inclusive Asia/Dhaka day bucket, yyyy-mm-dd. Defaults: last 30 days. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be yyyy-mm-dd' })
  from?: string;

  /** Inclusive Asia/Dhaka day bucket, yyyy-mm-dd. Defaults: today. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be yyyy-mm-dd' })
  to?: string;
}

@ApiTags('control-tower')
@Controller('v1/control-tower')
@UseGuards(ApiKeyGuard)
export class ReportController {
  constructor(@Inject(ReportService) private readonly report: ReportService) {}

  @Get('report')
  @UseGuards(new ScopeGuard('network:read'))
  @ApiOperation({ summary: 'Operational KPI report: projection ranges plus live snapshot' })
  async getReport(@Query() query: ControlTowerReportQuery): Promise<OperationsReport> {
    return this.report.getReport(query.from, query.to);
  }
}
