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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { ReportService } from './report.service.ts';
import { OperationsReportDto } from './dashboard-response.dto.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';

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
  @ApiOkResponse({
    type: OperationsReportDto,
    description:
      'Two time-views in one response: KPIs summed from the analytics projections over the ' +
      'inclusive Asia/Dhaka day range, and the live hub, exception, rider and pool-utilisation ' +
      'numbers as of `live.timestamp`. Defaults to the last 30 days ending today; the COD money ' +
      'is poisha, one entry per currency.',
  })
  @ApiErrors()
  async getReport(@Query() query: ControlTowerReportQuery): Promise<OperationsReportDto> {
    return this.report.getReport(query.from, query.to);
  }
}
