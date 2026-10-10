/**
 * POST /v1/shipments/bulk — thin by design: validate, call one use case, return.
 *
 * Guarded by shipments:write. The upload body is JSON carrying the CSV text —
 * raw text/csv would need parser middleware config, and the CSV content is what
 * matters, not its transport encoding. Returns 202 with the preview checkpoint,
 * then 202-accept moves it to chunked processing.
 */

import { Body, Controller, Get, Header, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { BulkImportService } from './bulk-import.service.ts';
import { BulkJobViewDto, BulkPreviewDto } from './shipment-response.dto.ts';

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
  @ApiAcceptedResponse({ type: BulkPreviewDto })
  async upload(
    @Body() body: UploadBulkDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BulkPreviewDto> {
    return this.bulk.upload(this.merchantId(request), body.filename, body.csv);
  }

  @Post('accept')
  @UseGuards(new ScopeGuard('shipments:write'))
  @ApiOperation({ summary: 'Accept the preview — enqueue chunked processing' })
  @ApiAcceptedResponse({ type: BulkJobViewDto })
  async accept(
    @Body() body: AcceptBulkDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<BulkJobViewDto> {
    return this.bulk.accept(this.merchantId(request), body.jobId);
  }

  @Get(':jobId')
  @UseGuards(new ScopeGuard('shipments:write'))
  @ApiOperation({ summary: 'Poll job progress' })
  @ApiOkResponse({ type: BulkJobViewDto })
  async progress(
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<BulkJobViewDto> {
    return this.bulk.progress(this.merchantId(request), jobId);
  }

  @Get(':jobId/result')
  @UseGuards(new ScopeGuard('shipments:write'))
  // Nest returns a bare `string` as text/html, so a browser saves the result as
  // an .html file that opens as a broken page. Both headers are load-bearing:
  // the type is what makes it a download, the disposition is what names it.
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="zipzap-bulk-result.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Download the row-level result CSV' })
  async result(
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<string> {
    return this.bulk.resultCsv(this.merchantId(request), jobId);
  }
}
