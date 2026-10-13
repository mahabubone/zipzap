/**
 * GET /v1/settlements/:id — one settlement, itemised. And `…/statement.csv`, the same thing as a
 * download. Thin by design: guard, one service call, return.
 *
 * **The two endpoints cannot disagree, and that is the design.** Both call `GetSettlementService`,
 * which builds the statement through `rules/statement.ts` and asserts the lines sum to the frozen
 * net before returning. The screen renders that value; the CSV writes that value. There is no second
 * implementation of "the statement" to drift.
 *
 * The CSV headers are load-bearing, for the reason `bulk-import.controller.ts` documents: Nest
 * returns a bare `string` as `text/html`, so without them a browser saves the statement as an .html
 * file that opens as a broken page.
 */

import { Controller, Get, Header, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { GetSettlementService } from './get-settlement.service.ts';
import { statementCsv } from './rules/statement.ts';
import { SettlementStatementDto } from './finance-response.dto.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';

@ApiTags('settlements')
@Controller('v1/settlements')
@UseGuards(ApiKeyGuard)
export class GetSettlementController {
  constructor(@Inject(GetSettlementService) private readonly settlement: GetSettlementService) {}

  @Get(':id')
  @UseGuards(new ScopeGuard('settlements:read'))
  @ApiOperation({ summary: 'One settlement, itemised' })
  @ApiParam({
    name: 'id',
    description: 'Settlement id, as returned by `POST /v1/settlements` or `GET /v1/settlements`.',
  })
  @ApiOkResponse({
    type: SettlementStatementDto,
    description:
      'The frozen snapshot, itemised: `lines` carries every entry in the settlement with its ' +
      'memo, timestamp and shipment id, and the service refuses to return one whose lines do ' +
      'not sum back to the frozen `netMinor` in integer poisha. The CSV endpoint renders exactly ' +
      'these lines, so the screen and the download cannot disagree.',
  })
  @ApiErrors()
  async one(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<SettlementStatementDto> {
    return this.settlement.execute(request.principal!, id);
  }

  @Get(':id/statement.csv')
  @UseGuards(new ScopeGuard('settlements:read'))
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Download the itemised statement' })
  @ApiParam({
    name: 'id',
    description: 'Settlement id, as returned by `POST /v1/settlements` or `GET /v1/settlements`.',
  })
  // CSV, not JSON: the api-client fetches this with `.text()` and hands the caller a Blob, so the
  // spec must advertise text/csv or a generated client would try to parse the CSV as an envelope.
  @ApiOkResponse({
    content: { 'text/csv': { schema: { type: 'string' } } },
    description:
      'The itemised statement as CSV — the same lines and frozen net as GET /v1/settlements/:id. ' +
      'Content-Disposition names the file after the settlement reference.',
  })
  @ApiErrors()
  async csv(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    // `passthrough` so Nest still serialises the returned string; without it this would bypass the
    // interceptor chain and hand a raw buffer to the client.
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const statement = await this.settlement.execute(request.principal!, id);
    // Named after the settlement, not `statement.csv`: a merchant with forty downloads in
    // ~/Downloads can otherwise tell none of them apart. `@Header` cannot do this — it is evaluated
    // once at decoration time, before the reference is known.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="zipzap-${statement.reference}.csv"`,
    );
    return statementCsv(statement);
  }
}
