/**
 * GET /v1/merchants/:id/balance — thin by design: validate, call the repository, return.
 *
 * Derived, never stored. The sum is computed inside the finance transaction so the figure is
 * exact at read time, and re-reading it later may legitimately differ — new entries arrive.
 * A balance that could not change would be a counter, and counters drift.
 */

import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { FinanceRepository } from './finance.repository.ts';

@ApiTags('settlements')
@Controller('v1/merchants')
@UseGuards(ApiKeyGuard)
export class BalanceController {
  constructor(
    @InjectDataSource('finance') private readonly financeDataSource: DataSource,
    @Inject(FinanceRepository) private readonly finance: FinanceRepository,
  ) {}

  @Get(':id/balance')
  @UseGuards(new ScopeGuard('settlements:read'))
  @ApiOperation({ summary: 'Derived merchant balance in minor units' })
  async balance(@Param('id') id: string): Promise<{
    merchantId: string;
    balanceMinor: number;
    currency: string;
  }> {
    // An unknown or malformed id sums to zero — there are simply no entries for it.
    // This matches the other param endpoints: the service 404s on unknown resources,
    // and a stranger's id is their own empty ledger, not our error to explain.
    const balanceMinor = await this.financeDataSource.transaction(async (manager) =>
      this.finance.balanceMinor(manager, id),
    );

    return { merchantId: id, balanceMinor, currency: 'BDT' };
  }
}
