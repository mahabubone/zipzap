/**
 * GetSettlement — one settlement, itemised.
 *
 * `items_json` has existed since the day `finance.settlements` was created and **no endpoint ever
 * returned it**. The itemised snapshot is the entire basis of a statement, so a merchant could see
 * that they were paid ৳98,200 and had no way to find out what made up that number. This is the read
 * that was missing.
 *
 * Tenant-scoped in the WHERE, not filtered afterwards: `assertTenant` runs first so a stranger gets
 * a 404 (which does not confirm the row exists) rather than a 403 (which does).
 *
 * The line detail — memo, timestamp, shipment id — is joined from the ledger inside this module.
 * That is not a boundary crossing: both tables are `finance`'s own. The shipment id is carried on
 * the ledger as part of the memo rather than joined out of `shipment.shipments`, which would be rule
 * 2 and a much worse design — a statement should not change because a parcel row was archived.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { assertTenant } from '../identity/rules/api-principal.ts';
import type { ApiPrincipal } from '../identity/rules/api-principal.ts';
import { SettlementNotFoundError } from '../../common/domain-error.ts';
import { FinanceRepository } from './finance.repository.ts';
import {
  assertStatementTotals,
  statement,
  type SettlementItem,
  type SettlementStatement,
} from './rules/statement.ts';

@Injectable()
export class GetSettlementService {
  constructor(
    @InjectDataSource('finance') private readonly finance: DataSource,
    @Inject(FinanceRepository) private readonly repository: FinanceRepository,
  ) {}

  async execute(principal: ApiPrincipal, settlementId: string): Promise<SettlementStatement> {
    return this.finance.transaction(async (manager) => {
      const row = await this.repository.findSettlement(manager, settlementId);
      if (row === null) throw new SettlementNotFoundError();
      assertTenant(principal, row.merchantId);

      // The frozen items plus their ledger detail, one query: a statement that took two round trips
      // could show a line whose memo was written between them.
      const detail = await this.repository.lineDetail(manager, row.itemsJson, row.currency);

      const items: ReadonlyArray<SettlementItem> = Array.isArray(row.itemsJson)
        ? (row.itemsJson as ReadonlyArray<SettlementItem>)
        : [];

      const built = statement({
        reference: row.reference,
        status: row.status,
        currency: row.currency,
        createdAt: row.createdAt.toISOString(),
        frozenNetMinor: Number(row.frozenNetMinor),
        items,
        detailByEntry: detail,
      });

      // The exit check, enforced: the itemisation must reproduce the frozen checksum exactly.
      assertStatementTotals(built);
      return built;
    });
  }
}
