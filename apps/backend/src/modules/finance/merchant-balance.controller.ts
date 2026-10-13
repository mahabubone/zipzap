/**
 * GET /v1/finance/balance — your balance. Thin by design.
 *
 * No merchant id in the path, because there is nothing here to tamper with: the id comes from the
 * credential. The older `GET /v1/merchants/:id/balance` accepts a path id and cannot check it, so it
 * is ops-only from here — see that controller for why it still exists.
 */

import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { MerchantBalanceService } from './merchant-balance.service.ts';
import { MerchantBalanceDto } from './finance-response.dto.ts';

@ApiTags('settlements')
@Controller('v1/finance')
@UseGuards(ApiKeyGuard)
export class MerchantBalanceController {
  constructor(@Inject(MerchantBalanceService) private readonly balance: MerchantBalanceService) {}

  @ApiErrors()
  @Get('balance')
  @UseGuards(new ScopeGuard('settlements:read'))
  @ApiOperation({ summary: 'Your derived balance, itemised, with anything blocking a payout' })
  @ApiOkResponse({
    type: MerchantBalanceDto,
    description:
      'What you are owed right now, derived from the ledger and never stored: `balanceMinor` is ' +
      'the one signed integer-poisha figure (negative means we owe you), `lines` itemises every ' +
      'entry behind it, and `asOf` is the exact instant it was true. `blocked` says what is ' +
      'withholding a payout, if anything — an unreviewed COD exception blocks a freeze rather ' +
      'than quietly shrinking it.',
  })
  async mine(@Req() request: AuthenticatedRequest): Promise<MerchantBalanceDto> {
    return this.balance.execute(request.principal!.merchantId!);
  }
}
