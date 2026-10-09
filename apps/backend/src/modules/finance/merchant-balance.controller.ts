/**
 * GET /v1/finance/balance — your balance. Thin by design.
 *
 * No merchant id in the path, because there is nothing here to tamper with: the id comes from the
 * credential. The older `GET /v1/merchants/:id/balance` accepts a path id and cannot check it, so it
 * is ops-only from here — see that controller for why it still exists.
 */

import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { MerchantBalanceService, type MerchantBalance } from './merchant-balance.service.ts';

@ApiTags('settlements')
@Controller('v1/finance')
@UseGuards(ApiKeyGuard)
export class MerchantBalanceController {
  constructor(@Inject(MerchantBalanceService) private readonly balance: MerchantBalanceService) {}

  @Get('balance')
  @UseGuards(new ScopeGuard('settlements:read'))
  @ApiOperation({ summary: 'Your derived balance, itemised, with anything blocking a payout' })
  async mine(@Req() request: AuthenticatedRequest): Promise<MerchantBalance> {
    return this.balance.execute(request.principal!.merchantId!);
  }
}
