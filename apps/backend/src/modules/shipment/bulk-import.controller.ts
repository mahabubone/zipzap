/**
 * POST /v1/shipments/bulk — thin by design: validate, call one use case, return.
 *
 * Guarded by shipments:write. The upload body is JSON carrying the CSV text —
 * raw text/csv would need parser middleware config, and the CSV content is what
 * matters, not its transport encoding. Returns 202 with the preview checkpoint,
 * then 202-accept moves it to chunked processing.
 */

import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { BulkImportService, type BulkJobView, type BulkPreview } from './bulk-import.service.ts';

export class UploadBulkDto {
  @IsString()
  @MaxLength(10_000_000)
  csv!: string;

  @IsString()
  @MaxLength(255)
  filename!: string;
}

export class AcceptBulkDto {
  @IsString()
  jobId!: string;
}

@ApiTags('shipments')
@Controller('v1/shipments/bulk')
@UseGuards(ApiKeyGuard)
export class BulkImportController {
  constructor(@Inject(BulkImportService) private readonly bulk: BulkImportService) {}

  private merchantId(request: AuthenticatedRequest): string {
    return request.principal!.merchantId!;
  }

  @Post('upload')
  @UseGuards(new ScopeGuard('shipments:write'))
  @ApiOperation({ summary: 'Upload CSV, get the human preview checkpoint' })
  async upload(
    @Body() body: UploadBulkDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BulkPreview> {
    return this.bulk.upload(this.merchantId(request), body.filename, body.csv);
  }

  @Post('accept')
  @UseGuards(new ScopeGuard('shipments:write'))
  @ApiOperation({ summary: 'Accept the preview — enqueue chunked processing' })
  async accept(
    @Body() body: AcceptBulkDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BulkJobView> {
    return this.bulk.accept(this.merchantId(request), body.jobId);
  }

  @Get(':jobId')
  @UseGuards(new ScopeGuard('shipments:write'))
  @ApiOperation({ summary: 'Poll job progress' })
  async progress(
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<BulkJobView> {
    return this.bulk.progress(this.merchantId(request), jobId);
  }

  @Get(':jobId/result')
  @UseGuards(new ScopeGuard('shipments:write'))
  @ApiOperation({ summary: 'Download the row-level result CSV' })
  async result(
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<string> {
    return this.bulk.resultCsv(this.merchantId(request), jobId);
  }
}
